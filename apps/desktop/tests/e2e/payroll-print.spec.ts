import { expect, test } from '@playwright/test';
import { createDatabaseClient, toSqliteUrl } from '@arava/database';
import type { AravaDesktopApi } from '@arava/shared';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { launchElectron } from './electron-launch';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required PDF test value is missing');
  return value;
}

// Read the embedded Chromium font maps, not a screenshot or the source HTML.
async function pdfText(
  bytes: Buffer,
): Promise<{ texts: string[]; sizes: { width: number; height: number }[] }> {
  const pdf = await PDFDocument.load(bytes);
  const texts = pdf.getPages().map((page) => {
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    const maps = new Map<string, Map<number, string>>();
    for (const [key, ref] of fonts?.entries() ?? []) {
      const font = pdf.context.lookup(ref, PDFDict);
      const stream = font.lookup(PDFName.of('ToUnicode'));
      if (!(stream instanceof PDFRawStream)) continue;
      const cmap = Buffer.from(decodePDFRawStream(stream).decode()).toString();
      const map = new Map<number, string>();
      const unicode = (hex: string) =>
        (hex.match(/.{4}/gu) ?? []).map((part) => String.fromCharCode(parseInt(part, 16))).join('');
      for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/gu))
        for (const pair of required(block[1]).matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/giu))
          map.set(parseInt(required(pair[1]), 16), unicode(required(pair[2])));
      for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/gu))
        for (const range of required(block[1]).matchAll(
          /<([\da-f]+)>\s*<([\da-f]+)>\s*<([\da-f]+)>/giu,
        ))
          for (
            let code = parseInt(required(range[1]), 16);
            code <= parseInt(required(range[2]), 16);
            code++
          )
            map.set(
              code,
              String.fromCharCode(
                parseInt(required(range[3]), 16) + code - parseInt(required(range[1]), 16),
              ),
            );
      maps.set(key.asString().slice(1), map);
    }
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents
            .asArray()
            .map((ref) => pdf.context.lookup(ref))
            .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
        : contents instanceof PDFRawStream
          ? [contents]
          : [];
    let current = '';
    let text = '';
    for (const stream of streams) {
      const commands = Buffer.from(decodePDFRawStream(stream).decode()).toString();
      for (const match of commands.matchAll(/\/([^\s]+)\s+[\d.-]+\s+Tf|<([\da-f]+)>/giu)) {
        if (match[1]) current = match[1];
        else
          for (const hex of match[2]?.match(/.{4}/gu) ?? [])
            text += maps.get(current)?.get(parseInt(hex, 16)) ?? '';
      }
    }
    return text.replaceAll('\u00a0', ' ');
  });
  return { texts, sizes: pdf.getPages().map((page) => page.getSize()) };
}

