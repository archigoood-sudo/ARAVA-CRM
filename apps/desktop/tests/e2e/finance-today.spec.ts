import { _electron as electron, expect, test } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

test('финансы сегодня показывают продажу, частичную оплату, доплату и разовое посещение', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 150_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userData = `--user-data-dir=${testInfo.outputPath('finance-today-user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userData], executablePath })
    : await electron.launch({ args: ['.', userData], cwd: resolve(import.meta.dirname, '../..') });
  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!FinanceTodayE2E2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!FinanceTodayE2E2026');
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
      const branch = await api.branches.create(token, { name: 'Финансы сегодня E2E' });
      const student = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Анна',
        lastName: 'Финансы E2E',
        status: 'ACTIVE',
      });
      const group = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 20,
        direction: 'Тестовое направление',
        name: 'Финансовая группа E2E',
        status: 'ACTIVE',
      });
      await api.groups.addEnrollment(token, group.id, {
        joinedAt: new Date(Date.now() - 172_800_000).toISOString().slice(0, 10),
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: student.id,
      });
      const startsAt = new Date(Date.now() - 86_400_000);
      const lesson = await api.lessons.create(token, {
        endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
        groupId: group.id,
        startsAt: startsAt.toISOString(),
      });
      await api.attendance.save(token, lesson.id, [{ status: 'PRESENT', studentId: student.id }]);
      const single = await api.tariffs.create(token, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 1,
        name: 'Разовый E2E',
        price: 1_500,
        type: 'SINGLE_LESSON',
      });
      await api.payments.create(token, {
        amount: 1_500,
        attendanceLessonId: lesson.id,
        attendanceTariffId: single.id,
        branchId: branch.id,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
        studentId: student.id,
      });
      const tariff = await api.tariffs.create(token, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 8,
        name: 'Абонемент E2E',
        price: 33_000,
        type: 'LESSON_PACK',
        validityDays: 30,
      });
      const subscription = await api.subscriptions.create(token, {
        initialPayment: {
          amount: 20_000,
          paidAt: new Date().toISOString(),
          paymentMethod: 'CASH',
        },
        salePrice: 33_000,
        startsAt: new Date().toISOString().slice(0, 10),
        studentId: student.id,
        tariffId: tariff.id,
      });
      return { branchId: branch.id, studentId: student.id, subscriptionId: subscription.id, token };
    });

    await page.getByRole('link', { name: 'Финансы' }).click();
    await expect(page.getByRole('heading', { name: 'Финансы' })).toBeVisible();
    const received = page.getByText('Принято сегодня').locator('..');
    await expect(received).toContainText('215 ₽');
    await expect(page.getByText('Продано абонементов').locator('..')).toContainText('1');
    await expect(page.getByText('Абонементов оформлено на').locator('..')).toContainText('330 ₽');
    await expect(page.getByText('Оплачено разовых посещений').locator('..')).toContainText('15 ₽');
    await expect(page.getByText('Абонемент «Абонемент E2E»')).toBeVisible();
    await expect(page.getByText('Разовое посещение').first()).toBeVisible();

    await page.evaluate(async ({ branchId, studentId, subscriptionId, token }) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      await api.payments.create(token, {
        amount: 5_000,
        branchId,
        paidAt: new Date().toISOString(),
        paymentMethod: 'TRANSFER',
        studentId,
        subscriptionId,
      });
    }, context);
    await page.getByRole('button', { name: 'Обновить' }).click();
    await expect(received).toContainText('265 ₽');
    await expect(page.getByText('Доплата по абонементу «Абонемент E2E»')).toBeVisible();
    await page.getByText('Финансы E2E Анна').first().click();
    await expect(page).toHaveURL(new RegExp(`/students/${context.studentId}$`, 'u'));
    await expect(page.getByText('Долг: 80 ₽')).toBeVisible();
  } finally {
    await application.close();
  }
});
