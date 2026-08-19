import { _electron as electron, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('приложение запускается после инициализации службы резервного копирования', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(45_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('startup-user-data')}`;
  const application = executablePath
    ? await electron.launch({
        args: [userDataArgument],
        executablePath,
      })
    : await electron.launch({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow({ timeout: 30_000 });
    await expect(page).toHaveTitle('ARAVA CRM');
    await expect(page.getByRole('heading', { name: 'Вход в ARAVA' })).toBeVisible();
  } finally {
    const proc = application.process();
    const closed = await Promise.race([
      application.close().then(() => true),
      new Promise<boolean>((resolveCloseTimeout) =>
        setTimeout(() => resolveCloseTimeout(false), 10_000),
      ),
    ]);
    if (!closed) proc.kill('SIGKILL');
    await application.close().catch(() => undefined);
  }
});
