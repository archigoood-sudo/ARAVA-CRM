import { launchElectron } from './electron-launch';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('emergency recovery controls remain reachable in a short Windows viewport', async ({
  request: _request,
}, testInfo) => {
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('emergency-scroll-user-data')}`;
  const application = executablePath
    ? await launchElectron({ args: [userDataArgument], executablePath })
    : await launchElectron({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await page.setViewportSize({ height: 320, width: 720 });
    await page.evaluate(() => {
      window.location.hash = '#/emergency-owner-recovery';
    });
    await expect(
      page.getByRole('heading', { name: 'Аварийное восстановление владельца' }),
    ).toBeVisible();
    const scrollArea = page.locator('main');
    await expect
      .poll(() => scrollArea.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    const back = page.getByRole('link', { name: 'Вернуться ко входу' });
    expect(
      await scrollArea.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return element.scrollTop;
      }),
    ).toBeGreaterThan(0);
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.getByRole('heading', { name: 'Вход в ARAVA' })).toBeVisible();
  } finally {
    await application.close();
  }
});
