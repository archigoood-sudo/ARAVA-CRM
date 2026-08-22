/// <reference lib="dom" />

import { _electron as electron, expect, test, type Page } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { copyFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const initialPassword = 'Arava!ChangeMe1';
const ownerPassword = 'Owner!DisplayE2E2026';

async function login(page: Page) {
  await page.getByLabel('Электронная почта').fill('owner@arava.local');
  await page.getByLabel('Пароль', { exact: true }).fill(initialPassword);
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await page.getByLabel('Новый пароль', { exact: true }).fill(ownerPassword);
  await page.getByLabel('Повторите новый пароль').fill(ownerPassword);
  await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
  await expect(
    page.getByRole('heading', {
      name: /(Доброе утро|Добрый день|Добрый вечер|Доброй ночи), Владелец/u,
    }),
  ).toBeVisible();
}

async function scan(page: Page, barcode: string) {
  await page.keyboard.type(barcode, { delay: 1 });
  await page.keyboard.press('Enter');
}

async function openScannedProfile(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Сегодня занятий не найдено')).toBeVisible();
  await dialog.getByRole('button', { name: 'Открыть профиль' }).click();
}

interface ViewportMetrics {
  height: number;
  width: number;
}

interface Bounds {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
  x: number;
  y: number;
}

interface PromoLayout {
  imageRect?: Bounds;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  promoClass: string;
  rootRect: Bounds;
}

async function getCustomerDisplayWindow(application: { windows: () => Page[] }): Promise<Page> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const windows = application.windows();
    for (const candidate of windows) {
      if ((await candidate.title()) === 'ARAVA — Экран клиента') {
        return candidate;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Окно экрана клиента не открылось в течение отведенного времени');
}

async function assertPromoFullscreen(display: Page) {
  const viewport = await display.evaluate<ViewportMetrics>(() => ({
    height: window.innerHeight,
    width: window.innerWidth,
  }));
  const layout = await display.evaluate<PromoLayout | null>(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="customer-display-root"]');
    if (!root) return null;
    const styles = getComputedStyle(root);
    const promo = document.querySelector<HTMLElement>('[data-testid="promo-slide"]');
    const image = document.querySelector<HTMLElement>('[data-testid="promo-image"]');
    const rootRect = root.getBoundingClientRect();
    const imageRect = image
      ? (() => {
          const imageRect = image.getBoundingClientRect();
          return {
            bottom: imageRect.bottom,
            height: imageRect.height,
            left: imageRect.left,
            right: imageRect.right,
            top: imageRect.top,
            width: imageRect.width,
            x: imageRect.x,
            y: imageRect.y,
          };
        })()
      : undefined;
    return {
      promoClass: promo?.className ?? '',
      rootRect: {
        bottom: rootRect.bottom,
        height: rootRect.height,
        left: rootRect.left,
        right: rootRect.right,
        top: rootRect.top,
        width: rootRect.width,
        x: rootRect.x,
        y: rootRect.y,
      },
      ...(imageRect ? { imageRect } : {}),
      paddingBottom: parseFloat(styles.paddingBottom),
      paddingLeft: parseFloat(styles.paddingLeft),
      paddingRight: parseFloat(styles.paddingRight),
      paddingTop: parseFloat(styles.paddingTop),
    };
  });

  if (!layout) throw new Error('Отсутствует корневой контейнер экрана клиента');

  expect(layout.rootRect.width).toBeGreaterThanOrEqual(viewport.width - 2);
  expect(layout.rootRect.height).toBeGreaterThanOrEqual(viewport.height - 2);
  expect(layout.rootRect.left).toBeLessThanOrEqual(1);
  expect(layout.rootRect.top).toBeLessThanOrEqual(1);
  expect(layout.promoClass.includes('rounded')).toBe(false);
  expect(layout.promoClass.includes('grid-cols-[1.3fr_0.7fr]')).toBe(false);
  expect(layout.paddingLeft).toBe(0);
  expect(layout.paddingRight).toBe(0);
  expect(layout.paddingTop).toBe(0);
  expect(layout.paddingBottom).toBe(0);

  if (layout.imageRect) {
    expect(layout.imageRect.width).toBeGreaterThanOrEqual(
      Math.min(viewport.width, viewport.height) * 0.35,
    );
    expect(layout.imageRect.height).toBeGreaterThanOrEqual(
      Math.min(viewport.width, viewport.height) * 0.35,
    );
    expect(layout.imageRect.width).toBeLessThanOrEqual(viewport.width + 2);
    expect(layout.imageRect.height).toBeLessThanOrEqual(viewport.height + 2);
  }
}

