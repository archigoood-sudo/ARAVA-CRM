import { app, BrowserWindow, shell } from 'electron';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StudentDocumentPackEditSession, StudentDocumentPackInfo } from '@arava/shared';
import { randomUUID } from 'node:crypto';

const TOKENS = new Set(['CONTRACT_NUMBER', 'CUSTOMER_FIO', 'PARENT_FIO', 'STUDENT_FIO']);
export interface DocumentPackConverter {
  convert(document: Buffer): Promise<Buffer>;
}

export function resolveDocumentTemplateDirectory(
  packaged: boolean,
  resourcesPath: string,
  mainDirectory = import.meta.dirname,
): string {
  return packaged
    ? join(resourcesPath, 'document-templates')
    : join(mainDirectory, '../../../../docs/document-templates/source');
}

export async function createTemporaryPdf(pdf: Buffer): Promise<{
  path: string;
  release: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'arava-document-pack-'));
  const path = join(directory, 'documents.pdf');
  await writeFile(path, pdf, { flag: 'wx' });
  return { path, release: () => rm(directory, { recursive: true, force: true }) };
}
const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export async function fillDocxTemplate(
  source: Buffer,
  values: Record<string, string>,
): Promise<Buffer> {
  const archive = await JSZip.loadAsync(source);
  const names = Object.keys(archive.files).filter(
    (name) => name.startsWith('word/') && name.endsWith('.xml'),
  );
  const xmls = await Promise.all(
    names.map(async (name) => archive.file(name)?.async('string') ?? ''),
  );
  const found = [...xmls.join('\n').matchAll(/\{\{([A-Z0-9_]+)\}\}/gu)].map(
    (match) => match[1] ?? '',
  );
  const unknown = [...new Set(found.filter((token) => !TOKENS.has(token)))];
  if (unknown.length) throw new Error(`Неизвестный placeholder: ${unknown.join(', ')}`);
  for (const name of names) {
    const file = archive.file(name);
    if (!file) continue;
    let xml = await file.async('string');
    for (const token of found) {
      if (!(token in values)) throw new Error(`Не задано значение placeholder: ${token}`);
      xml = xml.replaceAll(`{{${token}}}`, escapeXml(values[token] ?? ''));
    }
    archive.file(name, xml);
  }
  const result = Buffer.from(await archive.generateAsync({ type: 'uint8array' }));
  const check = await JSZip.loadAsync(result);
  const remaining = (
    await Promise.all(
      Object.keys(check.files)
        .filter((n) => n.startsWith('word/') && n.endsWith('.xml'))
        .map(async (n) => check.file(n)?.async('string') ?? ''),
    )
  ).join('\n');
  if (/\{\{[^{}]+\}\}/u.test(remaining))
    throw new Error('В документе остались незаполненные placeholders.');
  return result;
}

async function truncateDocxBefore(source: Buffer, marker: string): Promise<Buffer> {
  const archive = await JSZip.loadAsync(source);
  const file = archive.file('word/document.xml');
  if (!file) throw new Error('DOCX не содержит основной документ.');
  const xml = await file.async('string');
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu)];
  const match = paragraphs.find(({ 0: paragraph }) =>
    [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)]
      .map((text) => text[1])
      .join('')
      .includes(marker),
  );
  if (!match) throw new Error('Не удалось выделить правила посещения из мастер-шаблона.');
  archive.file(
    'word/document.xml',
    `${xml.slice(0, match.index)}${xml.slice(xml.indexOf('<w:sectPr', match.index))}`,
  );
  return Buffer.from(await archive.generateAsync({ type: 'uint8array' }));
}

interface EditableDocument {
  id: string;
  label: string;
  fileName: string;
  path: string;
}

interface EditableSession {
  directory: string;
  documents: EditableDocument[];
  studentId: string;
}

async function validateEditableDocx(bytes: Buffer): Promise<void> {
  if (bytes.length > 20 * 1024 * 1024)
    throw new Error('Редактируемый DOCX должен быть не больше 20 МБ.');
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('Редактируемый файл повреждён или не является DOCX.');
  }
  const document = archive.file('word/document.xml');
  if (!document) throw new Error('Редактируемый DOCX не содержит основной документ.');
  if (/\{\{[^{}]+\}\}/u.test(await document.async('string')))
    throw new Error('В редактируемом документе остались незаполненные placeholders.');
}

