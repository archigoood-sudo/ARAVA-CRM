import type { AravaDesktopApi } from '@arava/shared';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

import { launchElectron } from './electron-launch';

test('отмена с отработкой, единоразовый перенос и Global Archive работают end-to-end', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 300_000 : 180_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userData = `--user-data-dir=${testInfo.outputPath('schedule-archive-user-data')}`;
  const application = executablePath
    ? await launchElectron({ args: [userData], executablePath })
    : await launchElectron({ args: ['.', userData], cwd: resolve(import.meta.dirname, '../..') });
  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!ScheduleArchiveE2E');
    await page.getByLabel('Повторите новый пароль').fill('Owner!ScheduleArchiveE2E');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await page.waitForFunction(() => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { user?: { mustChangePassword?: boolean } };
      };
      return persisted.state?.user?.mustChangePassword === false;
    });
    const fixture = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Sprint 6.1 E2E' });
      const group = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 20,
        direction: 'Контемп',
        name: 'Исключения E2E',
        status: 'ACTIVE',
      });
      const student = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Мила',
        lastName: 'Архивная E2E',
        status: 'ACTIVE',
      });
      const deletedStudent = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Иван',
        lastName: 'Удаляемый E2E',
        status: 'ACTIVE',
      });
      await api.groups.addEnrollment(token, group.id, {
        joinedAt: '2030-09-01',
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: deletedStudent.id,
      });
      const original = await api.lessons.create(token, {
        endsAt: '2030-09-10T16:00:00.000Z',
        groupId: group.id,
        startsAt: '2030-09-10T15:00:00.000Z',
      });
      const moving = await api.lessons.create(token, {
        endsAt: '2030-09-11T16:00:00.000Z',
        groupId: group.id,
        startsAt: '2030-09-11T15:00:00.000Z',
      });
      await api.students.archive(token, student.id);
      await api.students.archive(token, deletedStudent.id);
      return {
        deletedStudentId: deletedStudent.id,
        movingId: moving.id,
        originalId: original.id,
        studentId: student.id,
      };
    });

    await page.evaluate((lessonId) => {
      window.location.hash = `#/lessons/${lessonId}`;
    }, fixture.originalId);
    await page.getByRole('button', { name: 'Отменить занятие' }).click();
    const cancelDialog = page.getByRole('dialog');
    await expect(cancelDialog.getByText('Отмена занятия', { exact: true })).toBeVisible();
    await cancelDialog.getByRole('textbox').fill('Проверка отработки E2E');
    await cancelDialog.getByText('Отменить с последующей отработкой', { exact: true }).click();
    await cancelDialog.getByRole('button', { name: 'Отменить занятие' }).click();
    await expect(page.getByText('Ожидает назначения')).toBeVisible();
    await page.getByRole('button', { name: 'Назначить отработку' }).click();
    const makeupDialog = page.getByRole('dialog');
    await expect(makeupDialog.getByText('Назначить отработку', { exact: true })).toBeVisible();
    await makeupDialog.locator('input[type="datetime-local"]').nth(0).fill('2030-09-12T18:00');
    await makeupDialog.locator('input[type="datetime-local"]').nth(1).fill('2030-09-12T19:00');
    await makeupDialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Отработка отменённого занятия')).toBeVisible();

    await page.evaluate((lessonId) => {
      window.location.hash = `#/lessons/${lessonId}`;
    }, fixture.movingId);
    await page.getByRole('button', { name: 'Перенести занятие' }).click();
    const moveDialog = page.getByRole('dialog');
    await expect(moveDialog.getByText('Перенести занятие', { exact: true })).toBeVisible();
    await moveDialog.locator('input[type="datetime-local"]').nth(0).fill('2030-09-13T18:00');
    await moveDialog.locator('input[type="datetime-local"]').nth(1).fill('2030-09-13T19:00');
    await moveDialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Перенесено с')).toBeVisible();

    await page.getByRole('link', { name: 'Архив', exact: true }).click();
    await expect(
      page.getByTestId('main-scroll').getByRole('heading', { name: 'Архив', exact: true }),
    ).toBeVisible();
    await page.getByPlaceholder('Поиск по имени, названию или филиалу').fill('Архивная E2E');
    const archived = page.locator('[data-testid="global-archive-list"] > div').filter({
      hasText: 'Архивная E2E Мила',
    });
    await expect(archived).toBeVisible();
    await archived.getByRole('button', { name: 'Восстановить' }).click();
    await expect(archived).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(async (studentId) => {
          const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
            state?: { token?: string };
          };
          const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
          return (await api.students.get(persisted.state?.token ?? '', studentId)).status;
        }, fixture.studentId),
      )
      .toBe('ACTIVE');

    await page.getByPlaceholder('Поиск по имени, названию или филиалу').fill('Удаляемый E2E');
    const deleting = page.locator('[data-testid="global-archive-list"] > div').filter({
      hasText: 'Удаляемый E2E Иван',
    });
    await deleting.getByRole('button', { name: 'Удалить навсегда' }).click();
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog.getByText('Будет удалено вместе с объектом:')).toBeVisible();
    await expect(deleteDialog.getByText('Участия в группах')).toBeVisible();
    await deleteDialog.getByRole('textbox').fill('Удаляемый E2E Иван');
    page.once('dialog', async (dialog) => dialog.accept());
    await deleteDialog.getByRole('button', { name: 'Удалить навсегда' }).click();
    await expect(deleting).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(async (studentId) => {
          const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
            state?: { token?: string };
          };
          const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
          try {
            await api.students.get(persisted.state?.token ?? '', studentId);
            return false;
          } catch {
            return true;
          }
        }, fixture.deletedStudentId),
      )
      .toBe(true);
  } finally {
    await application.close();
  }
});
