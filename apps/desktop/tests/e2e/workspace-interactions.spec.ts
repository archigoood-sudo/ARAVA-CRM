import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

import { launchElectron } from './electron-launch';

test('OWNER can navigate every workspace and cancel forms without blocking subsequent clicks', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(300_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('workspace-interactions-data')}`;
  const application = executablePath
    ? await launchElectron({ args: [userDataArgument], executablePath })
    : await launchElectron({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });
  const errors: string[] = [];
  const coverage: { route: string; height: number; buttons: number; disabled: number }[] = [];
  try {
    const page = await application.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!WorkspaceAudit2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!WorkspaceAudit2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toBeVisible();
    // A branch is a real prerequisite for adding students and staff.
    await sidebar.locator('a[href="#/branches"]').click();
    await page.getByRole('button', { name: 'Создать филиал', exact: true }).click();
    const branchDialog = page.getByRole('dialog');
    await branchDialog.getByLabel('Название филиала').fill('Тестовый филиал аудита');
    await branchDialog.getByLabel('Адрес').fill('Тестовая улица, 1');
    await branchDialog.getByLabel('Телефон').fill('+7 (999) 123-45-67');
    await branchDialog.getByRole('button', { name: 'Создать филиал', exact: true }).click();
    await expect(branchDialog).toHaveCount(0);
    await expect(page.getByText('Тестовый филиал аудита', { exact: true }).first()).toBeVisible();
    const routes = await sidebar
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(routes.length).toBeGreaterThan(20);
    for (const height of [768, 600]) {
      await page.setViewportSize({ width: 1366, height });
      for (const route of routes) {
        await test.step(`${String(height)}px ${route}`, async () => {
          await sidebar.locator(`a[href="${route}"]`).click();
          await expect.poll(() => page.evaluate(() => location.hash)).toBe(route);
          await expect(sidebar.locator(`a[href="${route}"]`)).toHaveAttribute(
            'aria-current',
            'page',
          );
          await expect(page.getByTestId('main-scroll').getByRole('heading').first()).toBeVisible();
          const buttons = page.getByTestId('main-scroll').getByRole('button');
          let enabled = 0;
          let disabled = 0;
          for (let index = 0; index < (await buttons.count()); index += 1) {
            const button = buttons.nth(index);
            if (!(await button.isVisible())) continue;
            if (await button.isDisabled()) {
              disabled += 1;
              continue;
            }
            // Hit-testing only: never execute exports, recovery, provider or update actions.
            await button.click({ trial: true });
            enabled += 1;
          }
          coverage.push({ route, height, buttons: enabled, disabled });
        });
      }
    }
    for (const [route, action] of [
      ['#/branches', 'Создать филиал'],
      ['#/students', 'Добавить ученика'],
      ['#/users', 'Добавить сотрудника'],
      ['#/cash', 'Новая касса'],
      ['#/cash', 'Перевод'],
      ['#/cash', 'Корректировка'],
    ] as const) {
      await sidebar.locator(`a[href="${route}"]`).click();
      await page.getByRole('button', { name: action, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await sidebar.locator('a[href="#/dashboard"]').click();
      await expect(page).toHaveURL(/#\/dashboard$/u);
    }
    await page.reload();
    await expect(sidebar).toBeVisible();
    await sidebar.locator('a[href="#/settings"]').click();
    await expect(page).toHaveURL(/#\/settings$/u);
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach('workspace-interaction-coverage', {
      body: JSON.stringify(coverage, null, 2),
      contentType: 'application/json',
    });
    await application.close();
  }
});

test('settings deep links scroll to the requested section, including navigation within settings', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(90_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('settings-deep-link-data')}`;
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
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!SettingsAudit2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!SettingsAudit2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await page.setViewportSize({ width: 1366, height: 600 });
    for (const section of ['integration', 'backups', 'integration']) {
      await page.evaluate((id) => {
        location.hash = `/settings#${id}`;
      }, section);
      await expect
        .poll(() =>
          page.evaluate((id) => {
            const target = document.getElementById(id);
            const container = document.querySelector('[data-testid="main-scroll"]');
            if (!target || !container) return false;
            const top = target.getBoundingClientRect().top;
            const bounds = container.getBoundingClientRect();
            return top >= bounds.top - 2 && top < bounds.bottom - 50;
          }, section),
        )
        .toBe(true);
    }
  } finally {
    await application.close();
  }
});
