import { _electron as electron, expect, test } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

test('платёжная операция становится одним подтверждённым платежом', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 150_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userData = `--user-data-dir=${testInfo.outputPath('payment-foundation-user-data')}`;
  const environment = { ...process.env, ARAVA_E2E_PAYMENT_PROVIDER: 'memory' };
  const application = executablePath
    ? await electron.launch({ args: [userData], env: environment, executablePath })
    : await electron.launch({
        args: ['.', userData],
        cwd: resolve(import.meta.dirname, '../..'),
        env: environment,
      });
  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!PaymentE2E2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!PaymentE2E2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await page.waitForFunction(() => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { user?: { mustChangePassword?: boolean } };
      };
      return persisted.state?.user?.mustChangePassword === false;
    });

    const context = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Платёжный E2E' });
      const student = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Анна',
        lastName: 'Оплатина E2E',
        status: 'ACTIVE',
      });
      const tariff = await api.tariffs.create(token, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 8,
        name: 'Тариф оплаты E2E',
        price: 100_000,
        type: 'LESSON_PACK',
        validityDays: 30,
      });
      const subscription = await api.subscriptions.create(token, {
        salePrice: 100_000,
        startsAt: new Date().toISOString().slice(0, 10),
        studentId: student.id,
        tariffId: tariff.id,
      });
      const operation = await api.paymentOperations.create(token, {
        amount: 25_000,
        branchId: branch.id,
        currency: 'RUB',
        idempotencyKey: 'payment-foundation-e2e-operation',
        providerType: 'SBP',
        purpose: 'Оплата через тестовый контур',
        studentId: student.id,
        subscriptionId: subscription.id,
      });
      return { operationId: operation.id, studentId: student.id, token };
    });

    await page.getByRole('button', { name: 'Поиск по приложению' }).click();
    let search = page.getByRole('region', { name: 'Глобальный поиск' });
    await search.getByLabel('Поиск по приложению').fill('Оплатина E2E Анна');
    await search.getByRole('button', { name: /Оплатина E2E Анна/u }).click();
    await expect(page.getByText('Операции оплаты')).toBeVisible();
    await expect(page.getByText('Создана')).toBeVisible();
    await expect(page.getByText('Оплата через тестовый контур')).toBeVisible();

    const result = await page.evaluate(async ({ operationId, studentId, token }) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      await api.paymentOperations.testComplete(token, operationId, 'SBP');
      await api.paymentOperations.testComplete(token, operationId, 'SBP');
      const finance = await api.subscriptions.listStudent(token, studentId);
      const payments = await api.payments.list(token, {
        dateFrom: new Date(Date.now() - 86_400_000).toISOString(),
        dateTo: new Date(Date.now() + 86_400_000).toISOString(),
      });
      return {
        debt: finance.totalDebt,
        operation: await api.paymentOperations.get(token, operationId),
        payments: payments.filter(({ studentId: id }) => id === studentId),
      };
    }, context);
    expect(result.operation.status).toBe('SUCCEEDED');
    expect(result.payments).toHaveLength(1);
    expect(result.debt).toBe(75_000);

    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    await page.getByRole('button', { name: 'Поиск по приложению' }).click();
    search = page.getByRole('region', { name: 'Глобальный поиск' });
    await search.getByLabel('Поиск по приложению').fill('Оплатина E2E Анна');
    await search.getByRole('button', { name: /Оплатина E2E Анна/u }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Оплатина E2E Анна' })).toBeVisible();
    await expect(page.getByText('Оплачено')).toBeVisible();
  } finally {
    await application.close();
  }
});
