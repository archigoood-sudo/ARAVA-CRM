import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createTemporaryPdf,
  DocumentPackManager,
  fillDocxTemplate,
  resolveDocumentTemplateDirectory,
  type DocumentPackConverter,
} from './document-pack-manager';

const templates = join(process.cwd(), 'docs/document-templates/source');

async function documentXml(bytes: Buffer): Promise<string> {
  const archive = await JSZip.loadAsync(bytes);
  return (
    await Promise.all(
      Object.keys(archive.files)
        .filter((name) => name.startsWith('word/') && name.endsWith('.xml'))
        .map(async (name) => archive.file(name)?.async('string') ?? ''),
    )
  ).join('\n');
}

class PageFixtureConverter implements DocumentPackConverter {
  private call = 0;

  async convert(): Promise<Buffer> {
    const pagesPerCall = [6, 4, 2];
    const count = pagesPerCall[this.call] ?? 1;
    this.call += 1;
    const pdf = await PDFDocument.create();
    for (let index = 0; index < count; index += 1) pdf.addPage([595, 842]);
    return Buffer.from(await pdf.save());
  }
}

describe('Sprint 5.3B document pack manager', () => {
  it('fills the approved contract tokens with long Cyrillic names and leaves no placeholders', async () => {
    const source = await readFile(join(templates, 'АРАВА_Договор_мастер-шаблон.docx'));
    const studentName = 'Александрова-Воскресенская Евгения Константиновна';
    const result = await fillDocxTemplate(source, {
      CONTRACT_NUMBER: '26-0042',
      CUSTOMER_FIO: 'Михайлова-Преображенская Анна Александровна',
      STUDENT_FIO: studentName,
    });
    const xml = await documentXml(result);
    expect(xml).toContain('26-0042');
    expect(xml).toContain(studentName);
    expect(xml).not.toMatch(/\{\{[^{}]+\}\}/u);
  });

  it('rejects an unknown placeholder before producing a document', async () => {
    const archive = new JSZip();
    archive.file('word/document.xml', '<w:t>{{PASSPORT_NUMBER}}</w:t>');
    const source = Buffer.from(await archive.generateAsync({ type: 'uint8array' }));
    await expect(fillDocxTemplate(source, {})).rejects.toThrow(
      'Неизвестный placeholder: PASSPORT_NUMBER',
    );
  });

  it('builds child and adult packs from the approved template combinations', async () => {
    const child = await new DocumentPackManager(new PageFixtureConverter(), templates).generate({
      contractNumber: '26-0001',
      isAdult: false,
      parts: [],
      representativeName: 'Анна Документова',
      studentName: 'Лев Документов',
    });
    const adult = await new DocumentPackManager(new PageFixtureConverter(), templates).generate({
      contractNumber: '26-0002',
      isAdult: true,
      parts: [],
      studentName: 'Мария Совершеннолетняя',
    });
    expect((await PDFDocument.load(child)).getPageCount()).toBe(10);
    expect((await PDFDocument.load(adult)).getPageCount()).toBe(12);
  });

  it('keeps master templates immutable while editing and renders the saved working DOCX', async () => {
    const contractPath = join(templates, 'АРАВА_Договор_мастер-шаблон.docx');
    const before = createHash('sha256')
      .update(await readFile(contractPath))
      .digest('hex');
    const convertedDocuments: Buffer[] = [];
    let openedPath = '';
    const manager = new DocumentPackManager(
      {
        convert: async (document) => {
          convertedDocuments.push(document);
          const pdf = await PDFDocument.create();
          pdf.addPage([595, 842]);
          return Buffer.from(await pdf.save());
        },
      },
      templates,
      (path) => {
        openedPath = path;
        return Promise.resolve('');
      },
    );
    const info = {
      contractNumber: '26-0042',
      isAdult: true,
      parts: [],
      studentName: 'Иванов Иван',
    };
    const session = await manager.createEditSession(info, 'student-1');
    await manager.openEditable('student-1', session.id, 'contract');
    const exported = await manager.exportDocuments(info, 'student-1', session.id);
    const contract = exported.find(({ fileName }) => fileName.startsWith('Договор'));
    expect(contract).toBeDefined();
    const archive = await JSZip.loadAsync(contract?.bytes ?? Buffer.alloc(0));
    const document = archive.file('word/document.xml');
    const xml = (await document?.async('string')) ?? '';
    archive.file('word/document.xml', xml.replace('Иванов Иван', 'Иванов Иван (исправлено)'));
    const edited = Buffer.from(await archive.generateAsync({ type: 'uint8array' }));
    await writeFile(openedPath, edited);
    await manager.generate(info, 'student-1', session.id);
    expect(await documentXml(convertedDocuments[0] ?? Buffer.alloc(0))).toContain('исправлено');
    expect(
      createHash('sha256')
        .update(await readFile(contractPath))
        .digest('hex'),
    ).toBe(before);
    await manager.discardEditSession('student-1', session.id);
    await expect(manager.exportDocuments(info, 'student-1', session.id)).rejects.toThrow(
      'Редактируемый документ недоступен',
    );
  });

  it('keeps all approved masters on A4 and rejects damaged edited files', async () => {
    for (const name of [
      'АРАВА_Договор_мастер-шаблон.docx',
      'АРАВА_Приложение_и_согласия_мастер-шаблон.docx',
      'АРАВА_Согласия_совершеннолетнего_мастер-шаблон.docx',
    ]) {
      expect(await documentXml(await readFile(join(templates, name)))).toMatch(
        /<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/u,
      );
    }
    let openedPath = '';
    const manager = new DocumentPackManager(new PageFixtureConverter(), templates, (path) => {
      openedPath = path;
      return Promise.resolve('');
    });
    const info = {
      contractNumber: '26-0004',
      isAdult: true,
      parts: [],
      studentName: 'Тест Тестов',
    };
    const session = await manager.createEditSession(info, 'student-1');
    await manager.openEditable('student-1', session.id, 'contract');
    await writeFile(openedPath, Buffer.from('not-a-docx'));
    await expect(manager.generate(info, 'student-1', session.id)).rejects.toThrow(
      'повреждён или не является DOCX',
    );
  });

  it('requires a representative for a child pack', async () => {
    await expect(
      new DocumentPackManager(new PageFixtureConverter(), templates).generate({
        contractNumber: '26-0003',
        isAdult: false,
        parts: [],
        studentName: 'Лев Документов',
      }),
    ).rejects.toThrow('Выберите родителя или законного представителя.');
  });

  it('resolves dev and packaged template directories and cleans temporary PDFs', async () => {
    expect(resolveDocumentTemplateDirectory(true, '/Applications/ARAVA/Resources', '/main')).toBe(
      '/Applications/ARAVA/Resources/document-templates',
    );
    expect(resolveDocumentTemplateDirectory(false, '/unused', '/repo/apps/desktop/out/main')).toBe(
      '/repo/docs/document-templates/source',
    );
    const temporary = await createTemporaryPdf(Buffer.from('%PDF-test'));
    await expect(access(temporary.path)).resolves.toBeUndefined();
    await temporary.release();
    await expect(access(temporary.path)).rejects.toThrow();
  });
});
