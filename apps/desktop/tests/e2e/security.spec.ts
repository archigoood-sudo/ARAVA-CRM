import { _electron as electron, expect, test, type Page } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

test.use({ screenshot: 'off', trace: 'off' });

const ownerEmail = 'owner@arava.local';
const initialPassword = 'Arava!ChangeMe1';
const ownerPassword = 'Owner!Security2041';
const adminPassword = 'Admin!Security2041';
const trainerPassword = 'Trainer!Security2041';

async function login(page: Page, email: string, password: string) {
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
}

async function completeTemporaryPassword(page: Page, password: string) {
  await expect(page.getByRole('heading', { name: 'Создайте новый пароль' })).toBeVisible();
  await page.getByLabel('Новый пароль', { exact: true }).fill(password);
  await page.getByLabel('Повторите новый пароль').fill(password);
  await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByRole('heading', { name: 'Вход в ARAVA' })).toBeVisible();
}

test('роли, временные пароли, отзыв сессий и резервное восстановление владельца', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(120_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('security-user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userDataArgument], executablePath })
    : await electron.launch({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await login(page, ownerEmail, initialPassword);
    await completeTemporaryPassword(page, ownerPassword);

    await page.getByRole('link', { name: 'Филиалы' }).click();
    await page.getByRole('button', { name: 'Создать филиал' }).click();
    const branchDialog = page.getByRole('dialog');
    await branchDialog.getByLabel('Название филиала').fill('Безопасный филиал');
    await branchDialog.getByLabel('Адрес').fill('ул. Безопасная, 1');
    await branchDialog.getByLabel('Телефон').fill('+79990000011');
    await branchDialog.getByRole('button', { name: 'Создать филиал' }).click();

    await page.getByRole('link', { name: 'Сотрудники' }).click();
    await page.getByRole('button', { name: 'Добавить сотрудника' }).click();
    const adminDialog = page.getByRole('dialog');
    await adminDialog.getByLabel('Имя и фамилия').fill('Администратор E2E');
    await adminDialog.getByLabel('Электронная почта').fill('admin-e2e@arava.local');
    await adminDialog.getByLabel('Роль').selectOption({ label: 'Администратор' });
    await adminDialog.getByText('Безопасный филиал').click();
    await adminDialog.getByRole('button', { name: 'Добавить сотрудника' }).click();
    const temporaryDialog = page.getByRole('dialog');
    const adminTemporaryPassword = (await temporaryDialog.locator('code').innerText()).trim();
    await temporaryDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

    await signOut(page);
    await login(page, 'admin-e2e@arava.local', adminTemporaryPassword);
    await completeTemporaryPassword(page, adminPassword);
    await page.getByRole('link', { name: 'Сотрудники' }).click();
    await page.getByRole('button', { name: 'Добавить сотрудника' }).click();
    const trainerDialog = page.getByRole('dialog');
    await trainerDialog.getByLabel('Имя и фамилия').fill('Тренер E2E');
    await trainerDialog.getByLabel('Электронная почта').fill('trainer-e2e@arava.local');
    await trainerDialog.getByText('Безопасный филиал').click();
    await trainerDialog.getByRole('button', { name: 'Добавить сотрудника' }).click();
    const trainerTemporaryDialog = page.getByRole('dialog');
    const trainerTemporaryPassword = (
      await trainerTemporaryDialog.locator('code').innerText()
    ).trim();
    await trainerTemporaryDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

    await signOut(page);
    await login(page, 'trainer-e2e@arava.local', trainerTemporaryPassword);
    await completeTemporaryPassword(page, trainerPassword);
    await expect(page.getByRole('link', { name: 'Мои группы' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Моё расписание' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Мои ученики' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Финансы' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Сотрудники' })).toHaveCount(0);
    const trainerToken = await page.evaluate(() => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      return persisted.state?.token ?? '';
    });
    const backendDenied = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      try {
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        await api.branches.create(persisted.state?.token ?? '', {
          address: 'Недоступный адрес',
          name: 'Запрещённый филиал',
          phone: '+79990000099',
        });
        return false;
      } catch {
        return true;
      }
    });
    expect(backendDenied).toBe(true);

    await signOut(page);
    await login(page, 'admin-e2e@arava.local', adminPassword);
    await page.getByRole('link', { name: 'Сотрудники' }).click();
    const trainerRow = page.getByRole('row').filter({ hasText: 'Тренер E2E' });
    page.once('dialog', (dialog) => dialog.accept());
    await trainerRow.getByRole('button', { name: 'Сбросить пароль' }).click();
    const resetDialog = page.getByRole('dialog');
    await expect(
      resetDialog.getByText('Пароль будет показан только один раз.', { exact: false }),
    ).toBeVisible();
    const revoked = await page.evaluate(async (token) => {
      try {
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        await api.auth.restore(token);
        return false;
      } catch {
        return true;
      }
    }, trainerToken);
    expect(revoked).toBe(true);
    await expect(page.getByRole('heading', { name: 'Вход в ARAVA' })).toBeVisible();
    await login(page, ownerEmail, ownerPassword);
    await page.getByRole('link', { name: 'Настройки' }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Создать резервный код' }).click();
    const recoveryCode = (await page.locator('code').innerText()).trim();
    await page.getByRole('button', { name: 'Я сохранил код' }).click();
    await signOut(page);
    await page.getByRole('link', { name: 'Забыли пароль?' }).click();
    await page.getByLabel('Электронная почта').fill(ownerEmail);
    await page.getByLabel('Код восстановления владельца').fill(recoveryCode);
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!Recovered2041');
    await page.getByLabel('Повторите новый пароль').fill('Owner!Recovered2041');
    await page.getByRole('button', { name: 'Восстановить доступ' }).click();
    await expect(
      page.getByText('Пароль изменён. Создан новый одноразовый код восстановления.'),
    ).toBeVisible();
    const replacementCode = (await page.locator('code').innerText()).trim();
    expect(replacementCode).not.toBe(recoveryCode);
    const oldCodeRejected = await page.evaluate(
      async ({ code, email }) => {
        try {
          const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
          await api.auth.recoverOwner({
            email,
            newPassword: 'Owner!ShouldNotWork2041',
            recoveryCode: code,
          });
          return false;
        } catch {
          return true;
        }
      },
      { code: recoveryCode, email: ownerEmail },
    );
    expect(oldCodeRejected).toBe(true);
    await page.getByRole('link', { name: 'Вернуться ко входу' }).first().click();
    await login(page, ownerEmail, 'Owner!Recovered2041');
    await page.getByRole('link', { name: 'Филиалы' }).click();
    await expect(page.getByText('Безопасный филиал')).toBeVisible();
  } finally {
    await application.close();
  }
});