test('payroll PDF is isolated A4, repeats headers, retains actual dates and immutable snapshot', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(180000);
  const userData = testInfo.outputPath('payroll-print-data');
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const application = await launchElectron(
    executablePath
      ? { executablePath, args: [`--user-data-dir=${userData}`] }
      : { cwd: resolve(import.meta.dirname, '../..'), args: ['.', `--user-data-dir=${userData}`] },
  );
  const database = createDatabaseClient(toSqliteUrl(join(userData, 'arava.db')));
  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!PayrollPrint2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!PayrollPrint2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    const context = await page.evaluate(async () => {
      const token =
        (JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as { state?: { token?: string } })
          .state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Филиал печати' });
      const trainer = await api.users.create(token, {
        branchIds: [branch.id],
        email: 'pdf-coach@arava.local',
        fullName: 'Сохранённый Заменяющий',
        role: 'COACH',
      });
      return {
        token,
        branchId: branch.id,
        trainerId: trainer.user.id,
        trainerName: trainer.user.fullName,
      };
    });
    const owner = await database.user.findFirstOrThrow({ where: { role: 'OWNER' } });
    const group = await database.danceGroup.create({
      data: {
        branchId: context.branchId,
        name: 'Хореография',
        capacity: 20,
        direction: 'Танцы',
        status: 'ACTIVE',
      },
    });
    const lesson = await database.lesson.create({
      data: {
        branchId: context.branchId,
        groupId: group.id,
        startsAt: new Date('2026-08-01T10:00:00Z'),
        endsAt: new Date('2026-08-01T11:00:00Z'),
        coachId: owner.id,
        status: 'COMPLETED',
      },
    });
    async function seed(count: number, status: 'CALCULATED' | 'APPROVED', sequence: number) {
      const period = await database.payrollPeriod.create({
        data: {
          branchId: context.branchId,
          createdByUserId: owner.id,
          trainerId: context.trainerId,
          trainerName: context.trainerName,
          dateFrom: new Date('2026-08-01'),
          dateTo: new Date('2026-12-31'),
          status,
          sheetNumber: `ЗП-2026-${String(sequence).padStart(4, '0')}`,
        },
      });
      // Each fixture row models a distinct canonical lesson, including one manual substitution.
      for (let index = 0; index < count; index++) {
        const startsAt = new Date(Date.UTC(2026, 7, 1 + index, 10));
        const item =
          index === 0
            ? lesson
            : await database.lesson.upsert({
                where: { groupId_startsAt: { groupId: group.id, startsAt } },
                update: {},
                create: {
                  branchId: context.branchId,
                  groupId: group.id,
                  startsAt,
                  endsAt: new Date(startsAt.getTime() + 3600000),
                  status: 'COMPLETED',
                },
              });
        await database.payrollAccrual.create({
          data: {
            payrollPeriodId: period.id,
            coachId: context.trainerId,
            branchId: context.branchId,
            groupId: group.id,
            lessonId: item.id,
            lessonStartsAtSnapshot: startsAt,
            groupNameSnapshot: group.name,
            branchNameSnapshot: 'Филиал печати',
            type: 'FIXED_PER_LESSON',
            payoutCategory: index === 0 ? 'SUBSTITUTION' : 'REGULAR_ATTENDANCE',
            payoutMode: 'FIXED_PER_LESSON',
            payoutAmount: 50000,
            baseAmount: 50000,
            calculatedAmount: 50000,
            finalAmount: 50000,
            attendeeCount: 8,
            ...(index === 0
              ? { manualAddedAt: new Date(), manualAdditionReason: 'Подтверждённая замена' }
              : {}),
          },
        });
      }
      return period.id;
    }
    async function generate(id: string) {
      const result = await page.evaluate(
        async ({ token, id }) =>
          (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava.payroll.document(
            token,
            id,
            'data',
          ),
        { token: context.token, id },
      );
      expect(result.status).toBe('READY');
      return Buffer.from(required(result.pdfBase64), 'base64');
    }
    const normalId = await seed(24, 'CALCULATED', 1);
    const normal = await generate(normalId);
    await writeFile(testInfo.outputPath('payroll-normal.pdf'), normal);
    const normalText = await pdfText(normal);
    expect(normalText.texts).toHaveLength(1);
    expect(required(normalText.sizes[0]).width).toBeCloseTo(595.28, 0);
    expect(required(normalText.sizes[0]).height).toBeCloseTo(841.89, 0);
    for (let day = 1; day <= 24; day++)
      expect(normalText.texts[0]).toContain(`${String(day).padStart(2, '0')}.08.2026`);
    expect(normalText.texts[0]).toMatch(/Добавлено\s*вручную/u);
    expect(normalText.texts[0]).toContain('Сохранённый Заменяющий');
    expect(normalText.texts[0]).toContain('Подпись руководителя');
    expect(normalText.texts[0]).toContain('Подпись сотрудника');
    expect(normalText.texts[0]).not.toMatch(
      /Настройки|Диагностика|Добавить занятие|Отменить расчёт/u,
    );
    const longId = await seed(100, 'APPROVED', 2);
    const long = await generate(longId);
    await writeFile(testInfo.outputPath('payroll-long.pdf'), long);
    const longText = await pdfText(long);
    expect(longText.texts.length).toBeGreaterThan(1);
    for (const [index, text] of longText.texts.entries()) {
      expect(text).toContain(`Страница ${String(index + 1)} из ${String(longText.texts.length)}`);
      expect(text).toContain('Дата');
      expect(text).toContain('Группа');
      expect(text).toContain('Ставка');
    }
    for (let index = 0; index < 100; index++)
      expect(longText.texts.join('')).toContain(
        new Intl.DateTimeFormat('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(new Date(Date.UTC(2026, 7, index + 1, 10))),
      );
    await database.lesson.update({
      where: { id: lesson.id },
      data: { startsAt: new Date('2030-01-01'), coachId: null },
    });
    await database.danceGroup.update({ where: { id: group.id }, data: { name: 'Новое название' } });
    await database.user.update({
      where: { id: context.trainerId },
      data: { fullName: 'Новое имя' },
    });
    const before = await database.syncOutbox.count();
    expect((await pdfText(await generate(longId))).texts).toEqual(longText.texts);
    expect(await database.syncOutbox.count()).toBe(before);
  } finally {
    await database.$disconnect();
    await application.close();
  }
});
