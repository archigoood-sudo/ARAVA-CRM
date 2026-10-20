import type { AravaDesktopApi } from '@arava/shared';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { launchElectron } from './electron-launch';

test('marked multi-day lesson end can be corrected without moving attendance or duplicating lessons', async ({
  request: _request,
}, testInfo) => {
  const args = [`--user-data-dir=${testInfo.outputPath('end-correction-data')}`];
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const application = executablePath
    ? await launchElectron({ args, executablePath })
    : await launchElectron({ args: ['.', ...args], cwd: resolve(import.meta.dirname, '../..') });
  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!EndCorrection2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!EndCorrection2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByRole('link', { name: 'Посещения', exact: true })).toBeVisible();
    const fixture = await page.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const token =
        (JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as { state?: { token?: string } })
          .state?.token ?? '';
      const branch = await api.branches.create(token, { name: 'Исправление окончания' });
      const group = await api.groups.create(token, {
        branchId: branch.id,
        name: 'kds baby окончание',
        direction: 'Танцы',
        capacity: 10,
        status: 'ACTIVE',
      });
      const student = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Тест',
        lastName: 'Посещение',
        status: 'ACTIVE',
      });
      await api.groups.addEnrollment(token, group.id, {
        joinedAt: '2026-10-01',
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: student.id,
      });
      const lesson = await api.lessons.create(token, {
        groupId: group.id,
        startsAt: new Date('2026-10-17T18:30').toISOString(),
        endsAt: new Date('2026-10-19T20:00').toISOString(),
      });
      await api.attendance.save(token, lesson.id, [{ studentId: student.id, status: 'PRESENT' }]);
      await api.schedules.create(token, {
        branchId: branch.id,
        groupId: group.id,
        weekday: 1,
        startTime: '18:30',
        endTime: '19:30',
        validFrom: '2026-10-01',
        isActive: true,
      });
      const attendance = await api.attendance.get(token, lesson.id);
      location.hash = '/attendance/' + lesson.id;
      return { token, groupId: group.id, lesson, participants: attendance.participants };
    });
    await page.getByRole('button', { name: 'Исправить окончание', exact: true }).click();
    await page.getByLabel('Фактическое окончание').fill('2026-10-17T19:30');
    await page.getByLabel('Причина исправления').fill('Ошибочная дата окончания');
    await page.getByRole('button', { name: 'Подтвердить исправление' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Исправить окончание', exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'kds baby окончание', level: 1 })).toBeVisible();
    const after = await page.evaluate(async ({ token, lesson }) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return {
        lesson: await api.lessons.get(token, lesson.id),
        participants: (await api.attendance.get(token, lesson.id)).participants,
        expectedEnd: new Date('2026-10-17T19:30').toISOString(),
      };
    }, fixture);
    expect(after.participants).toEqual(fixture.participants);
    expect(after.lesson.startsAt).toBe(fixture.lesson.startsAt);
    expect(after.lesson.endsAt).toBe(after.expectedEnd);
    await page.evaluate(() => {
      location.hash = '/attendance?date=2026-10-19';
    });
    await page.getByRole('button', { name: /kds baby окончание/u }).click();
    await expect(page.getByRole('heading', { name: 'kds baby окончание', level: 1 })).toBeVisible();
    expect(page.url()).not.toContain(fixture.lesson.id);
  } finally {
    await application.close();
  }
});
