import { expect, test, type ElectronApplication } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

import { launchElectron } from './electron-launch';

async function closeApplication(application: ElectronApplication): Promise<void> {
  try {
    await application.evaluate(({ app }) => app.quit());
  } catch {
    application.process().kill('SIGKILL');
  }
}

test('мастер оформления возобновляется и не дублирует canonical данные', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 150_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('onboarding-user-data')}`;
  const application = executablePath
    ? await launchElectron({ args: [userDataArgument], executablePath })
    : await launchElectron({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await page.setViewportSize({ height: 768, width: 1366 });
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!OnboardingE2E2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!OnboardingE2E2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByRole('link', { name: 'Ученики', exact: true })).toBeVisible();

    const fixture = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Онбординг E2E' });
      const student = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Полина',
        lastName: 'Оформление E2E',
        status: 'TRIAL',
      });
      const group = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 20,
        direction: 'Танцы',
        name: 'Группа онбординга E2E',
        status: 'RECRUITING',
      });
      const tariff = await api.tariffs.create(token, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 8,
        name: 'Онбординг 8 занятий E2E',
        price: 420_000,
        type: 'LESSON_PACK',
        validityDays: 30,
      });
      return { branchId: branch.id, groupId: group.id, studentId: student.id, tariffId: tariff.id };
    });

    await page.evaluate((studentId) => {
      window.location.hash = `#/onboarding?studentId=${studentId}`;
    }, fixture.studentId);
    await expect(page.getByTestId('client-onboarding')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.getByTestId('onboarding-group-step')).toBeVisible();
    await page.getByLabel('Группа оформления').selectOption(fixture.groupId);
    const add = page.getByRole('button', { name: 'Добавить в группу' });
    await add.click();
    await expect(page.getByTestId('onboarding-documents-step')).toBeVisible();

    // Renderer reload models an application restart: only safe workflow IDs survive,
    // while membership state is read again from the canonical database.
    await page.reload();
    await expect(page.getByTestId('onboarding-documents-step')).toBeVisible();
    await page.getByRole('button', { name: 'Перейти к оплате' }).click();
    await expect(page.getByTestId('onboarding-payment-step')).toBeVisible();
    await page.getByRole('button', { name: 'Оформить оплату и абонемент' }).click();

    const subscription = page.getByRole('dialog', { name: 'Продажа абонемента' });
    await subscription.getByLabel('Тариф').selectOption(fixture.tariffId);
    await subscription.getByRole('button', { name: 'Продолжить к оплате' }).click();
    const payment = page.getByRole('dialog', { name: 'Новый платёж' });
    await expect(payment.getByLabel('Сумма')).toHaveValue('4200');
    await payment.getByRole('button', { name: 'Оплатить и выдать' }).click();
    await expect(page.getByText('Полная оплата подтверждена, абонемент создан')).toBeVisible();
    await page.getByRole('button', { name: 'Продолжить' }).last().click();
    await expect(page.getByTestId('onboarding-card-step')).toBeVisible();
    await page.getByRole('button', { name: 'Пропустить и завершить' }).click();
    await expect(page.getByTestId('onboarding-complete')).toBeVisible();

    const initial = await page.evaluate(async ({ groupId, studentId }) => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const [finance, payments, roster] = await Promise.all([
        api.subscriptions.listStudent(token, studentId),
        api.payments.list(token, {
          dateFrom: '2020-01-01T00:00:00.000Z',
          dateTo: '2030-01-01T00:00:00.000Z',
        }),
        api.groups.getRoster(token, groupId, new Date().toISOString().slice(0, 10)),
      ]);
      return {
        membershipCount: roster.members.filter((item) => item.studentId === studentId).length,
        paymentCount: payments.filter((item) => item.studentId === studentId).length,
        subscriptionCount: finance.subscriptions.length,
      };
    }, fixture);
    expect(initial).toEqual({ membershipCount: 1, paymentCount: 1, subscriptionCount: 1 });

    await page.evaluate(() => {
      window.location.hash = '#/dashboard';
    });
    await expect(page.getByRole('heading', { name: /Сегодня/u })).toBeVisible();
    await page.evaluate((studentId) => {
      window.location.hash = `#/onboarding?studentId=${studentId}`;
    }, fixture.studentId);
    await expect(page.getByTestId('onboarding-group-step')).toBeVisible();
    await expect(page.getByText(/уже назначена/u)).toBeVisible();
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.getByRole('button', { name: 'Перейти к оплате' }).click();
    await expect(page.getByText('Полная оплата подтверждена, абонемент создан')).toBeVisible();
    await page.getByRole('button', { name: 'Продолжить' }).last().click();
    await page.getByRole('button', { name: 'Пропустить и завершить' }).click();

    const repeated = await page.evaluate(async ({ groupId, studentId }) => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const [finance, payments, roster] = await Promise.all([
        api.subscriptions.listStudent(token, studentId),
        api.payments.list(token, {
          dateFrom: '2020-01-01T00:00:00.000Z',
          dateTo: '2030-01-01T00:00:00.000Z',
        }),
        api.groups.getRoster(token, groupId, new Date().toISOString().slice(0, 10)),
      ]);
      return {
        membershipCount: roster.members.filter((item) => item.studentId === studentId).length,
        paymentCount: payments.filter((item) => item.studentId === studentId).length,
        subscriptionCount: finance.subscriptions.length,
      };
    }, fixture);
    expect(repeated).toEqual(initial);
  } finally {
    await closeApplication(application);
  }
});
