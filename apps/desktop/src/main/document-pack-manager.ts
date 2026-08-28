import { app, BrowserWindow } from 'electron';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StudentDocumentPackInfo } from '@arava/shared';

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
  constructor(
    private readonly converter: DocumentPackConverter = new ElectronDocxConverter(),
    private readonly templateDirectory = resolveDocumentTemplateDirectory(
      app.isPackaged,
      process.resourcesPath,
    ),
  ) {}
  async generate(info: StudentDocumentPackInfo): Promise<Buffer> {
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
    const converted = await Promise.all([
      this.converter.convert(contract),
      this.converter.convert(appendix),
      ...(info.isAdult
        ? [
            this.converter.convert(
              await fillDocxTemplate(
                await readFile(
                  join(
                    this.templateDirectory,
                    'АРАВА_Согласия_совершеннолетнего_мастер-шаблон.docx',
                  ),
                ),
                { STUDENT_FIO: info.studentName },
              ),
            ),
          ]
        : []),
    ]);
    const output = await PDFDocument.create();
    for (const [index, bytes] of converted.entries()) {
      const source = await PDFDocument.load(bytes);
      const availablePages = source.getPageIndices();
      if (index === 0 && availablePages.length !== 6) {
        throw new Error('Неожиданная структура мастер-шаблона договора.');
      }
      if (index === 1 && availablePages.length !== 4) {
        throw new Error('Неожиданная структура мастер-шаблона приложения и согласий.');
      }
      const pages = await output.copyPages(
        source,
        index === 0
          ? availablePages.slice(0, -1)
          : info.isAdult && index === 1
            ? [0]
            : availablePages,
      );
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