export class ElectronDocxConverter implements DocumentPackConverter {
  async convert(document: Buffer): Promise<Buffer> {
    const window = new BrowserWindow({
      show: false,
      width: 800,
      height: 1000,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    try {
      const url = process.env.ELECTRON_RENDERER_URL;
      if (url) await window.loadURL(`${url}/document-renderer.html`);
      else await window.loadFile(join(import.meta.dirname, '../renderer/document-renderer.html'));
      await window.webContents.executeJavaScript(
        `globalThis.renderAravaDocx(${JSON.stringify(document.toString('base64'))})`,
        true,
      );
      return await window.webContents.printToPDF({
        margins: { marginType: 'none' },
        pageSize: 'A4',
        preferCSSPageSize: true,
        printBackground: true,
      });
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  }
}

export class DocumentPackManager {
  private readonly sessions = new Map<string, EditableSession>();

  constructor(
    private readonly converter: DocumentPackConverter = new ElectronDocxConverter(),
    private readonly templateDirectory = resolveDocumentTemplateDirectory(
      app.isPackaged,
      process.resourcesPath,
    ),
    private readonly openDocument: (path: string) => Promise<string> = (path) =>
      shell.openPath(path),
  ) {}

  private async filledDocuments(
    info: StudentDocumentPackInfo,
  ): Promise<{ fileName: string; id: string; label: string; bytes: Buffer }[]> {
    if (!info.isAdult && !info.representativeName)
      throw new Error('Выберите родителя или законного представителя.');
    const contractSource = await readFile(
      join(this.templateDirectory, 'АРАВА_Договор_мастер-шаблон.docx'),
    );
    const appendixSource = await readFile(
      join(this.templateDirectory, 'АРАВА_Приложение_и_согласия_мастер-шаблон.docx'),
    );
    const contract = await fillDocxTemplate(contractSource, {
      CONTRACT_NUMBER: info.contractNumber,
      CUSTOMER_FIO: info.isAdult ? info.studentName : (info.representativeName ?? ''),
      STUDENT_FIO: info.studentName,
    });
    const appendix = await fillDocxTemplate(appendixSource, {
      PARENT_FIO: info.representativeName ?? '',
      STUDENT_FIO: info.studentName,
    });
    const documents = [
      {
        bytes: contract,
        fileName: `Договор ${info.contractNumber} ${info.studentName}.docx`,
        id: 'contract',
        label: 'Договор',
      },
      {
        bytes: info.isAdult ? await truncateDocxBefore(appendix, 'Согласие родителя') : appendix,
        fileName: `Приложение ${info.contractNumber} ${info.studentName}.docx`,
        id: 'appendix',
        label: 'Приложение и правила',
      },
      ...(info.isAdult
        ? [
            {
              bytes: await fillDocxTemplate(
                await readFile(
                  join(
                    this.templateDirectory,
                    'АРАВА_Согласия_совершеннолетнего_мастер-шаблон.docx',
                  ),
                ),
                { STUDENT_FIO: info.studentName },
              ),
              fileName: `Согласия ${info.contractNumber} ${info.studentName}.docx`,
              id: 'adult-consents',
              label: 'Согласия совершеннолетнего',
            },
          ]
        : []),
    ];
    return documents.map((document) => ({
      ...document,
      fileName: document.fileName.replaceAll(/[\\/:*?"<>|]+/gu, '_'),
    }));
  }

  private session(studentId: string, sessionId: string): EditableSession {
    const session = this.sessions.get(sessionId);
    if (session?.studentId !== studentId) throw new Error('Редактируемый документ недоступен.');
    return session;
  }

  async createEditSession(
    info: StudentDocumentPackInfo,
    studentId: string,
  ): Promise<StudentDocumentPackEditSession> {
    const directory = await mkdtemp(join(tmpdir(), 'arava-document-edit-'));
    const documents = await this.filledDocuments(info);
    const editable = await Promise.all(
      documents.map(async (document) => {
        const path = join(directory, document.fileName);
        await writeFile(path, document.bytes, { flag: 'wx' });
        return { id: document.id, label: document.label, fileName: document.fileName, path };
      }),
    );
    const id = randomUUID();
    this.sessions.set(id, { directory, documents: editable, studentId });
    return { id, parts: editable.map(({ id: partId, label }) => ({ id: partId, label })) };
  }

  async openEditable(studentId: string, sessionId: string, partId: string): Promise<void> {
    const document = this.session(studentId, sessionId).documents.find(({ id }) => id === partId);
    if (!document) throw new Error('Часть документа не найдена.');
    const error = await this.openDocument(document.path);
    if (error) throw new Error('Не удалось открыть DOCX в системном редакторе.');
  }

  async discardEditSession(studentId: string, sessionId: string): Promise<void> {
    const session = this.session(studentId, sessionId);
    this.sessions.delete(sessionId);
    await rm(session.directory, { recursive: true, force: true });
  }

  async exportDocuments(
    info: StudentDocumentPackInfo,
    studentId: string,
    sessionId?: string,
  ): Promise<{ bytes: Buffer; fileName: string }[]> {
    if (!sessionId)
      return (await this.filledDocuments(info)).map(({ bytes, fileName }) => ({ bytes, fileName }));
    const documents = await Promise.all(
      this.session(studentId, sessionId).documents.map(async ({ fileName, path }) => ({
        bytes: await readFile(path),
        fileName,
      })),
    );
    await Promise.all(documents.map(({ bytes }) => validateEditableDocx(bytes)));
    return documents;
  }

  async generate(
    info: StudentDocumentPackInfo,
    studentId?: string,
    sessionId?: string,
  ): Promise<Buffer> {
    const documents =
      sessionId && studentId
        ? await this.exportDocuments(info, studentId, sessionId)
        : (await this.filledDocuments(info)).map(({ bytes, fileName }) => ({ bytes, fileName }));
    const converted = await Promise.all(
      documents.map(({ bytes }) => this.converter.convert(bytes)),
    );
    const output = await PDFDocument.create();
    for (const bytes of converted) {
      const source = await PDFDocument.load(bytes);
      const availablePages = source.getPageIndices();
      const pages = await output.copyPages(source, availablePages);
      for (const page of pages) output.addPage(page);
    }
    return Buffer.from(await output.save());
  }
  async preview(pdf: Buffer): Promise<void> {
    const temp = await createTemporaryPdf(pdf);
    const window = new BrowserWindow({
      autoHideMenuBar: true,
      width: 1100,
      height: 900,
      title: 'Предпросмотр документов',
    });
    window.once('closed', () => void temp.release());
    await window.loadFile(temp.path);
  }
  async print(pdf: Buffer): Promise<void> {
    const temp = await createTemporaryPdf(pdf);
    const window = new BrowserWindow({ show: false });
    try {
      await window.loadFile(temp.path);
      await new Promise<void>((resolve, reject) =>
        window.webContents.print({ silent: false }, (ok, reason) =>
          ok ? resolve() : reject(new Error(reason || 'Печать отменена.')),
        ),
      );
    } finally {
      window.destroy();
      await temp.release();
    }
  }
}
