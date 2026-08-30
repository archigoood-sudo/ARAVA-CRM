import { launchElectron } from './electron-launch';
import { expect, test, type Page } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

const ownerEmail = 'owner@arava.local';
const initialPassword = 'Arava!ChangeMe1';
const ownerPassword = 'Owner!BackupsE2E2026';
const trainerPassword = 'Trainer!BackupsE2E2026';

async function login(page: Page, email: string, password: string) {
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
}

test('OWNER создаёт, проверяет и безопасно восстанавливает копию, TRAINER не имеет доступа', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(150_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('backup-user-data')}`;
  const environment = { ...process.env, ARAVA_E2E_NO_RELAUNCH: '1' };
  const application = executablePath
    ? await launchElectron({ args: [userDataArgument], env: environment, executablePath })
    : await launchElectron({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
        env: environment,
      });

  try {
    const page = await application.firstWindow();
    await login(page, ownerEmail, initialPassword);
    await page.getByLabel('Новый пароль', { exact: true }).fill(ownerPassword);
    await page.getByLabel('Повторите новый пароль').fill(ownerPassword);
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByRole('link', { name: 'Настройки' })).toBeVisible();

    const trainer = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Резервный филиал' });
      return api.users.create(token, {
        branchIds: [branch.id],
        email: 'trainer-backups-e2e@arava.local',
        fullName: 'Тренер резервных копий',
        role: 'COACH',
      });
    });

    await page.getByRole('link', { name: 'Настройки' }).click();
    await expect(page.getByRole('heading', { name: 'Резервные копии' })).toBeVisible();
    await page.getByRole('button', { name: 'Создать резервную копию' }).click();
    await expect(page.getByText(/Резервная копия создана:/u)).toBeVisible();
    const manualRow = page.getByRole('row').filter({ hasText: 'Ручная' }).first();
    await expect(manualRow).toBeVisible();
    await manualRow.getByRole('button', { name: 'Проверить' }).click();
    await expect(
      page.getByText('Резервная копия исправна и может быть восстановлена.'),
    ).toBeVisible();

    const workspace = page.getByLabel('Название пространства');
    await workspace.fill('Изменение после резервной копии');
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await expect(workspace).toHaveValue('Изменение после резервной копии');

    await manualRow.getByRole('button', { name: 'Восстановить' }).click();
    const restoreDialog = page.getByRole('dialog');
    await expect(restoreDialog.getByText('Копия проверена')).toBeVisible();
    await restoreDialog.getByLabel('Для подтверждения введите ВОССТАНОВИТЬ').fill('ВОССТАНОВИТЬ');
    await restoreDialog.getByRole('button', { name: 'Восстановить и перезапустить' }).click();
    await expect(page.getByText('Данные восстановлены. ARAVA CRM перезапускается…')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Настройки ARAVA' })).toBeVisible();
    await expect(page.getByLabel('Название пространства')).toHaveValue(
      'Рабочее пространство ARAVA',
    );
    await expect(page.getByRole('row').filter({ hasText: 'Перед восстановлением' })).toBeVisible();

    await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      if (persisted.state?.token) await api.auth.logout(persisted.state.token);
      localStorage.removeItem('arava-auth');
    });
    await page.reload();
    await login(page, trainer.user.email, trainer.temporaryPassword);
    await page.getByLabel('Новый пароль', { exact: true }).fill(trainerPassword);
    await page.getByLabel('Повторите новый пароль').fill(trainerPassword);
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByRole('link', { name: 'Настройки' })).toBeVisible();
    await page.getByRole('link', { name: 'Настройки' }).click();
    await expect(page.getByRole('heading', { name: 'Резервные копии' })).toHaveCount(0);
    const backendDenied = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      try {
        await api.backups.status(persisted.state?.token ?? '');
        return false;
      } catch {
        return true;
      }
    });
    expect(backendDenied).toBe(true);
  } finally {
    const closeProcess = application.process();
    const closePromise = application.close();
    const closed = await Promise.race([
      closePromise.then(() => true),
      new Promise<void>((resolveCloseTimeout) => {
        setTimeout(resolveCloseTimeout, 10_000);
      }).then(() => false),
    ]);
    if (!closed) closeProcess.kill('SIGKILL');
    await closePromise.catch(() => undefined);
  }
});
