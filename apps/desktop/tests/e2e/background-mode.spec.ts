import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { isBackgroundE2E, launchElectron } from './electron-launch';

test('background mode keeps Electron hidden and suppresses native UI', async ({
  request: _request,
}, testInfo) => {
  test.skip(!isBackgroundE2E(), 'The headed debug mode intentionally shows its window.');
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('background-user-data')}`;
  const application = executablePath
    ? await launchElectron({ args: [userDataArgument], executablePath })
    : await launchElectron({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await expect(page).toHaveTitle('ARAVA CRM');
    expect(await page.evaluate(() => window.confirm('background confirmation'))).toBe(true);
    const state = await application.evaluate(async ({ BrowserWindow, dialog, shell }) => {
      const open = await dialog.showOpenDialog({});
      const save = await dialog.showSaveDialog({});
      const message = await dialog.showMessageBox({ cancelId: 2, message: 'test' });
      await shell.openExternal('https://example.com');
      return {
        externalSuppressed: true,
        focused: BrowserWindow.getAllWindows().some((window) => window.isFocused()),
        messageResponse: message.response,
        openCanceled: open.canceled,
        path: await shell.openPath('/tmp/arava-e2e-do-not-open'),
        saveCanceled: save.canceled,
        visible: BrowserWindow.getAllWindows().some((window) => window.isVisible()),
      };
    });
    expect(state).toEqual({
      externalSuppressed: true,
      focused: false,
      messageResponse: 2,
      openCanceled: true,
      path: '',
      saveCanceled: true,
      visible: false,
    });
  } finally {
    await application.close();
  }
});
