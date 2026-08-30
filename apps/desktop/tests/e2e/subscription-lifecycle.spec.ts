import { _electron as electron, expect, test } from '@playwright/test';
import type { AravaDesktopApi, StudentFinanceSummary } from '@arava/shared';
import { resolve } from 'node:path';

function localDate(offsetDays = 0): string {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

test('продление оплачивает следующий абонемент и переключает списание ровно один раз', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 150_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('subscription-lifecycle-user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userDataArgument], executablePath })
    : await electron.launch({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!LifecycleE2E2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!LifecycleE2E2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByRole('link', { name: 'Посещения', exact: true })).toBeVisible();

    const fixture = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Абонементы 2.0 E2E' });
      const student = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Мария',
        lastName: 'Продление E2E',
        status: 'ACTIVE',
      });
      const group = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 20,
        direction: 'Абонементы',
        name: 'Последовательная группа E2E',
        status: 'ACTIVE',
      });
      await api.groups.addEnrollment(token, group.id, {
        joinedAt: '2020-01-01',
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: student.id,
      });
      const tariff = await api.tariffs.create(token, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 8,
        name: '8 занятий / 3300 E2E',
        price: 330_000,
        type: 'LESSON_PACK',
        validityDays: 30,
      });
      const now = new Date();
      const localKey = (value: Date) => {
        const timezoneOffset = value.getTimezoneOffset() * 60_000;
        return new Date(value.getTime() - timezoneOffset).toISOString().slice(0, 10);
      };
      const starts = new Date(now);
      starts.setDate(starts.getDate() - 14);
      const expires = new Date(now);
      expires.setDate(expires.getDate() + 30);
      const current = await api.subscriptions.create(token, {
        expiresAt: localKey(expires),
        idempotencyKey: 'subscription-lifecycle-current-e2e',
        initialPayment: {
          amount: 330_000,
          paidAt: now.toISOString(),
          paymentMethod: 'CASH',
        },
        salePrice: 330_000,
        startsAt: localKey(starts),
        studentId: student.id,
        tariffId: tariff.id,
      });
      await api.subscriptions.update(token, current.id, {
        expiresAt: localKey(expires),
        reason: 'Подготовка realistic E2E: текущий остаток 2',
        remainingLessons: 2,
        startsAt: localKey(starts),
        tariffId: tariff.id,
      });
      return {
        branchId: branch.id,
        currentId: current.id,
        groupId: group.id,
        studentId: student.id,
        tariffId: tariff.id,
        token,
      };
    });

    await page.getByRole('button', { name: 'Поиск по приложению' }).click();
    const search = page.getByRole('region', { name: 'Глобальный поиск' });
    await search.getByLabel('Поиск по приложению').fill('Продление E2E Мария');
    await search.getByRole('button', { name: /Продление E2E Мария/u }).click();
    await expect(page.getByRole('heading', { name: 'Продление E2E Мария' })).toBeVisible();

    const currentCard = page
      .getByRole('button')
      .filter({ hasText: '8 занятий / 3300 E2E' })
      .first();
    await expect(currentCard).toContainText('2');
    await currentCard.click();
    await page
      .getByRole('dialog', { name: '8 занятий / 3300 E2E' })
      .getByRole('button', { name: 'Продлить' })
      .click();

    const renewal = page.getByRole('dialog', { name: 'Продлить абонемент' });
    await renewal.getByLabel('Тариф').selectOption(fixture.tariffId);
    await renewal.getByLabel('Начало действия').fill(localDate());
    await expect(
      renewal.getByText('Выбранная дата пересекается с текущим абонементом.'),
    ).toBeVisible();
    await renewal.getByRole('button', { name: 'Продолжить к оплате' }).click();
    const payment = page.getByRole('dialog', { name: 'Новый платёж' });
    await expect(payment.getByLabel('Сумма')).toHaveValue('3300');
    await payment.getByRole('button', { name: 'Оплатить и продлить' }).click();
    await expect(page.getByText('Абонемент выдан', { exact: true })).toBeVisible();
    await expect(page.getByText('Следующий', { exact: true })).toBeVisible();
    await expect(page.getByText('Оплачен · начнётся после текущего')).toBeVisible();

    const initial = await page.evaluate(async ({ studentId, token }) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return api.subscriptions.listStudent(token, studentId);
    }, fixture);
    const next = initial.subscriptions.find(
      ({ sequenceAfterSubscriptionId }) => sequenceAfterSubscriptionId === fixture.currentId,
    );
    expect(next).toMatchObject({
      debt: 0,
      lifecyclePosition: 'NEXT',
      paymentStatus: 'PAID',
      remainingLessons: 8,
      sequenceAfterSubscriptionId: fixture.currentId,
    });
    expect(initial.subscriptions.find(({ id }) => id === fixture.currentId)).toMatchObject({
      debt: 0,
      lifecyclePosition: 'CURRENT',
      remainingLessons: 2,
    });
    if (!next) throw new Error('Следующий абонемент не был создан.');

    const checkpoints = await page.evaluate(
      async ({ branchId, currentId, groupId, nextId, studentId, token }) => {
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        const states: StudentFinanceSummary[] = [];
        for (const hour of [8, 10, 12]) {
          const startsAt = new Date();
          startsAt.setHours(hour, 0, 0, 0);
          const lesson = await api.lessons.create(token, {
            endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
            groupId,
            startsAt: startsAt.toISOString(),
          });
          await api.attendance.save(token, lesson.id, [{ status: 'PRESENT', studentId }]);
          if (hour === 8)
            await api.attendance.save(token, lesson.id, [{ status: 'PRESENT', studentId }]);
          states.push(await api.subscriptions.listStudent(token, studentId));
        }
        const payments = (
          await api.payments.list(token, {
            branchId,
            dateFrom: new Date(Date.now() - 86_400_000).toISOString(),
            dateTo: new Date(Date.now() + 86_400_000).toISOString(),
          })
        ).filter(({ studentId: paymentStudentId }) => paymentStudentId === studentId);
        return {
          detail: await api.subscriptions.get(token, nextId),
          payments,
          states: states.map((finance) => ({
            current: finance.subscriptions.find(({ id }) => id === currentId),
            next: finance.subscriptions.find(({ id }) => id === nextId),
            totalDebt: finance.totalDebt,
          })),
        };
      },
      { ...fixture, nextId: next.id },
    );

    expect(checkpoints.states[0]).toMatchObject({
      current: { remainingLessons: 1 },
      next: { remainingLessons: 8 },
      totalDebt: 0,
    });
    expect(checkpoints.states[1]).toMatchObject({
      current: { remainingLessons: 0, status: 'USED_UP' },
      next: { lifecyclePosition: 'CURRENT', remainingLessons: 8 },
      totalDebt: 0,
    });
    expect(checkpoints.states[2]).toMatchObject({
      current: { remainingLessons: 0 },
      next: { lifecyclePosition: 'CURRENT', remainingLessons: 7 },
      totalDebt: 0,
    });
    expect(checkpoints.payments).toHaveLength(2);
    expect(checkpoints.payments.reduce((sum, item) => sum + item.amount, 0)).toBe(660_000);
    expect(checkpoints.detail.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ summary: 'Списано занятие · осталось 7' }),
      ]),
    );
  } finally {
    await application.close();
  }
});
