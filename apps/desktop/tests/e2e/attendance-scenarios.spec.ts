import { expect, test, type ElectronApplication } from '@playwright/test';
import { resolve } from 'node:path';

import { launchElectron } from './electron-launch';

async function closeApplication(application: ElectronApplication): Promise<void> {
  const process = application.process();
  const closed = await Promise.race([
    application.close().then(() => true),
    new Promise<boolean>((resolveCloseTimeout) =>
      setTimeout(() => resolveCloseTimeout(false), 10_000),
    ),
  ]);
  if (!closed) process.kill('SIGKILL');
  await application.close().catch(() => undefined);
}

test('OWNER changes attendance scenarios and the setting survives restart', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 90_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('user-data')}`;
  const launch = () =>
    executablePath
      ? launchElectron({ args: [userDataArgument], executablePath })
      : launchElectron({
          args: ['.', userDataArgument],
          cwd: resolve(import.meta.dirname, '../..'),
        });
  let application = await launch();
  try {
    let window = await application.firstWindow();
    await window.getByLabel('Электронная почта').fill('owner@arava.local');
    await window.getByLabel('Пароль').fill('Arava!ChangeMe1');
    await window.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await window.getByLabel('Новый пароль', { exact: true }).fill('Owner!Secure2026');
    await window.getByLabel('Повторите новый пароль').fill('Owner!Secure2026');
    await window.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await window.getByRole('link', { name: 'Настройки' }).click();
    await expect(window.getByRole('heading', { name: 'Сценарии посещаемости' })).toBeVisible();
    const absentDeduction = window.getByRole('switch', {
      name: 'Отсутствовал: списывать с абонемента',
    });
    await expect(absentDeduction).toHaveAttribute('aria-checked', 'true');
    await absentDeduction.click();
    await expect(absentDeduction).toHaveAttribute('aria-checked', 'false');

    await closeApplication(application);
    application = await launch();
    window = await application.firstWindow();
    const email = window.getByLabel('Электронная почта');
    if (await email.isVisible()) {
      await email.fill('owner@arava.local');
      await window.getByLabel('Пароль').fill('Owner!Secure2026');
      await window.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    }
    await window.getByRole('link', { name: 'Настройки' }).click();
    await expect(
      window.getByRole('switch', { name: 'Отсутствовал: списывать с абонемента' }),
    ).toHaveAttribute('aria-checked', 'false');
  } finally {
    await closeApplication(application);
  }
});