test('предпросмотр экрана клиента получает безопасные данные из глобального сканера', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 120_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataDir = testInfo.outputPath('customer-display-user-data');
  const userDataArgument = `--user-data-dir=${userDataDir}`;
  const slideMediaId = `${randomUUID()}.png`;
  const slideMediaPath = resolve(userDataDir, 'media', 'customer-display', slideMediaId);
  const application = executablePath
    ? await electron.launch({ args: [userDataArgument], executablePath })
    : await electron.launch({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await mkdir(resolve(userDataDir, 'media', 'customer-display'), { recursive: true });
    await copyFile(resolve(import.meta.dirname, '../../build/icon.png'), slideMediaPath);
    await login(page);
    const fixtures = await page.evaluate(
      async ({ slideMediaId }) => {
        const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
          state?: { token?: string };
        };
        const token = persisted.state?.token ?? '';
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        const branch = await api.branches.create(token, { name: 'Филиал экрана' });
        const first = await api.students.create(token, {
          branchId: branch.id,
          email: 'private-a@example.test',
          firstName: 'Анна',
          lastName: 'Секретова',
          phone: '+79990000001',
          status: 'ACTIVE',
        });
        const second = await api.students.create(token, {
          branchId: branch.id,
          email: 'private-b@example.test',
          firstName: 'Борис',
          lastName: 'Закрытов',
          phone: '+79990000002',
          status: 'ACTIVE',
        });
        await api.cards.assign(token, {
          barcode: '0000094301',
          registerIfUnknown: true,
          studentId: first.id,
        });
        await api.cards.assign(token, {
          barcode: '0000094302',
          registerIfUnknown: true,
          studentId: second.id,
        });
        await api.customerDisplay.updateSettings(token, {
          customerSeconds: 3,
          enabled: true,
          fullscreen: true,
          showLastName: false,
          slideSeconds: 8,
        });
        const status = await api.customerDisplay.saveSlide(token, {
          isActive: true,
          mediaId: slideMediaId,
          text: 'Тестовый баннер',
          title: 'Рекламный баннер',
        });
        return {
          firstId: first.id,
          secondId: second.id,
          hasImageUrl: Boolean(status.slides[0]?.imageUrl?.startsWith('data:image')),
        };
      },
      { slideMediaId },
    );
    expect(fixtures.hasImageUrl).toBe(true);

    await page.getByRole('link', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Экран клиента' })).toBeVisible();
    await page.getByRole('button', { name: 'Предпросмотр' }).click();
    const display = await getCustomerDisplayWindow(application);
    await expect(display).toHaveTitle('ARAVA — Экран клиента');
    const imageCount = await display.evaluate(
      () => document.querySelectorAll('[data-testid="promo-image"]').length,
    );
    const slideCount = await display.evaluate(
      () => document.querySelectorAll('[data-testid="promo-slide"]').length,
    );
    const studentMode = await display.evaluate(() =>
      document.querySelector('[data-testid="customer-display-root"]')?.getAttribute('data-mode'),
    );
    expect(imageCount).toBe(1);
    expect(slideCount).toBe(1);
    expect(studentMode).toBe('promo');
    await expect(
      display.getByTestId('promo-image').evaluate((element) => getComputedStyle(element).objectFit),
    ).resolves.toBe('contain');

    await expect(
      display.getByTestId('promo-image').evaluate((element) => getComputedStyle(element).objectFit),
    ).resolves.toBe('contain');
    await expect(display.getByTestId('customer-display-root')).toHaveAttribute(
      'data-mode',
      'promo',
    );
    await assertPromoFullscreen(display);

    await scan(page, '0000094301');
    await openScannedProfile(page);
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixtures.firstId}\\?openedByCard=1$`, 'u'),
    );
    await expect(display.getByTestId('customer-display-root')).toHaveAttribute(
      'data-mode',
      'student',
    );
    await expect(display.getByRole('heading', { name: 'Анна!' })).toBeVisible();
    await expect(display.getByText('Нет активного абонемента')).toBeVisible();
    for (const sensitive of [
      '+79990000001',
      'private-a@example.test',
      'Секретова',
      '0000094301',
      'задолженность',
    ])
      await expect(display.getByText(sensitive, { exact: false })).toHaveCount(0);

    await scan(page, '0000094302');
    await openScannedProfile(page);
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixtures.secondId}\\?openedByCard=1$`, 'u'),
    );
    await expect(display.getByRole('heading', { name: 'Борис!' })).toBeVisible();
    await expect(display.getByTestId('customer-display-root')).toHaveAttribute(
      'data-mode',
      'promo',
      {
        timeout: 6_000,
      },
    );
    await assertPromoFullscreen(display);

    await scan(page, '0000094302');
    await openScannedProfile(page);
    await expect(display.getByRole('heading', { name: 'Борис!' })).toBeVisible();
    await expect(display.getByTestId('customer-display-root')).toHaveAttribute(
      'data-mode',
      'promo',
      {
        timeout: 6_000,
      },
    );
    await assertPromoFullscreen(display);
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(display.getByTestId('promo-image')).toBeVisible();
    await expect(display.getByText('Борис', { exact: false })).toHaveCount(0);
  } finally {
    await application.close();
  }
});
