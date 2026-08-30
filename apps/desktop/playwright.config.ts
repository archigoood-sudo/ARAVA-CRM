import { defineConfig } from '@playwright/test';

const background = process.env.ARAVA_E2E_BACKGROUND !== '0';

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: '../../test-results',
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  retries: process.env.CI ? 2 : 0,
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    headless: background,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  workers: 1,
});
