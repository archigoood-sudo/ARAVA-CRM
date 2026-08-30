import { launchElectron } from './electron-launch';
import { expect, test } from '@playwright/test';
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
    ? await launchElectron({ args: [userData], env: environment, executablePath })
    : await launchElectron({
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
      const group = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 20,
        direction: 'Тестовое направление',
        name: 'Разовая группа E2E',
        status: 'ACTIVE',
      });
      await api.groups.addEnrollment(token, group.id, {
        joinedAt: new Date(Date.now() - 172_800_000).toISOString().slice(0, 10),
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: student.id,
      });
      const lessonStartsAt = new Date(Date.now() - 86_400_000);
      const lesson = await api.lessons.create(token, {
        endsAt: new Date(lessonStartsAt.getTime() + 3_600_000).toISOString(),
        groupId: group.id,
        startsAt: lessonStartsAt.toISOString(),
      });
      await api.attendance.save(token, lesson.id, [{ status: 'PRESENT', studentId: student.id }]);
      await api.tariffs.create(token, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 1,
        name: 'Разовый E2E',
        price: 1_500,
        type: 'SINGLE_LESSON',
      });
      await api.tariffs.create(token, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 1,
        name: 'Бесплатный пробный E2E',
        price: 0,
        type: 'TRIAL',
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
        initialPayment: {
          amount: 100_000,
          paidAt: new Date().toISOString(),
          paymentMethod: 'CASH',
        },
        salePrice: 100_000,
        startsAt: new Date().toISOString().slice(0, 10),
        studentId: student.id,
        tariffId: tariff.id,
      });
      const salePayment = subscription.payments[0];
      if (!salePayment) throw new Error('Sale payment was not created');
      await api.refunds.create(token, salePayment.id, {
        amount: 100_000,
        reason: 'Возврат для проверки операции E2E',
        refundedAt: new Date().toISOString(),
      });
      const operation = await api.paymentOperations.create(token, {
        amount: 25_000,
        branchId: branch.id,
        currency: 'RUB',
        idempotencyKey: 'payment-foundation-e2e-operation',
        providerType: 'SBP',
        purpose: 'Исторический чек с ошибкой',
        studentId: student.id,
        subscriptionId: subscription.id,
      });
      return { operationId: operation.id, studentId: student.id, tariffId: tariff.id, token };
    });

    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    await page.getByRole('button', { name: 'Обновить рабочий день' }).click();
    const uncoveredTask = page
      .locator('article')
      .filter({ hasText: 'Оплатина E2E Анна: посещение без покрытия' });
    await expect(uncoveredTask).toBeVisible();
    await uncoveredTask.getByRole('button', { name: 'Оплатить посещение' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/students/${context.studentId}[?]action=attendance-payment&lessonId=`, 'u'),
    );
    await page
      .getByRole('dialog', { name: 'Новый платёж' })
      .getByRole('button', { name: 'Отмена' })
      .click();
    await page.getByText('Операции оплаты').click();
    await expect(page.getByText('Создана')).toBeVisible();
    await expect(page.getByText('Исторический чек с ошибкой')).toBeVisible();
    await expect(page.getByText('Посещения без покрытия')).toBeVisible();
    await expect(page.getByText(/Разовая группа E2E ·/u).last()).toBeVisible();
    await page.getByRole('button', { name: 'Оплатить разовое посещение' }).click();
    await expect(page.getByText('Разовый E2E')).toBeVisible();
    await expect(page.getByLabel('Сумма')).toHaveValue('15');
    await page.getByRole('button', { name: 'Оплатить посещение' }).click();
    await expect(page.getByText('Посещение оплачено')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Оплатить разовое посещение' }),
    ).not.toBeVisible();

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
    expect(result.payments).toHaveLength(3);
    expect(result.debt).toBe(75_000);

    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    await page.getByRole('button', { name: 'Поиск по приложению' }).click();
    let search = page.getByRole('region', { name: 'Глобальный поиск' });
    await search.getByLabel('Поиск по приложению').fill('Оплатина E2E Анна');
    await search.getByRole('button', { name: /Оплатина E2E Анна/u }).click();
    await expect(
      page.getByRole('heading', { exact: true, name: 'Оплатина E2E Анна' }),
    ).toBeVisible();
    await page.getByText('Операции оплаты').click();
    await page
      .getByRole('button', { name: 'Открыть детали оплаты: Исторический чек с ошибкой' })
      .click();
    await expect(page.getByRole('heading', { name: 'Детали оплаты' })).toBeVisible();
    await expect(page.getByText('Ошибка формирования чека')).toBeVisible();
    await expect(page.getByText('Тестовая временная ошибка фискализации.')).toBeVisible();
    await page.getByRole('button', { name: 'Проверить чек' }).click();
    await expect(page.getByText('Чек сформирован')).toBeVisible();
    await expect(page.getByText('Фискальный документ')).toBeVisible();
    const afterHistoricalRetry = await page.evaluate(async ({ studentId, token }) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return (
        await api.payments.list(token, {
          dateFrom: new Date(Date.now() - 86_400_000).toISOString(),
          dateTo: new Date(Date.now() + 86_400_000).toISOString(),
        })
      ).filter(({ studentId: id }) => id === studentId);
    }, context);
    expect(afterHistoricalRetry).toHaveLength(3);
    expect(afterHistoricalRetry.reduce((sum, item) => sum + item.amount, 0)).toBe(126_500);
    await page.getByRole('button', { name: 'Закрыть' }).last().click();

    await page.getByRole('button', { name: 'Принять оплату' }).last().click();
    const cardMode = page.getByRole('button', { name: 'Оплата картой', exact: true });
    await expect(cardMode).toBeEnabled();
    await cardMode.click();
    await page.getByLabel('Сумма').fill('100');
    await page.getByLabel('Комментарий').fill('Оплата картой aQsi E2E');
    await expect(page.getByText('aQsi 5Ф · E2E-001')).toBeVisible();
    await page.getByRole('button', { name: 'Начать оплату картой' }).click();
    await expect(page.getByText('Ожидаем оплату картой на кассе aQsi')).toBeVisible();
    await expect(page.getByText('Оплата подтверждена')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Чек формируется')).toBeVisible();
    await page.getByRole('button', { name: 'Проверить чек' }).click();
    await expect(page.getByText('Чек сформирован')).toBeVisible();
    await expect(page.getByText(/Фискальный документ №42/u)).toBeVisible();
    await page.getByRole('button', { name: 'Готово' }).click();

    await page.getByRole('button', { name: 'Принять оплату' }).last().click();
    const sbpMode = page.getByRole('button', { name: 'Оплата по СБП', exact: true });
    await expect(sbpMode).toBeEnabled();
    await sbpMode.click();
    await page.getByLabel('Сумма').fill('100');
    await page.getByLabel('Комментарий').fill('Оплата aQsi E2E');
    await expect(page.getByText('aQsi 5Ф · E2E-001')).toBeVisible();
    await page.getByRole('button', { name: 'Начать оплату по СБП' }).click();
    await expect(page.getByText('Ожидаем оплату по СБП на кассе aQsi')).toBeVisible();
    await expect(page.getByText('Оплата подтверждена')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Чек формируется')).toBeVisible();
    await page.getByRole('button', { name: 'Проверить чек' }).click();
    await expect(page.getByText('Чек сформирован')).toBeVisible();
    await page.getByRole('button', { name: 'Готово' }).click();
    const afterQr = await page.evaluate(async ({ studentId, token }) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return (
        await api.payments.list(token, {
          dateFrom: new Date(Date.now() - 86_400_000).toISOString(),
          dateTo: new Date(Date.now() + 86_400_000).toISOString(),
        })
      ).filter(({ studentId: id }) => id === studentId);
    }, context);
    expect(afterQr).toHaveLength(5);
    expect(afterQr.filter(({ paymentMethod }) => paymentMethod === 'SBP')).toHaveLength(2);
    expect(afterQr.filter(({ paymentMethod }) => paymentMethod === 'ACQUIRING')).toEqual([
      expect.objectContaining({ amount: 10_000 }),
    ]);

    const subscriptionsBeforeSale = await page.evaluate(async ({ studentId, token }) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return (await api.subscriptions.listStudent(token, studentId)).subscriptions.length;
    }, context);
    await page.getByRole('button', { name: 'Оплата / абонемент' }).first().click();
    await page
      .getByRole('dialog', { name: 'Оплата и абонемент' })
      .getByRole('button', { name: 'Продать абонемент' })
      .click();
    const saleDialog = page.getByRole('dialog', { name: 'Продажа абонемента' });
    const saleTariff = saleDialog.getByLabel('Тариф');
    await expect(saleTariff).toBeEnabled();
    await expect(saleTariff).toHaveValue(/.+/u);
    await saleTariff.selectOption(context.tariffId);
    await saleDialog.getByRole('button', { name: 'Продолжить к оплате' }).click();
    const unifiedPayment = page.getByRole('dialog');
    await unifiedPayment.getByRole('button', { name: 'Оплата картой', exact: true }).click();
    await unifiedPayment.getByRole('button', { name: 'Начать оплату картой' }).click();
    await expect(page.getByText('Ожидаем оплату картой на кассе aQsi')).toBeVisible();
    expect(
      await page.evaluate(async ({ studentId, token }) => {
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        return (await api.subscriptions.listStudent(token, studentId)).subscriptions.length;
      }, context),
    ).toBe(subscriptionsBeforeSale);
    await expect(page.getByText('Оплата подтверждена. Абонемент выдан')).toBeVisible({
      timeout: 15_000,
    });
    await unifiedPayment.getByRole('button', { name: 'Готово' }).click();
    await expect(page.getByText('Абонемент выдан', { exact: true })).toBeVisible();
    const completedSale = await page.evaluate(async ({ studentId, token }) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return await api.subscriptions.listStudent(token, studentId);
    }, context);
    expect(completedSale.subscriptions).toHaveLength(subscriptionsBeforeSale + 1);
    expect(completedSale.subscriptions[0]).toMatchObject({ debt: 0, paymentStatus: 'PAID' });

    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    await page.getByRole('button', { name: 'Поиск по приложению' }).click();
    search = page.getByRole('region', { name: 'Глобальный поиск' });
    await search.getByLabel('Поиск по приложению').fill('Оплатина E2E Анна');
    await search.getByRole('button', { name: /Оплатина E2E Анна/u }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Оплатина E2E Анна' })).toBeVisible();
    await expect(page.getByText('Оплачено')).toHaveCount(4);
  } finally {
    await application.close();
  }
});
