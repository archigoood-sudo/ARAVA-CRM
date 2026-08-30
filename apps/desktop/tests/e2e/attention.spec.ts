import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

async function launchApplication(testInfo: TestInfo): Promise<ElectronApplication> {
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const userData = `--user-data-dir=${testInfo.outputPath(`attention-user-data-${String(attempt)}`)}`;
    const application = executablePath
      ? await electron.launch({ args: [userData], executablePath })
      : await electron.launch({
          args: ['.', userData],
          cwd: resolve(import.meta.dirname, '../..'),
        });
    try {
      await application.firstWindow({ timeout: 30_000 });
      return application;
    } catch (error) {
      lastError = error;
      application.process().kill('SIGKILL');
    }
  }
  throw lastError;
}

async function login(page: Page, email: string, password: string) {
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
}

async function completePassword(page: Page, password: string) {
  await page.getByLabel('Новый пароль', { exact: true }).fill(password);
  await page.getByLabel('Повторите новый пароль').fill(password);
  await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
  await expect(page.getByRole('link', { name: 'Главная', exact: true })).toBeVisible();
}

test('центр внимания ведёт к действию, авторазрешается и изолирует филиалы', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 300_000 : 180_000);
  const application = await launchApplication(testInfo);
  try {
    const page = await application.firstWindow();
    await login(page, 'owner@arava.local', 'Arava!ChangeMe1');
    await completePassword(page, 'Owner!AttentionE2E2026');
    const context = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Центр внимания E2E' });
      const hiddenBranch = await api.branches.create(token, { name: 'Скрытые задачи E2E' });
      const trainer = await api.users.create(token, {
        branchIds: [branch.id],
        email: 'trainer-attention-e2e@arava.local',
        fullName: 'Тренер Внимание E2E',
        role: 'COACH',
      });
      const admin = await api.users.create(token, {
        branchIds: [branch.id],
        email: 'admin-attention-e2e@arava.local',
        fullName: 'Администратор Внимание E2E',
        role: 'ADMIN',
      });
      const student = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Мария',
        lastName: 'Должникова E2E',
        status: 'ACTIVE',
      });
      await api.students.create(token, {
        branchId: hiddenBranch.id,
        firstName: 'Скрытая',
        lastName: 'Должникова E2E',
        status: 'ACTIVE',
      });
      const group = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 20,
        coachId: trainer.user.id,
        direction: 'Контемпорари',
        name: 'Внимательная группа E2E',
        status: 'ACTIVE',
      });
      await api.groups.addEnrollment(token, group.id, {
        joinedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: student.id,
      });
      const tariff = await api.tariffs.create(token, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 8,
        name: 'Долговой абонемент E2E',
        price: 8_000,
        type: 'LESSON_PACK',
        validityDays: 30,
      });
      const subscription = await api.subscriptions.create(token, {
        initialPayment: { amount: 8_000, paidAt: new Date().toISOString(), paymentMethod: 'CARD' },
        salePrice: 8_000,
        startsAt: new Date().toISOString().slice(0, 10),
        studentId: student.id,
        tariffId: tariff.id,
      });
      const salePayment = subscription.payments[0];
      if (!salePayment) throw new Error('Sale payment was not created');
      await api.refunds.create(token, salePayment.id, {
        amount: 5_000,
        reason: 'Возврат для проверки долга E2E',
        refundedAt: new Date().toISOString(),
      });
      const startsAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
      const lesson = await api.lessons.create(token, {
        coachId: trainer.user.id,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000).toISOString(),
        groupId: group.id,
        startsAt: startsAt.toISOString(),
      });
      const completedStarts = new Date(Date.now() - 4 * 60 * 60 * 1000);
      const completedLesson = await api.lessons.create(token, {
        coachId: trainer.user.id,
        endsAt: new Date(completedStarts.getTime() + 60 * 60 * 1000).toISOString(),
        groupId: group.id,
        startsAt: completedStarts.toISOString(),
      });
      await api.attendance.save(token, completedLesson.id, [
        { status: 'ABSENT', studentId: student.id },
      ]);
      for (const daysAgo of [2, 3]) {
        const previousStarts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
        const previousLesson = await api.lessons.create(token, {
          coachId: trainer.user.id,
          endsAt: new Date(previousStarts.getTime() + 60 * 60 * 1000).toISOString(),
          groupId: group.id,
          startsAt: previousStarts.toISOString(),
        });
        await api.attendance.save(token, previousLesson.id, [
          { status: 'ABSENT', studentId: student.id },
        ]);
      }
      return {
        adminEmail: admin.user.email,
        adminPassword: admin.temporaryPassword,
        hiddenBranchId: hiddenBranch.id,
        lessonId: lesson.id,
        studentId: student.id,
        trainerEmail: trainer.user.email,
        trainerPassword: trainer.temporaryPassword,
      };
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Требует внимания' })).toBeVisible();
    await page.getByRole('link', { name: /Требует внимания/u }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Требует внимания' })).toBeVisible();
    await page.getByLabel('Категория').selectOption('PAYMENTS');
    const debtItem = page.getByText(/Должникова E2E Мария: есть задолженность/u).first();
    await expect(debtItem).toBeVisible();
    await debtItem
      .locator('..')
      .locator('..')
      .getByRole('button', { name: 'Принять оплату' })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/students/${context.studentId}[?]action=payment`, 'u'),
    );
    const payment = page.getByRole('dialog', { name: 'Новый платёж' });
    await payment.getByLabel('Абонемент').selectOption({ label: 'Долговой абонемент E2E' });
    await payment.getByLabel('Сумма, ₽').fill('50');
    await payment.getByRole('button', { name: 'Сохранить платёж' }).click();
    await expect(payment).not.toBeVisible();

    await page.getByRole('link', { name: /Требует внимания/u }).click();
    await page.getByLabel('Категория').selectOption('PAYMENTS');
    await expect(page.getByText(/Должникова E2E Мария: есть задолженность/u)).toHaveCount(0);
    await page.getByLabel('Категория').selectOption('ATTENDANCE');
    await expect(page.getByText(/не был на последних 3 занятиях/u)).toBeVisible();
    await expect(page.getByText('Не заполнена посещаемость')).toHaveCount(1);
    const attendance = page.getByText('Не заполнена посещаемость');
    await expect(attendance).toBeVisible();
    await attendance
      .locator('..')
      .locator('..')
      .getByRole('button', { name: 'Заполнить посещаемость' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/attendance/${context.lessonId}$`, 'u'));
    await page.getByRole('button', { name: 'Отметить всех присутствующими' }).click();
    await expect(page.getByText('Посещаемость заполнена')).toBeVisible();

    await page.getByRole('button', { name: 'Выйти' }).click();
    await login(page, context.adminEmail, context.adminPassword);
    await completePassword(page, 'Admin!AttentionE2E2026');
    await page.getByRole('link', { name: /Требует внимания/u }).click();
    const adminIsolation = await page.evaluate(async ({ hiddenBranchId }) => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const visible = await api.attention.list(token, {});
      let hiddenDenied = false;
      try {
        await api.attention.list(token, { branchId: hiddenBranchId });
      } catch {
        hiddenDenied = true;
      }
      return { hiddenDenied, branchIds: [...new Set(visible.map(({ branchId }) => branchId))] };
    }, context);
    expect(adminIsolation.hiddenDenied).toBe(true);
    expect(adminIsolation.branchIds).not.toContain(context.hiddenBranchId);

    await page.getByRole('button', { name: 'Выйти' }).click();
    await login(page, context.trainerEmail, context.trainerPassword);
    await completePassword(page, 'Trainer!AttentionE2E2026');
    await expect(page.getByRole('link', { name: /Требует внимания/u })).toHaveCount(0);
    const trainerDenied = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      try {
        await api.attention.list(token, {});
        return false;
      } catch {
        return true;
      }
    });
    expect(trainerDenied).toBe(true);
  } finally {
    await application.close();
  }
});
