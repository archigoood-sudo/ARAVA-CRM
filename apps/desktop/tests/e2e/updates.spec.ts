import { launchElectron } from './electron-launch';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('показывает безопасное состояние обновлений через desktop IPC', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('updates-user-data')}`;
  const application = executablePath
    ? await launchElectron({ args: [userDataArgument], executablePath })
    : await launchElectron({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!UpdatesE2E2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!UpdatesE2E2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await page.getByRole('link', { name: 'О программе' }).click();

    await expect(page.getByText('Обновления приложения')).toBeVisible();
    await expect(
      page.getByText(
        executablePath
          ? 'Автоматическая установка на macOS недоступна. Установите новую версию вручную.'
          : 'Автоматическое обновление доступно в установленной версии для Windows и macOS',
      ),
    ).toBeVisible();
    await expect(page.getByText(/Обновления автоматически проверяются/)).toBeVisible();
    await expect(page.getByText(/token|\.exe|app-update\.yml/iu)).toHaveCount(0);
  } finally {
    await application.close();
  }
});
