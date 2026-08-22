import { _electron as electron, expect, test, type Page } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

const ownerPassword = 'Owner!AttendanceE2E2026';

async function login(page: Page) {
  await page.getByLabel('Электронная почта').fill('owner@arava.local');
  await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await page.getByLabel('Новый пароль', { exact: true }).fill(ownerPassword);
  await page.getByLabel('Повторите новый пароль').fill(ownerPassword);
  await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
  await expect(page.getByRole('link', { name: 'Посещения', exact: true })).toBeVisible();
}

async function scan(page: Page, barcode: string) {
  await page.keyboard.type(barcode, { delay: 60 });
  await page.keyboard.press('Enter');
}

test('рабочее место отмечает вручную, через поиск и после явного подтверждения карты', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 150_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('attendance-workspace-user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userDataArgument], executablePath })
    : await electron.launch({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await login(page);
    const fixture = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Посещения E2E' });
      const trainer = await api.users.create(token, {
        branchIds: [branch.id],
        email: 'trainer-attendance-e2e@arava.local',
        fullName: 'Ева Беглова',
        role: 'COACH',
      });
      const students = await Promise.all([
        api.students.create(token, {
          branchId: branch.id,
          firstName: 'Алиса',
          lastName: 'Иванова',
          status: 'ACTIVE',
        }),
        api.students.create(token, {
          branchId: branch.id,
          firstName: 'Борис',
          lastName: 'Петров',
          status: 'ACTIVE',
        }),
        api.students.create(token, {
          branchId: branch.id,
          firstName: 'Максим',
          lastName: 'Карточкин',
          status: 'ACTIVE',
        }),
      ]);
      const group = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 20,
        coachId: trainer.user.id,
        direction: 'Хип-хоп',
        name: 'Хип-хоп 8–10 лет',
        status: 'ACTIVE',
      });
      for (const student of students)
        await api.groups.addEnrollment(token, group.id, {
          joinedAt: '2020-01-01',
          overrideCapacity: false,
          status: 'ACTIVE',
          studentId: student.id,
        });
      const startsAt = new Date(Date.now() - 10 * 60_000);
      const lesson = await api.lessons.create(token, {
        coachId: trainer.user.id,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
        groupId: group.id,
        startsAt: startsAt.toISOString(),
      });
      await api.cards.assign(token, {
        barcode: '0000098701',
        registerIfUnknown: true,
        studentId: students[2].id,
      });
      return {
        cardStudentId: students[2].id,
        lessonId: lesson.id,
      };
    });

    await page.getByRole('link', { name: 'Посещения', exact: true }).click();
    await expect(page).toHaveURL(/\/attendance$/u);
    await expect(
      page.getByTestId('main-scroll').getByRole('heading', { name: 'Посещения', exact: true }),
    ).toBeVisible();
    const lessonCard = page.getByRole('button').filter({ hasText: 'Хип-хоп 8–10 лет' });
    await expect(lessonCard).toContainText('Отмечено 0 из 3');
    await lessonCard.click();
    await expect(page).toHaveURL(new RegExp(`/attendance/${fixture.lessonId}`, 'u'));

    await page.getByRole('button', { name: 'Иванова Алиса: Присутствовал' }).click();
    await expect(page.getByText('Присутствуют', { exact: true }).locator('..')).toContainText('1');

    const search = page.getByLabel('Поиск ученика');
    await search.fill('Петров');
    await expect(page.getByText('Петров Борис', { exact: true })).toBeVisible();
    await expect(page.getByText('Иванова Алиса', { exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Петров Борис: Присутствовал' }).click();
    await expect(page.getByText('Присутствуют', { exact: true }).locator('..')).toContainText('2');
    await search.fill('');

    await scan(page, '0000098701');
    const prompt = page.getByRole('dialog');
    await expect(prompt.getByRole('heading', { name: 'Максим Карточкин' })).toBeVisible();
    await expect(prompt).toContainText('Хип-хоп 8–10 лет');
    const beforeConfirmation = await page.evaluate(async ({ cardStudentId, lessonId }) => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const detail = await api.attendance.get(persisted.state?.token ?? '', lessonId);
      return detail.participants.find(({ studentId }) => studentId === cardStudentId)?.status;
    }, fixture);
    expect(beforeConfirmation).toBeUndefined();
    await prompt.getByRole('button', { name: 'Отметить присутствие' }).click();
    await expect(prompt.getByText('✓ Уже отмечен')).toBeVisible();
    await prompt.getByRole('button', { name: 'Закрыть' }).last().click();

    await page.getByRole('link', { name: 'Посещения', exact: true }).click();
    await page.getByRole('button').filter({ hasText: 'Хип-хоп 8–10 лет' }).click();
    await expect(page.getByText('Присутствуют', { exact: true }).locator('..')).toContainText('3');

    await scan(page, '0000098701');
    const repeatedPrompt = page.getByRole('dialog');
    await expect(repeatedPrompt.getByText('✓ Уже отмечен')).toBeVisible();
    await expect(
      repeatedPrompt.getByRole('button', { name: 'Уже отмечен', exact: true }),
    ).toBeDisabled();
    const finalAttendance = await page.evaluate(async ({ cardStudentId, lessonId }) => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const detail = await api.attendance.get(persisted.state?.token ?? '', lessonId);
      return detail.participants.filter(
        ({ status, studentId }) => studentId === cardStudentId && status === 'PRESENT',
      ).length;
    }, fixture);
    expect(finalAttendance).toBe(1);
  } finally {
    await application.close();
  }
});
