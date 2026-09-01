import { launchElectron } from './electron-launch';
import { expect, test, type Page } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

async function initialOwnerLogin(page: Page) {
  await page.getByLabel('Электронная почта').fill('owner@arava.local');
  await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!TrainerE2E2026');
  await page.getByLabel('Повторите новый пароль').fill('Owner!TrainerE2E2026');
  await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
  await expect(page.getByRole('link', { name: 'Главная', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

test('профиль тренера открывается из сотрудников и поиска, а тренер видит только себя', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 300_000 : 180_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('trainer-profile-user-data')}`;
  const application = executablePath
    ? await launchElectron({ args: [userDataArgument], executablePath })
    : await launchElectron({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await initialOwnerLogin(page);
    const created = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Филиал тренеров E2E' });
      const trainerA = await api.users.create(token, {
        branchIds: [branch.id],
        email: 'trainer-a-e2e@arava.local',
        fullName: 'Алексей Профильный',
        role: 'COACH',
      });
      const trainerB = await api.users.create(token, {
        branchIds: [branch.id],
        email: 'trainer-b-e2e@arava.local',
        fullName: 'Борис Закрытый',
        role: 'COACH',
      });
      return {
        temporaryPassword: trainerA.temporaryPassword,
        trainerA: trainerA.user,
        trainerB: trainerB.user,
      };
    });

    await page.getByRole('link', { name: 'Сотрудники' }).click();
    await page
      .getByRole('link', { name: `Открыть профиль тренера ${created.trainerA.fullName}` })
      .click();
    await expect(page.getByRole('heading', { name: created.trainerA.fullName })).toBeVisible();
    await expect(page.getByText('Группы', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Расписание', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Посещаемость', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Зарплата' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Выплаты тренеру' })).toBeVisible();
    await page.getByRole('button', { name: 'Настроить' }).click();
    const payoutDialog = page.getByRole('dialog', { name: 'Выплаты тренеру' });
    await payoutDialog.getByLabel('Расчёт').first().selectOption('FIXED_PER_ATTENDANCE');
    await payoutDialog.getByLabel('Сумма, ₽').fill('150');
    await payoutDialog.getByRole('button', { name: 'Сохранить версию' }).click();
    await expect(page.getByText('Фиксировано за посещение')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сбросить пароль' })).toBeVisible();

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const search = page.getByRole('region', { name: 'Глобальный поиск' });
    await search.getByLabel('Поиск по приложению').fill('Алексей Профильный');
    await search.getByText('Алексей Профильный').click();
    await expect(page).toHaveURL(new RegExp(`/trainers/${created.trainerA.id}$`, 'u'));

    await page.getByLabel('Выйти', { exact: true }).click();
    await page.getByLabel('Электронная почта').fill(created.trainerA.email);
    await page.getByLabel('Пароль', { exact: true }).fill(created.temporaryPassword);
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Trainer!SelfE2E2026');
    await page.getByLabel('Повторите новый пароль').fill('Trainer!SelfE2E2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await page.getByRole('link', { name: 'Мой профиль' }).click();
    await expect(page.getByRole('heading', { name: created.trainerA.fullName })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сбросить пароль' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Выплаты тренеру' })).toHaveCount(0);
    await page.evaluate((trainerId) => {
      (globalThis as typeof globalThis & { location: { hash: string } }).location.hash =
        `/trainers/${trainerId}`;
    }, created.trainerB.id);
    await expect(page.getByText('Профиль недоступен')).toBeVisible();
  } finally {
    await application.close();
  }
});
