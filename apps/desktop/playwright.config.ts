import { defineConfig } from '@playwright/test';

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: '../../test-results',
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  retries: process.env.CI ? 2 : 0,
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  workers: 1,
});
