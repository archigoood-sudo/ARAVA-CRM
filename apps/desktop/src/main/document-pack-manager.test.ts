import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { access, readFile } from 'node:fs/promises';
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
    expect((await PDFDocument.load(child)).getPageCount()).toBe(9);
    expect((await PDFDocument.load(adult)).getPageCount()).toBe(8);
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
