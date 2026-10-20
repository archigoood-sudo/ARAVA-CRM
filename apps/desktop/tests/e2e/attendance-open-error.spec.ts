import { expect, test } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';
import { launchElectron } from './electron-launch';

test('attendance exposes a real occurrence conflict without creating a duplicate and other lessons open', async ({
  request: _request,
}, testInfo) => {
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const args = [`--user-data-dir=${testInfo.outputPath('attendance-error-user-data')}`];
  const application = executablePath
    ? await launchElectron({ args, executablePath })
    : await launchElectron({ args: ['.', ...args], cwd: resolve(import.meta.dirname, '../..') });
  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!AttendanceError2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!AttendanceError2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByRole('link', { name: 'Посещения', exact: true })).toBeVisible();
    const fixture = await page.evaluate(async () => {
      const token =
        (JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as { state?: { token?: string } })
          .state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Диагностика посещений' });
      const trainer = await api.users.create(token, {
        branchIds: [branch.id],
        email: 'attendance-error@arava.local',
        fullName: 'Тренер Проверки',
        role: 'COACH',
      });
      const first = await api.groups.create(token, {
        branchId: branch.id,
        coachId: trainer.user.id,
        name: 'Группа с конфликтом',
        direction: 'Танцы',
        capacity: 10,
        status: 'ACTIVE',
      });
      const second = await api.groups.create(token, {
        branchId: branch.id,
        coachId: trainer.user.id,
        name: 'Другая группа',
        direction: 'Танцы',
        capacity: 10,
        status: 'ACTIVE',
      });
      const date = '2026-10-19';
      await api.schedules.create(token, {
        branchId: branch.id,
        groupId: first.id,
        coachId: trainer.user.id,
        weekday: 1,
        startTime: '18:30',
        endTime: '19:30',
        validFrom: '2026-10-01',
        isActive: true,
      });
      const lesson = await api.lessons.create(token, {
        groupId: second.id,
        coachId: trainer.user.id,
        startsAt: new Date(date + 'T18:30:00').toISOString(),
        endsAt: new Date(date + 'T19:30:00').toISOString(),
      });
      location.hash = '/attendance?date=' + date;
      return { token, groupId: first.id, lessonId: lesson.id, date };
    });
    await page.getByRole('button', { name: /Группа с конфликтом/u }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Тренер уже занят в это время.');
    await expect(alert).toContainText('Группа с конфликтом');
    await expect(alert).toContainText('19.10.2026');
    await expect(alert).toContainText('18:30');
    await alert.getByRole('button', { name: 'Обновить список' }).click();
    await page.getByRole('button', { name: /Группа с конфликтом/u }).click();
    await expect(alert).toContainText('Тренер уже занят в это время.');
    const rows = await page.evaluate(async ({ token, date, groupId }) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return (await api.attendance.today(token, date)).lessons.filter(
        (row) => row.groupId === groupId,
      );
    }, fixture);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lessonId).toBeUndefined();
    await page.getByRole('button', { name: /Другая группа/u }).click();
    await expect(page).toHaveURL(new RegExp('/attendance/' + fixture.lessonId, 'u'));
    await expect(page.getByRole('heading', { name: 'Другая группа', exact: true })).toBeVisible();
    const conflict = await page.evaluate(async ({ token, date }) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Конфликт одной группы' });
      const group = await api.groups.create(token, {
        branchId: branch.id,
        name: 'kds baby проверка',
        direction: 'Танцы',
        capacity: 10,
        status: 'ACTIVE',
      });
      const lesson = await api.lessons.create(token, {
        groupId: group.id,
        startsAt: new Date(date + 'T18:20:00').toISOString(),
        endsAt: new Date(date + 'T19:20:00').toISOString(),
      });
      await api.schedules.create(token, {
        branchId: branch.id,
        groupId: group.id,
        weekday: 1,
        startTime: '18:30',
        endTime: '19:30',
        validFrom: '2026-10-01',
        isActive: true,
      });
      location.hash = '/attendance?date=' + date;
      return { groupId: group.id, lesson };
    }, fixture);
    await page.reload();
    await page
      .getByRole('button', { name: /kds baby проверка/u })
      .filter({ hasText: '18:30' })
      .click();
    await expect(alert).toContainText('У группы уже есть занятие в это время.');
    await expect(alert).toContainText('18:20');
    await alert.getByRole('link', { name: 'Открыть существующее занятие' }).click();
    await expect(page).toHaveURL(new RegExp('/attendance/' + conflict.lesson.id, 'u'));
    await expect(
      page.getByRole('heading', { name: 'kds baby проверка', exact: true, level: 1 }),
    ).toBeVisible();
    const unchanged = await page.evaluate(
      async ({ token, groupId, lesson }) => {
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        return {
          lesson: await api.lessons.get(token, lesson.id),
          lessons: await api.lessons.list(token, {
            groupId,
            dateFrom: '2026-10-18T00:00:00.000Z',
            dateTo: '2026-10-20T23:59:59.999Z',
          }),
        };
      },
      { token: fixture.token, ...conflict },
    );
    expect(unchanged.lesson).toEqual(conflict.lesson);
    expect(unchanged.lessons).toHaveLength(1);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'kds baby проверка', exact: true, level: 1 }),
    ).toBeVisible();
  } finally {
    await application.close();
  }
});
