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

const ownerPassword = 'Owner!StudentProfile2026';
const trainerPassword = 'Trainer!StudentProfile2026';

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

async function launchApplication(testInfo: TestInfo): Promise<ElectronApplication> {
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const userDataArgument = `--user-data-dir=${testInfo.outputPath(`student-profile-user-data-${String(attempt)}`)}`;
    const application = executablePath
      ? await electron.launch({ args: [userDataArgument], executablePath })
      : await electron.launch({
          args: ['.', userDataArgument],
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

test('расширенный профиль объединяет работу администратора и безопасный режим тренера', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 300_000 : 180_000);
  const application = await launchApplication(testInfo);

  try {
    const page = await application.firstWindow();
    await login(page, 'owner@arava.local', 'Arava!ChangeMe1');
    await completePassword(page, ownerPassword);
    const context = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Профильный E2E' });
      const hiddenBranch = await api.branches.create(token, { name: 'Скрытый E2E' });
      const trainer = await api.users.create(token, {
        branchIds: [branch.id],
        email: 'trainer-profile-e2e@arava.local',
        fullName: 'Тренер Профиль E2E',
        role: 'COACH',
      });
      const student = await api.students.create(token, {
        birthDate: '2015-04-12',
        branchId: branch.id,
        firstName: 'Анна',
        lastName: 'Профильная E2E',
        status: 'ACTIVE',
      });
      const hiddenStudent = await api.students.create(token, {
        branchId: hiddenBranch.id,
        firstName: 'Скрытая',
        lastName: 'Профильная E2E',
        status: 'ACTIVE',
      });
      const emptyStudent = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Без',
        lastName: 'Группы E2E',
        status: 'ACTIVE',
      });
      const trialStudent = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Пробная',
        lastName: 'Ученица E2E',
        status: 'TRIAL',
      });
      await api.contacts.create(token, student.id, {
        fullName: 'Марина Профильная',
        isPrimary: true,
        phone: '+79990007766',
        relationship: 'Мама',
        whatsapp: true,
      });
      const group = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 20,
        coachId: trainer.user.id,
        direction: 'Хип-хоп',
        name: 'Группа профиля E2E',
        status: 'ACTIVE',
      });
      await api.groups.addEnrollment(token, group.id, {
        joinedAt: new Date().toISOString().slice(0, 10),
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: student.id,
      });
      const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const lesson = await api.lessons.create(token, {
        coachId: trainer.user.id,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000).toISOString(),
        groupId: group.id,
        startsAt: startsAt.toISOString(),
      });
      await api.attendance.save(token, lesson.id, [{ status: 'PRESENT', studentId: student.id }]);
      const tariff = await api.tariffs.create(token, {
        branchId: branch.id,
        currency: 'RUB',
        freezeDays: 7,
        isActive: true,
        lessonCount: 2,
        name: 'Абонемент профиля E2E',
        price: 10_000,
        type: 'LESSON_PACK',
        validityDays: 30,
      });
      const trial = await api.trials.schedule(token, {
        groupId: group.id,
        startsAt: lesson.startsAt,
        studentId: trialStudent.id,
      });
      await api.trials.setOutcome(token, trial.id, {
        expectedVersion: trial.version ?? 1,
        outcome: 'THINKING',
      });
      await api.subscriptions.create(token, {
        initialPayment: {
          amount: 6_000,
          paidAt: new Date().toISOString(),
          paymentMethod: 'CARD',
        },
        salePrice: 10_000,
        startsAt: new Date().toISOString().slice(0, 10),
        studentId: student.id,
        tariffId: tariff.id,
      });
      await api.cards.assign(token, {
        barcode: '0000042111',
        registerIfUnknown: true,
        studentId: student.id,
      });
      return {
        emptyStudentId: emptyStudent.id,
        groupId: group.id,
        hiddenStudentId: hiddenStudent.id,
        studentId: student.id,
        tariffId: tariff.id,
        trainerEmail: trainer.user.email,
        trainerTemporaryPassword: trainer.temporaryPassword,
        trialStudentId: trialStudent.id,
      };
    });

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const search = page.getByRole('region', { name: 'Глобальный поиск' });
    await search.getByLabel('Поиск по приложению').fill('Профильная E2E Анна');
    await search.getByRole('button', { name: /Профильная E2E Анна/u }).click();
    await expect(page).toHaveURL(new RegExp(`/students/${context.studentId}$`, 'u'));
    await expect(page.getByRole('link', { name: 'Группа профиля E2E', exact: true })).toBeVisible();
    await expect(page.getByText('Абонемент профиля E2E').first()).toBeVisible();
    await expect(page.getByText(/Долг:/u).first()).toBeVisible();
    await expect(page.getByText('Присутствовал').first()).toBeVisible();
    await expect(page.getByText('0000042111', { exact: true })).toBeVisible();

    const quickActions = page.getByText('Быстрые действия').locator('..');
    await quickActions.getByRole('button', { name: 'Принять оплату' }).click();
    const paymentDialog = page.getByRole('dialog', { name: 'Новый платёж' });
    await expect(paymentDialog.getByLabel('Сумма, ₽')).toHaveValue('40');
    await paymentDialog.getByRole('button', { name: 'Принять оплату', exact: true }).click();
    await expect(page.getByText('Нет долга', { exact: true }).first()).toBeVisible();

    await page.evaluate((studentId) => {
      window.location.hash = `/students/${studentId}`;
    }, context.emptyStudentId);
    await expect(page).toHaveURL(new RegExp(`/students/${context.emptyStudentId}$`, 'u'));
    await page.getByRole('button', { name: 'Добавить в группу', exact: true }).first().click();
    const membershipDialog = page.getByRole('dialog', { name: 'Добавить в группу' });
    await membershipDialog.getByLabel('Группа', { exact: true }).selectOption(context.groupId);
    await membershipDialog.getByRole('button', { name: 'Проверить изменения' }).click();
    await membershipDialog.getByRole('button', { name: 'Добавить 1 учеников' }).click();
    await expect(page.getByRole('link', { name: 'Группа профиля E2E', exact: true })).toBeVisible();

    await page.evaluate((studentId) => {
      window.location.hash = `/students/${studentId}`;
    }, context.trialStudentId);
    await expect(page).toHaveURL(new RegExp(`/students/${context.trialStudentId}$`, 'u'));
    await expect(page.getByText('Думает', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Оформить абонемент' }).click();
    const subscriptionDialog = page.getByRole('dialog', { name: 'Продажа абонемента' });
    await subscriptionDialog.getByLabel('Тариф').selectOption(context.tariffId);
    await subscriptionDialog.getByLabel('Оплата при продаже').selectOption('NONE');
    page.once('dialog', (dialog) => void dialog.accept());
    await subscriptionDialog.getByRole('button', { name: 'Выдать с задолженностью' }).click();
    await expect(subscriptionDialog).toBeHidden();
    await expect(page.getByText('Активен', { exact: true }).first()).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть окно' }).last().click();

    await page.evaluate((studentId) => {
      window.location.hash = `/students/${studentId}`;
    }, context.studentId);
    await expect(page).toHaveURL(new RegExp(`/students/${context.studentId}$`, 'u'));
    await page.getByRole('button', { name: 'Добавить заметку' }).first().click();
    const noteDialog = page.getByRole('dialog', { name: 'Новая заметка' });
    await noteDialog.getByLabel('Текст заметки').fill('Безопасное действие E2E');
    await noteDialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Безопасное действие E2E')).toBeVisible();

    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.type('0000042111', { delay: 1 });
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').getByRole('button', { name: 'Открыть профиль' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/students/${context.studentId}[?]openedByCard=1$`, 'u'),
    );
    await expect(page.getByText('Открыто по карте')).toBeVisible();

    await page.getByRole('button', { name: 'Выйти' }).click();
    await login(page, context.trainerEmail, context.trainerTemporaryPassword);
    await completePassword(page, trainerPassword);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const trainerSearch = page.getByRole('region', { name: 'Глобальный поиск' });
    await trainerSearch.getByLabel('Поиск по приложению').fill('Профильная E2E Анна');
    await trainerSearch.getByRole('button', { name: /Профильная E2E Анна/u }).click();
    await expect(page.getByRole('link', { name: 'Группа профиля E2E', exact: true })).toBeVisible();
    await expect(page.getByText('Посещаемость')).toBeVisible();
    await expect(page.getByText('Оплаты и задолженность')).toHaveCount(0);
    await expect(page.getByText('Родители и контакты')).toHaveCount(0);
    await expect(page.getByText('Пластиковая карта')).toHaveCount(0);
    const backendIsolation = await page.evaluate(async ({ hiddenStudentId, studentId }) => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const rejected = async (operation: () => Promise<unknown>) => {
        try {
          await operation();
          return false;
        } catch {
          return true;
        }
      };
      return {
        hiddenProfile: await rejected(() => api.students.getProfile(token, hiddenStudentId)),
        noteWrite: await rejected(() =>
          api.students.createNote(token, studentId, { text: 'Запрещено' }),
        ),
        payments: await rejected(() =>
          api.payments.list(token, {
            dateFrom: '2026-01-01',
            dateTo: '2026-12-31',
          }),
        ),
      };
    }, context);
    expect(backendIsolation).toEqual({ hiddenProfile: true, noteWrite: true, payments: true });
  } finally {
    await application.close();
  }
});
