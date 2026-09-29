import { expect, test } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';
import { launchElectron } from './electron-launch';

test('attendance and schedule share lesson substitution across replacement, removal and restart', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(180_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('substitution-user-data')}`;
  const launch = () =>
    executablePath
      ? launchElectron({ args: [userDataArgument], executablePath })
      : launchElectron({
          args: ['.', userDataArgument],
          cwd: resolve(import.meta.dirname, '../..'),
        });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!Substitution2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!Substitution2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByRole('link', { name: 'Посещения', exact: true })).toBeVisible();
    const fixture = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Замена E2E' });
      const coaches = [];
      for (const [name, key] of [
        ['Анна Основная', 'regular'],
        ['Мария Замена', 'substitute'],
        ['Елена Вторая', 'second'],
      ]) {
        const result = await api.users.create(token, {
          branchIds: [branch.id],
          fullName: name ?? '',
          email: `${key ?? ''}-substitution-e2e@arava.local`,
          role: 'COACH',
        });
        coaches.push(result.user);
      }
      const [regular, substitute, second] = coaches;
      if (!regular || !substitute || !second) throw new Error('Missing trainer');
      const group = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 10,
        coachId: regular.id,
        name: 'Замена из посещений',
        direction: 'Танцы',
        status: 'ACTIVE',
      });
      const lesson = await api.lessons.create(token, {
        groupId: group.id,
        coachId: regular.id,
        startsAt: '2026-08-10T15:00:00Z',
        endsAt: '2026-08-10T16:00:00Z',
      });
      const future = await api.lessons.create(token, {
        groupId: group.id,
        coachId: regular.id,
        startsAt: '2026-08-17T15:00:00Z',
        endsAt: '2026-08-17T16:00:00Z',
      });
      return {
        token,
        lessonId: lesson.id,
        futureId: future.id,
        regularId: regular.id,
        substituteId: substitute.id,
        secondId: second.id,
      };
    });
    const navigate = async (route: string) => {
      await page.evaluate((value) => {
        location.hash = value;
      }, route);
    };
    await navigate(`/attendance/${fixture.lessonId}`);
    const control = () => page.getByTestId('lesson-substitution');
    async function assign(id: string, button: string) {
      await control().getByRole('button', { name: button, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Заменяющий тренер').selectOption(id);
      await expect(dialog.getByText('Основной тренер: Анна Основная')).toBeVisible();
      await dialog.getByRole('button', { name: 'Сохранить замену', exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
    await assign(fixture.substituteId, 'Замена');
    await expect(control()).toContainText('Тренер: Мария Замена');
    await expect(control()).toContainText('Замена вместо Анна Основная');
    await assign(fixture.secondId, 'Изменить');
    await expect(control()).toContainText('Тренер: Елена Вторая');
    await control().getByRole('button', { name: 'Снять замену', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Снять замену', exact: true })
      .click();
    await expect(control()).toContainText('Тренер: Анна Основная');
    await assign(fixture.substituteId, 'Замена');
    await navigate(`/lessons/${fixture.lessonId}`);
    await expect(control()).toContainText('Тренер: Мария Замена');
    await assign(fixture.secondId, 'Изменить');
    await navigate(`/attendance/${fixture.lessonId}`);
    await expect(control()).toContainText('Тренер: Елена Вторая');
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(page.getByRole('link', { name: 'Посещения', exact: true })).toBeVisible();
    await navigate(`/attendance/${fixture.lessonId}`);
    await expect(control()).toContainText('Тренер: Елена Вторая');
    await page.evaluate(async ({ token, futureId, regularId, lessonId }) => {
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      if ((await api.lessons.get(token, futureId)).coachId !== regularId)
        throw new Error('Future trainer changed');
      await api.lessons.cancel(token, lessonId, {
        cancellationReason: 'Проверка отменённого занятия',
      });
    }, fixture);
    await page.reload();
    await expect(page.getByText('Не удалось загрузить посещаемость занятия.')).toBeVisible();
    await expect(control()).toHaveCount(0);
    await navigate(`/lessons/${fixture.lessonId}`);
    await expect(control()).toBeVisible();
    await expect(control().getByRole('button')).toHaveCount(0);
  } finally {
    await application.close();
  }
});
