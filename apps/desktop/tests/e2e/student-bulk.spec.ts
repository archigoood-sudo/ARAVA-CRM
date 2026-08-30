import { launchElectron } from './electron-launch';
import { expect, test, type Page } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

const ownerPassword = 'Owner!BulkE2E2026';

async function login(page: Page) {
  await page.getByLabel('Электронная почта').fill('owner@arava.local');
  await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await page.getByLabel('Новый пароль', { exact: true }).fill(ownerPassword);
  await page.getByLabel('Повторите новый пароль').fill(ownerPassword);
  await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
  await expect(page.getByRole('link', { name: 'Ученики', exact: true })).toBeVisible();
}

test('массовый выбор добавляет и переводит двух учеников без дублей', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 180_000 : 120_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('student-bulk-user-data')}`;
  const application = executablePath
    ? await launchElectron({ args: [userDataArgument], executablePath })
    : await launchElectron({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await login(page);
    const fixture = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Массовые операции E2E' });
      const source = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 10,
        direction: 'Хип-хоп',
        name: 'Bulk группа A',
        status: 'ACTIVE',
      });
      const target = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 10,
        direction: 'Хип-хоп',
        name: 'Bulk группа B',
        status: 'RECRUITING',
      });
      const students = await Promise.all([
        api.students.create(token, {
          branchId: branch.id,
          firstName: 'АлисаBulk',
          lastName: 'Иванова',
          status: 'ACTIVE',
        }),
        api.students.create(token, {
          branchId: branch.id,
          firstName: 'БорисBulk',
          lastName: 'Петров',
          status: 'ACTIVE',
        }),
      ]);
      return { sourceId: source.id, studentIds: students.map(({ id }) => id), targetId: target.id };
    });

    await page.getByRole('link', { name: 'Ученики', exact: true }).click();
    await page.getByRole('button', { name: 'Выбрать', exact: true }).click();
    const search = page.getByLabel('Поиск учеников');
    await search.fill('АлисаBulk');
    await page.getByLabel('Выбрать Иванова АлисаBulk').check();
    await expect(page.getByText('Выбрано: 1')).toBeVisible();
    await search.fill('БорисBulk');
    await page.getByLabel('Выбрать Петров БорисBulk').check();
    await expect(page.getByText('Выбрано: 2')).toBeVisible();
    await expect(page.getByText('Скрыто текущими фильтрами: 1')).toBeVisible();
    await page.getByRole('button', { name: 'Добавить в группу', exact: true }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByLabel('Группа').selectOption(fixture.sourceId);
    await addDialog.getByRole('button', { name: 'Проверить изменения' }).click();
    await expect(addDialog.getByText('Будет изменено: 2')).toBeVisible();
    await addDialog.getByRole('button', { name: 'Добавить 2 учеников' }).click();
    await expect(page.getByText('В группу добавлено 2 учеников.')).toBeVisible();

    const afterAdd = await page.evaluate(async ({ sourceId, studentIds }) => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const group = await api.groups.get(persisted.state?.token ?? '', sourceId);
      return studentIds.map(
        (studentId) => group.participants.filter((item) => item.studentId === studentId).length,
      );
    }, fixture);
    expect(afterAdd).toEqual([1, 1]);

    await search.fill('');
    await page.getByRole('button', { name: 'Выбрать', exact: true }).click();
    await page.getByLabel('Выбрать Иванова АлисаBulk').check();
    await page.getByLabel('Выбрать Петров БорисBulk').check();
    await page.getByRole('button', { name: 'Перевести', exact: true }).click();
    const moveDialog = page.getByRole('dialog');
    await moveDialog.getByLabel('Исходная группа').selectOption(fixture.sourceId);
    await moveDialog.getByLabel('Целевая группа').selectOption(fixture.targetId);
    await moveDialog.getByRole('button', { name: 'Проверить изменения' }).click();
    await expect(moveDialog.getByText('Будет изменено: 2')).toBeVisible();
    await moveDialog.getByRole('button', { name: 'Перевести 2 учеников' }).click();
    await expect(page.getByText('В другую группу переведено 2 учеников.')).toBeVisible();

    const afterMove = await page.evaluate(async ({ sourceId, studentIds, targetId }) => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const [source, target] = await Promise.all([
        api.groups.get(persisted.state?.token ?? '', sourceId),
        api.groups.get(persisted.state?.token ?? '', targetId),
      ]);
      return studentIds.map((studentId) => ({
        activeTarget: target.participants.filter(
          (item) => item.studentId === studentId && item.status !== 'LEFT' && !item.leftAt,
        ).length,
        historicalSource: source.participants.filter(
          (item) => item.studentId === studentId && item.status === 'LEFT' && Boolean(item.leftAt),
        ).length,
      }));
    }, fixture);
    expect(afterMove).toEqual([
      { activeTarget: 1, historicalSource: 1 },
      { activeTarget: 1, historicalSource: 1 },
    ]);
  } finally {
    await application.close();
  }
});
