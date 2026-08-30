import { _electron as electron, expect, test } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

test('долги позволяют частично и полностью оплатить абонемент и разовое посещение', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 300_000 : 180_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userData = `--user-data-dir=${testInfo.outputPath('finance-debts-user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userData], executablePath })
    : await electron.launch({ args: ['.', userData], cwd: resolve(import.meta.dirname, '../..') });
  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!FinanceDebtsE2E2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!FinanceDebtsE2E2026');
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
      const branch = await api.branches.create(token, { name: 'Долги E2E' });
      const subscriptionStudent = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Анна',
        lastName: 'Абонементова E2E',
        status: 'ACTIVE',
      });
      const attendanceStudent = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Борис',
        lastName: 'Посещение E2E',
        status: 'ACTIVE',
      });
      const pack = await api.tariffs.create(token, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 8,
        name: 'Долговой абонемент E2E',
        price: 130_000,
        type: 'LESSON_PACK',
        validityDays: 30,
      });
      const subscription = await api.subscriptions.create(token, {
        initialPayment: {
          amount: 130_000,
          paidAt: new Date().toISOString(),
          paymentMethod: 'CARD',
        },
        salePrice: 130_000,
        startsAt: new Date().toISOString().slice(0, 10),
        studentId: subscriptionStudent.id,
        tariffId: pack.id,
      });
      const salePayment = subscription.payments[0];
      if (!salePayment) throw new Error('Sale payment was not created');
      await api.refunds.create(token, salePayment.id, {
        amount: 130_000,
        reason: 'Полный возврат для проверки долга E2E',
        refundedAt: new Date().toISOString(),
      });
      await api.tariffs.create(token, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 1,
        name: 'Разовое посещение E2E',
        price: 15_000,
        type: 'SINGLE_LESSON',
      });
      const group = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 20,
        direction: 'Тестовое направление',
        name: 'Группа долга E2E',
        status: 'ACTIVE',
      });
      await api.groups.addEnrollment(token, group.id, {
        joinedAt: new Date(Date.now() - 172_800_000).toISOString().slice(0, 10),
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: attendanceStudent.id,
      });
      const startsAt = new Date(Date.now() - 86_400_000);
      const lesson = await api.lessons.create(token, {
        endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
        groupId: group.id,
        startsAt: startsAt.toISOString(),
      });
      await api.attendance.save(token, lesson.id, [
        { status: 'PRESENT', studentId: attendanceStudent.id },
      ]);
      return {
        attendanceStudentId: attendanceStudent.id,
        subscriptionStudentId: subscriptionStudent.id,
      };
    });

    await page.getByRole('link', { name: 'Финансы' }).click();
    await page.getByRole('button', { name: 'Долги' }).click();
    await expect(page.getByText('Общая задолженность').locator('..')).toContainText('1 450 ₽');
    await expect(page.getByText('Должников').locator('..')).toContainText('2');

    const subscriptionRow = page.getByRole('row').filter({ hasText: 'Абонементова E2E Анна' });
    await expect(subscriptionRow).toContainText('1 300 ₽');
    await subscriptionRow.getByRole('button', { name: 'Подробнее' }).click();
    await page
      .getByRole('dialog', { name: /Задолженность · Абонементова/u })
      .getByRole('button', { name: 'Принять оплату' })
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `/students/${context.subscriptionStudentId}[?]action=payment&subscriptionId=`,
        'u',
      ),
    );
    await expect(page.getByRole('dialog', { name: 'Новый платёж' })).toBeVisible();
    const partialPaymentDialog = page.getByRole('dialog', { name: 'Новый платёж' });
    await partialPaymentDialog.getByLabel('Сумма').fill('500');
    await partialPaymentDialog.getByRole('button', { name: 'Принять оплату' }).click();
    await expect(page.getByRole('dialog', { name: 'Новый платёж' })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/finance\?.*view=debts/u);
    await expect(page.getByRole('row').filter({ hasText: 'Абонементова E2E Анна' })).toContainText(
      '800 ₽',
    );

    await page
      .getByRole('row')
      .filter({ hasText: 'Абонементова E2E Анна' })
      .getByRole('button', { name: 'Подробнее' })
      .click();
    await page
      .getByRole('dialog', { name: /Задолженность · Абонементова/u })
      .getByRole('button', { name: 'Принять оплату' })
      .click();
    await page
      .getByRole('dialog', { name: 'Новый платёж' })
      .getByRole('button', { name: 'Принять оплату' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Новый платёж' })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByText('Абонементова E2E Анна')).toHaveCount(0);

    const attendanceRow = page.getByRole('row').filter({ hasText: 'Посещение E2E Борис' });
    await expect(attendanceRow).toContainText('150 ₽');
    await attendanceRow.getByRole('button', { name: 'Подробнее' }).click();
    await page
      .getByRole('dialog', { name: /Задолженность · Посещение/u })
      .getByRole('button', { name: 'Оплатить посещение' })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/students/${context.attendanceStudentId}[?]action=attendance-payment`, 'u'),
    );
    await page
      .getByRole('dialog', { name: 'Новый платёж' })
      .getByRole('button', { name: 'Оплатить посещение' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Новый платёж' })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByText('Посещение E2E Борис')).toHaveCount(0);
    await expect(page.getByText('Задолженностей нет')).toBeVisible();

    await page.getByRole('button', { name: 'Операции' }).click();
    await expect(
      page.getByText('Абонемент «Долговой абонемент E2E»', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Доплата по абонементу «Долговой абонемент E2E»').first(),
    ).toBeVisible();
    await expect(page.getByText(/Разовое посещение · .* · Группа долга E2E/u)).toBeVisible();
  } finally {
    await application.close();
  }
});
