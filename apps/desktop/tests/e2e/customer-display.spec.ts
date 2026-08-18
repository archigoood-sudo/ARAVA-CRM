import { _electron as electron, expect, test, type Page } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

const initialPassword = 'Arava!ChangeMe1';
const ownerPassword = 'Owner!DisplayE2E2026';

async function login(page: Page) {
  await page.getByLabel('Электронная почта').fill('owner@arava.local');
  await page.getByLabel('Пароль', { exact: true }).fill(initialPassword);
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await page.getByLabel('Новый пароль', { exact: true }).fill(ownerPassword);
  await page.getByLabel('Повторите новый пароль').fill(ownerPassword);
  await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
  await expect(
    page.getByRole('heading', {
      name: /(Доброе утро|Добрый день|Добрый вечер|Доброй ночи), Владелец/u,
    }),
  ).toBeVisible();
}

async function scan(page: Page, barcode: string) {
  await page.keyboard.type(barcode, { delay: 1 });
  await page.keyboard.press('Enter');
}

test('предпросмотр экрана клиента получает безопасные данные из глобального сканера', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('customer-display-user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userDataArgument], executablePath })
    : await electron.launch({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await login(page);
    const fixtures = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Филиал экрана' });
      const first = await api.students.create(token, {
        branchId: branch.id,
        email: 'private-a@example.test',
        firstName: 'Анна',
        lastName: 'Секретова',
        phone: '+79990000001',
        status: 'ACTIVE',
      });
      const second = await api.students.create(token, {
        branchId: branch.id,
        email: 'private-b@example.test',
        firstName: 'Борис',
        lastName: 'Закрытов',
        phone: '+79990000002',
        status: 'ACTIVE',
      });
      await api.cards.assign(token, {
        barcode: '0000094301',
        registerIfUnknown: true,
        studentId: first.id,
      });
      await api.cards.assign(token, {
        barcode: '0000094302',
        registerIfUnknown: true,
        studentId: second.id,
      });
      await api.customerDisplay.updateSettings(token, {
        customerSeconds: 3,
        enabled: true,
        fullscreen: true,
        showLastName: false,
        slideSeconds: 8,
      });
      return { firstId: first.id, secondId: second.id };
    });

    await page.getByRole('link', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Экран клиента' })).toBeVisible();
    const displayWindowPromise = application.waitForEvent('window');
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const display = await displayWindowPromise;
    await expect(display).toHaveTitle('ARAVA — Экран клиента');
    await expect(display.getByRole('heading', { name: 'ARAVA' })).toBeVisible();

    await scan(page, '0000094301');
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixtures.firstId}\\?openedByCard=1$`, 'u'),
    );
    await expect(display.getByRole('heading', { name: 'Анна!' })).toBeVisible();
    await expect(display.getByText('Нет активного абонемента')).toBeVisible();
    for (const sensitive of [
      '+79990000001',
      'private-a@example.test',
      'Секретова',
      '0000094301',
      'задолженность',
    ])
      await expect(display.getByText(sensitive, { exact: false })).toHaveCount(0);

    await scan(page, '0000094302');
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixtures.secondId}\\?openedByCard=1$`, 'u'),
    );
    await expect(display.getByRole('heading', { name: 'Борис!' })).toBeVisible();
    await expect(display.getByRole('heading', { name: 'ARAVA' })).toBeVisible({ timeout: 6_000 });

    await scan(page, '0000094302');
    await expect(display.getByRole('heading', { name: 'Борис!' })).toBeVisible();
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(display.getByRole('heading', { name: 'ARAVA' })).toBeVisible();
    await expect(display.getByText('Борис', { exact: false })).toHaveCount(0);
  } finally {
    await application.close();
  }
});
