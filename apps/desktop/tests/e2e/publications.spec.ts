import { launchElectron } from './electron-launch';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('OWNER создаёт и публикует новость без сети', async ({ request: _request }, testInfo) => {
  test.setTimeout(120_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const args = [`--user-data-dir=${testInfo.outputPath('publication-user-data')}`];
  const application = executablePath
    ? await launchElectron({ args, executablePath })
    : await launchElectron({ args: ['.', ...args], cwd: resolve(import.meta.dirname, '../..') });
  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!PublicationE2E2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!PublicationE2E2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await page.getByRole('link', { name: 'Публикации' }).click();
    await page.getByRole('button', { name: 'Создать публикацию' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input').first().fill('Новость E2E');
    await dialog.locator('textarea').fill('Материал для личного кабинета.');
    await dialog.getByRole('button', { name: 'Сохранить черновик' }).click();
    await expect(page.getByText('Новость E2E')).toBeVisible();
    await expect(page.getByText('Черновик', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(page.getByText('Ожидает отправки')).toBeVisible();
  } finally {
    await application.close();
  }
});
