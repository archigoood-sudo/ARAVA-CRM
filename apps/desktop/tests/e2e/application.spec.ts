import { _electron as electron, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('starts securely and completes the local sign-in flow', async ({
  request: _request,
}, testInfo) => {
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userDataArgument], executablePath })
    : await electron.launch({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const window = await application.firstWindow();
    await expect(window).toHaveTitle('ARAVA CRM');
    await expect.poll(() => window.evaluate(() => Object.hasOwn(globalThis, 'arava'))).toBe(true);
    await expect(window.getByRole('heading', { name: 'Sign in to ARAVA' })).toBeVisible();

    await window.getByLabel('Email address').fill('owner@arava.app');
    await window.getByLabel('Password').fill('commercial-foundation');
    await window.getByRole('button', { name: 'Continue to workspace' }).click();

    await expect(window.getByRole('heading', { name: /Good morning, Owner/u })).toBeVisible();
    await expect(window.getByText('Pipeline overview')).toBeVisible();
  } finally {
    await application.close();
  }
});
