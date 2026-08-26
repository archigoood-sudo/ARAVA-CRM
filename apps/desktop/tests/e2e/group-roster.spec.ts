import { _electron as electron, expect, test, type Page } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

const ownerPassword = 'Owner!RosterE2E2026';

function shiftedLocalDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

async function login(page: Page) {
  await page.getByLabel('Электронная почта').fill('owner@arava.local');
  await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await page.getByLabel('Новый пароль', { exact: true }).fill(ownerPassword);
  await page.getByLabel('Повторите новый пароль').fill(ownerPassword);
  await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
  await expect(page.getByRole('link', { name: 'Группы', exact: true })).toBeVisible();
}

test('профиль группы показывает состав и выполняет массовое добавление и перевод', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 180_000 : 120_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('group-roster-user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userDataArgument], executablePath })
    : await electron.launch({
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
      const branch = await api.branches.create(token, { name: 'Состав группы E2E' });
      const source = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 3,
        direction: 'Хип-хоп',
        name: 'Roster группа A',
        status: 'ACTIVE',
      });
      const target = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 3,
        direction: 'Хип-хоп',
        name: 'Roster группа B',
        status: 'RECRUITING',
      });
      const students = await Promise.all([
        api.students.create(token, {
          branchId: branch.id,
          firstName: 'АннаRoster',
          lastName: 'Иванова',
          status: 'ACTIVE',
        }),
        api.students.create(token, {
          branchId: branch.id,
          firstName: 'БорисRoster',
          lastName: 'Петров',
          status: 'ACTIVE',
        }),
      ]);
      return { sourceId: source.id, studentIds: students.map(({ id }) => id), targetId: target.id };
    });

    await page.getByRole('link', { name: 'Группы', exact: true }).click();
    await page
      .locator('article')
      .filter({ hasText: 'Roster группа A' })
      .getByRole('button', { name: 'Действия' })
      .click();
    await expect(page.getByRole('heading', { name: 'Roster группа A' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Состав', exact: true })).toBeVisible();
    await expect(page.getByText('свободных мест')).toBeVisible();
    await expect(page.getByText('0 из 3')).toBeVisible();

    await page.getByRole('button', { name: 'Добавить учеников' }).first().click();
    const selection = page.getByRole('dialog', { name: 'Добавить учеников' });
    await selection.getByLabel('Поиск учеников для добавления').fill('Roster');
    await selection.getByText('Выбрать найденных: 2').click();
    await selection.getByRole('button', { name: 'Продолжить' }).click();
    const addDialog = page.getByRole('dialog', { name: 'Добавить в группу' });
    await addDialog.getByLabel('Дата изменения').fill(shiftedLocalDate(-2));
    await addDialog.getByRole('button', { name: 'Проверить изменения' }).click();
    await expect(addDialog.getByText('Будет изменено: 2')).toBeVisible();
    await addDialog.getByRole('button', { name: 'Добавить 2 учеников' }).click();
    await expect(page.getByText('Готово. Изменено учеников: 2.')).toBeVisible();
    await expect(page.getByText('Иванова АннаRoster')).toBeVisible();
    await expect(page.getByText('Петров БорисRoster')).toBeVisible();
    await expect(page.getByText('2 из 3')).toBeVisible();

    const search = page.getByLabel('Поиск по составу группы');
    await search.fill('АннаRoster');
    await expect(page.getByText('Иванова АннаRoster')).toBeVisible();
    await expect(page.getByText('Петров БорисRoster')).toBeHidden();
    await expect(page).toHaveURL(/q=%D0%90%D0%BD%D0%BD%D0%B0Roster/);
    await page.getByText('Иванова АннаRoster').click();
    await expect(page.getByRole('heading', { name: 'Иванова АннаRoster' })).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('Поиск по составу группы')).toHaveValue('АннаRoster');
    await search.fill('');

    await page.getByRole('button', { name: 'Выбрать', exact: true }).click();
    await page.getByRole('button', { name: 'Выбрать видимых' }).click();
    await expect(page.getByText('Выбрано: 2')).toBeVisible();
    await page.getByRole('button', { name: 'Перевести', exact: true }).click();
    const moveDialog = page.getByRole('dialog', { name: 'Перевести в другую группу' });
    await moveDialog.getByLabel('Целевая группа').selectOption(fixture.targetId);
    await moveDialog.getByLabel('Дата изменения').fill(shiftedLocalDate(-1));
    await moveDialog.getByRole('button', { name: 'Проверить изменения' }).click();
    await expect(moveDialog.getByText('Будет изменено: 2')).toBeVisible();
    await moveDialog.getByRole('button', { name: 'Перевести 2 учеников' }).click();
    await expect(page.getByText('Готово. Изменено учеников: 2.')).toBeVisible();
    await expect(page.getByText('Иванова АннаRoster')).toBeHidden();

    const history = await page.evaluate(async ({ sourceId, targetId }) => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const token = persisted.state?.token ?? '';
      const [source, target] = await Promise.all([
        api.groups.get(token, sourceId),
        api.groups.get(token, targetId),
      ]);
      return {
        sourceHistory: source.participants.filter(
          (item) => item.studentName.includes('Roster') && item.status === 'LEFT' && item.leftAt,
        ).length,
        targetCurrent: target.participants.filter(
          (item) => item.studentName.includes('Roster') && item.status !== 'LEFT' && !item.leftAt,
        ).length,
      };
    }, fixture);
    expect(history).toEqual({ sourceHistory: 2, targetCurrent: 2 });
  } finally {
    await application.close();
  }
});
