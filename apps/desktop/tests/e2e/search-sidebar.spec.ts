import { _electron as electron, expect, test, type Page } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

const ownerPassword = 'Owner!SearchSidebar2026';

async function login(page: Page) {
  await page.getByLabel('Электронная почта').fill('owner@arava.local');
  await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await page.getByLabel('Новый пароль', { exact: true }).fill(ownerPassword);
  await page.getByLabel('Повторите новый пароль').fill(ownerPassword);
  await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
  await expect(page.getByRole('link', { name: 'Главная', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForFunction(() => {
    const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
      state?: { user?: { mustChangePassword?: boolean } };
    };
    return persisted.state?.user?.mustChangePassword === false;
  });
}

test('sidebar остаётся доступным на малой высоте, а глобальный поиск открывает CRM-сущности', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 300_000 : 180_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('search-sidebar-user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userDataArgument], executablePath })
    : await electron.launch({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await login(page);
    const created = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, {
        address: 'улица Глобальная, 5',
        name: 'Глобальный филиал',
      });
      const student = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Артём',
        lastName: 'Глобальный',
        phone: '+79990001234',
        status: 'ACTIVE',
      });
      await api.cards.assign(token, {
        barcode: '0000076543',
        registerIfUnknown: true,
        studentId: student.id,
      });
      return { studentId: student.id };
    });

    for (const height of [900, 700, 600]) {
      await page.setViewportSize({ height, width: 1440 });
      const navigation = page.getByTestId('sidebar-navigation');
      await expect(navigation).toBeVisible();
      const lastNavigationItem = navigation.getByRole('link').last();
      await lastNavigationItem.scrollIntoViewIfNeeded();
      await expect(lastNavigationItem).toBeVisible();
      await expect(
        page.getByTestId('sidebar-footer').getByRole('link', { name: 'Настройки' }),
      ).toBeVisible();
      await expect(
        page.getByTestId('sidebar-footer').getByRole('link', { name: 'О программе' }),
      ).toBeVisible();
      const layout = await page.evaluate<{
        mainAfter: number;
        mainBefore: number;
        navOverflow: string;
        sidebarOverflow: string;
      }>(`(() => {
        const nav = document.querySelector('[data-testid="sidebar-navigation"]');
        const main = document.querySelector('[data-testid="main-scroll"]');
        const sidebar = document.querySelector('[data-testid="sidebar"]');
        if (!nav || !main || !sidebar) throw new Error('Области прокрутки не найдены.');
        const mainBefore = main.scrollTop;
        nav.scrollTop = nav.scrollHeight;
        return {
          mainBefore,
          mainAfter: main.scrollTop,
          navOverflow: getComputedStyle(nav).overflowY,
          sidebarOverflow: getComputedStyle(sidebar).overflowY,
        };
      })()`);
      expect(layout).toMatchObject({
        mainAfter: layout.mainBefore,
        navOverflow: 'auto',
        sidebarOverflow: 'hidden',
      });
    }

    await page.setViewportSize({ height: 800, width: 1440 });
    await page.getByRole('button', { name: 'Поиск по приложению' }).click();
    const search = page.getByRole('region', { name: 'Глобальный поиск' });
    await search.getByLabel('Поиск по приложению').fill('глобальный');
    await expect(search.getByText('Глобальный Артём')).toBeVisible();
    await search.getByText('Глобальный Артём').click();
    await expect(page).toHaveURL(new RegExp(`/students/${created.studentId}$`, 'u'));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    await expect(page.getByRole('region', { name: 'Глобальный поиск' })).toBeVisible();
    const keyboardInput = page
      .getByRole('region', { name: 'Глобальный поиск' })
      .getByLabel('Поиск по приложению');
    await keyboardInput.fill('0000076543');
    const keyboardStudentResult = page
      .getByRole('region', { name: 'Глобальный поиск' })
      .getByRole('button', { name: /^Глобальный Артём \+799/u });
    await expect(keyboardStudentResult).toBeVisible();
    await keyboardInput.focus();
    await keyboardInput.press('ArrowDown');
    await expect(keyboardInput).toHaveAttribute('aria-activedescendant', 'global-search-result-0');
    await expect(keyboardStudentResult).toBeFocused();
    await keyboardStudentResult.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/students/${created.studentId}$`, 'u'));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const noResultInput = page
      .getByRole('region', { name: 'Глобальный поиск' })
      .getByLabel('Поиск по приложению');
    await noResultInput.fill('совсемнетсовпадений');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await noResultInput.press('Escape');
    await expect(page.getByRole('region', { name: 'Глобальный поиск' })).toBeHidden();

    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.type('0000076543', { delay: 1 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/students\/[^?]+\?openedByCard=1/u);
  } finally {
    await application.close();
  }
});
