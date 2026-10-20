import { expect, test } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';
import { launchElectron } from './electron-launch';

test('student tasks expand, coverage uses lesson date, and attendance cancellation affects one occurrence', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(180_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userData = `--user-data-dir=${testInfo.outputPath('daily-actions-data')}`;
  const application = executablePath
    ? await launchElectron({ args: [userData], executablePath })
    : await launchElectron({ args: ['.', userData], cwd: resolve(import.meta.dirname, '../..') });
  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!DailyActions2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!DailyActions2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    const fixture = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Ежедневные действия' });
      const student = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Анна',
        lastName: 'Проверкина',
        status: 'ACTIVE',
      });
      const group = await api.groups.create(token, {
        branchId: branch.id,
        name: 'Разовая отмена',
        direction: 'Танцы',
        capacity: 10,
        status: 'ACTIVE',
      });
      await api.groups.addEnrollment(token, group.id, {
        joinedAt: '2026-09-01',
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: student.id,
      });
      const schedule = await api.schedules.create(token, {
        branchId: branch.id,
        isActive: true,
        groupId: group.id,
        weekday: 4,
        startTime: '18:30',
        endTime: '19:30',
        validFrom: '2026-09-01',
      });
      const lessonIds: string[] = [];
      for (const date of ['2026-10-01', '2026-10-08', '2026-11-05']) {
        const lesson = await api.lessons.create(token, {
          groupId: group.id,
          startsAt: new Date(`${date}T18:30:00`).toISOString(),
          endsAt: new Date(`${date}T19:30:00`).toISOString(),
        });
        lessonIds.push(lesson.id);
        if (date !== '2026-11-05')
          await api.attendance.save(token, lesson.id, [
            { status: 'PRESENT', studentId: student.id },
          ]);
      }
      const tariff = await api.tariffs.create(token, {
        branchId: branch.id,
        name: 'Абонемент для покрытия',
        currency: 'RUB',
        isActive: true,
        lessonCount: 8,
        price: 80000,
        type: 'LESSON_PACK',
        validityDays: 30,
      });
      const [first, second, future] = lessonIds;
      if (!first || !second || !future) throw Error('Missing lessons');
      return {
        token,
        studentId: student.id,
        groupId: group.id,
        schedule,
        tariffId: tariff.id,
        first,
        second,
        future,
      };
    });
    await page.evaluate(() => {
      location.hash = '/attention';
    });
    const group = page.locator(`[data-student-id="${fixture.studentId}"]`);
    await expect(group).toHaveCount(1);
    await expect(group.locator('summary')).toContainText('Проверкина Анна');
    await expect(group).not.toHaveAttribute('open', '');
    await group.locator('summary').click();
    await expect(group).toHaveAttribute('open', '');
    await expect(group.getByRole('button', { name: 'Оплатить посещение' })).toHaveCount(2);
    await group.locator('summary').click();
    await expect(
      group.getByRole('button', { name: 'Оплатить посещение' }).first(),
    ).not.toBeVisible();
    await page.evaluate((id) => {
      location.hash = `/students/${id}`;
    }, fixture.studentId);
    const action = page.locator(
      `a[href="#/students/${fixture.studentId}?action=attendance-payment&lessonId=${fixture.first}"]`,
    );
    await action.click();
    const row = page.locator(`#attendance-payment-${fixture.first}`);
    await expect(row).toHaveClass(/border-sky-300/u);
    await row.getByRole('button', { name: 'Покрыть абонементом' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('#subscription-start')).toHaveValue('2026-10-01');
    await expect(dialog.locator('#subscription-expiry')).toHaveValue('2026-10-31');
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await action.click();
    await row.getByRole('button', { name: 'Покрыть абонементом' }).click();
    await expect(dialog.locator('#subscription-start')).toHaveValue('2026-10-01');
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    const subscriptionId = await page.evaluate(async (f) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const before = await api.subscriptions.listStudent(f.token, f.studentId);
      if (before.subscriptions.length !== 0 || before.uncoveredAttendances.length !== 2)
        throw Error('Opening/cancelling changed finance');
      const subscription = await api.subscriptions.create(f.token, {
        studentId: f.studentId,
        tariffId: f.tariffId,
        startsAt: '2026-10-01',
        salePrice: 80000,
        initialPayment: { amount: 80000, paidAt: new Date().toISOString(), paymentMethod: 'CASH' },
      });
      return subscription.id;
    }, fixture);
    await page.evaluate((id) => {
      location.hash = `/attendance/${id}`;
    }, fixture.first);
    await page.getByRole('button', { name: 'Отменить занятие', exact: true }).click();
    await expect(dialog).toContainText('Разовая отмена');
    await expect(dialog.getByRole('button', { name: 'Подтвердить отмену занятия' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Не отменять' }).click();
    await page.getByRole('button', { name: 'Отменить занятие', exact: true }).click();
    await dialog.getByLabel('Причина отмены').fill('Разовая отмена по просьбе студии');
    await dialog.getByRole('button', { name: 'Подтвердить отмену занятия' }).click();
    await expect(page).toHaveURL(new RegExp(`/lessons/${fixture.first}$`, 'u'));
    await page.reload();
    const result = await page.evaluate(
      async ({ f, subscriptionId }) => {
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        const schedules = await api.schedules.list(f.token, { groupId: f.groupId });
        return {
          cancelled: (await api.lessons.get(f.token, f.first)).status,
          other: (await api.lessons.get(f.token, f.second)).status,
          future: (await api.lessons.get(f.token, f.future)).status,
          schedule: schedules.find((s) => s.id === f.schedule.id),
          subscription: await api.subscriptions.get(f.token, subscriptionId),
        };
      },
      { f: fixture, subscriptionId },
    );
    expect(result.cancelled).toBe('CANCELLED');
    expect(result.other).not.toBe('CANCELLED');
    expect(result.future).toBe('PLANNED');
    expect(result.schedule).toEqual(fixture.schedule);
    expect(result.subscription.lessonsUsed).toBe(1);
    expect(result.subscription.payments).toHaveLength(1);
  } finally {
    await application.close();
  }
});
