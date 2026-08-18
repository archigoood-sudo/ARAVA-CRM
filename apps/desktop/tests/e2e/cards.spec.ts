import { _electron as electron, expect, test, type Page } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

const ownerEmail = 'owner@arava.local';
const initialPassword = 'Arava!ChangeMe1';
const ownerPassword = 'Owner!CardsE2E2026';

async function login(page: Page) {
  await page.getByLabel('Электронная почта').fill(ownerEmail);
  await page.getByLabel('Пароль', { exact: true }).fill(initialPassword);
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await page.getByLabel('Новый пароль', { exact: true }).fill(ownerPassword);
  await page.getByLabel('Повторите новый пароль').fill(ownerPassword);
  await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
}

async function scan(page: Page, barcode: string) {
  // Mirrors the real USB scanner's configured inter-character delay.
  await page.keyboard.type(barcode, { delay: 60 });
  await page.keyboard.press('Enter');
}

test('регистрация, привязка, сканирование, утеря и замена заранее напечатанной карты', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(300_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('cards-user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userDataArgument], executablePath })
    : await electron.launch({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const page = await application.firstWindow();
    await login(page);

    await page.getByRole('link', { name: 'Филиалы', exact: true }).click();
    await page.getByRole('button', { name: 'Создать филиал' }).click();
    const branchDialog = page.getByRole('dialog');
    await branchDialog.getByLabel('Название филиала').fill('Карточный филиал');
    await branchDialog.getByRole('button', { name: 'Создать филиал' }).click();

    await page.getByRole('link', { name: 'Ученики', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить ученика' }).click();
    const studentDialog = page.getByRole('dialog');
    await studentDialog.getByLabel('Фамилия').fill('Карточкина');
    await studentDialog.getByLabel('Имя').fill('Анна');
    await studentDialog.getByLabel('Филиал').selectOption({ label: 'Карточный филиал' });
    await studentDialog.getByRole('button', { name: 'Добавить ученика' }).click();
    await page.getByRole('link', { name: 'Карточкина Анна' }).click();
    await expect(page.getByText('Абонементов пока нет')).toBeVisible();
    await expect(page.getByText('Карта не привязана')).toBeVisible();
    const firstStudentId = /\/students\/([^?]+)/u.exec(page.url())?.[1];
    if (!firstStudentId) throw new Error('Идентификатор первого ученика не найден.');
    const attendanceBeforeImmediateScan = await page.evaluate(async (studentId) => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return (await api.students.getProfile(token, studentId)).attendance;
    }, firstStudentId);

    await page.getByRole('link', { name: 'Карты', exact: true }).click();
    await page.getByRole('button', { name: 'Зарегистрировать карту' }).click();
    const registerDialog = page.getByRole('dialog');
    await registerDialog.getByLabel('Штрихкод').fill('0000001001');
    await registerDialog.getByRole('button', { name: 'Зарегистрировать карту' }).click();
    await expect(page.getByText('0000001001', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Привязать карту' }).click();
    const assignDialog = page.getByRole('dialog');
    await assignDialog.getByLabel('Клиент').selectOption({ label: 'Карточкина Анна' });
    await assignDialog.getByRole('button', { name: 'Привязать' }).click();

    // This is intentionally scanned without moving focus after the assignment dialog.
    await scan(page, '0000001001');
    await expect(page).toHaveURL(/\/students\/[^?]+\?openedByCard=1/u);
    await expect(page.getByText('Открыто по карте')).toBeVisible();
    await expect(page.getByText('0000001001', { exact: true })).toBeVisible();
    await expect(page.getByText('Абонементов пока нет')).toBeVisible();

    const fixtures = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = (await api.branches.list(token)).find(
        ({ name }) => name === 'Карточный филиал',
      );
      if (!branch) throw new Error('Тестовый филиал не найден.');
      const createStudent = (firstName: string, lastName: string) =>
        api.students.create(token, {
          branchId: branch.id,
          firstName,
          lastName,
          status: 'ACTIVE',
        });
      const secondStudent = await createStudent('Борис', 'Повторный');
      const blockedStudent = await createStudent('Блок', 'Карточный');
      const lostStudent = await createStudent('Потеря', 'Карточная');
      await api.cards.assign(token, {
        barcode: '0000001010',
        registerIfUnknown: true,
        studentId: secondStudent.id,
      });
      const blockedCard = await api.cards.assign(token, {
        barcode: '0000001020',
        registerIfUnknown: true,
        studentId: blockedStudent.id,
      });
      const lostCard = await api.cards.assign(token, {
        barcode: '0000001030',
        registerIfUnknown: true,
        studentId: lostStudent.id,
      });
      await api.cards.block(token, blockedCard.id, {});
      await api.cards.markLost(token, lostCard.id, {});
      await api.cards.register(token, { barcode: '0000001040' });
      const firstCard = await api.cards.find(token, '0000001001');
      if (!firstCard?.studentId) throw new Error('Первая карта не привязана.');
      const secondProfile = await api.students.getProfile(token, secondStudent.id);
      return {
        secondAttendanceBefore: secondProfile.attendance,
        firstStudentId: firstCard.studentId,
        secondStudentId: secondStudent.id,
      };
    });

    for (const pageName of ['Ученики', 'Группы', 'Расписание', 'Финансы', 'Настройки']) {
      await page.getByRole('link', { name: pageName, exact: true }).click();
      await scan(page, '0000001001');
      await expect(page).toHaveURL(
        new RegExp(`/students/${fixtures.firstStudentId}\\?openedByCard=1$`, 'u'),
      );
      await expect(page.getByText('Открыто по карте')).toBeVisible();
    }

    await scan(page, '0000001010');
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixtures.secondStudentId}\\?openedByCard=1$`, 'u'),
    );
    await scan(page, '0000001001');
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixtures.firstStudentId}\\?openedByCard=1$`, 'u'),
    );
    const scanCount = async () =>
      page.evaluate(async () => {
        const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
          state?: { token?: string };
        };
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        return (await api.cards.scanHistory(persisted.state?.token ?? '')).length;
      });
    const scansBeforeSameCard = await scanCount();
    await scan(page, '0000001001');
    await expect(page.getByText('Открыто по карте')).toBeVisible();
    await expect.poll(scanCount).toBe(scansBeforeSameCard + 1);
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixtures.firstStudentId}\\?openedByCard=1$`, 'u'),
    );

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const globalSearch = page.getByRole('region', { name: 'Глобальный поиск' });
    const globalSearchInput = globalSearch.getByLabel('Поиск по приложению');
    await globalSearchInput.pressSequentially('123456', { delay: 120 });
    await globalSearchInput.press('Enter');
    await expect(globalSearchInput).toHaveValue('123456');
    await globalSearchInput.fill('');
    await scan(page, '0000001010');
    await expect(globalSearch).toBeHidden();
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixtures.secondStudentId}\\?openedByCard=1$`, 'u'),
    );

    const attendanceAfterScans = await page.evaluate(
      async ({ firstStudentId, secondStudentId }) => {
        const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
          state?: { token?: string };
        };
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        const token = persisted.state?.token ?? '';
        const [firstProfile, secondProfile] = await Promise.all([
          api.students.getProfile(token, firstStudentId),
          api.students.getProfile(token, secondStudentId),
        ]);
        return {
          first: firstProfile.attendance,
          second: secondProfile.attendance,
        };
      },
      fixtures,
    );
    expect(attendanceAfterScans).toEqual({
      first: attendanceBeforeImmediateScan,
      second: fixtures.secondAttendanceBefore,
    });

    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    for (const invalid of [
      { barcode: '0000001040', message: 'Карта не привязана' },
      { barcode: '0000001020', message: 'Карта заблокирована' },
      { barcode: '0000001030', message: 'Карта потеряна' },
      { barcode: '0000001099', message: 'Карта не найдена' },
    ]) {
      const currentUrl = page.url();
      await scan(page, invalid.barcode);
      await expect(page.getByText(invalid.message, { exact: true })).toBeVisible();
      expect(page.url()).toBe(currentUrl);
    }

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('link', { name: 'Ученики', exact: true }).click();
    await page.getByRole('link', { name: 'Карточкина Анна' }).click();
    await page.getByRole('button', { name: 'Карта утеряна' }).click();
    await expect(page.getByText('Утеряна')).toBeVisible();
    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    const dashboardUrl = page.url();
    await scan(page, '0000001001');
    await expect(page.getByText('Карта потеряна', { exact: true })).toBeVisible();
    expect(page.url()).toBe(dashboardUrl);

    await page.getByRole('link', { name: 'Ученики', exact: true }).click();
    await page.getByRole('link', { name: 'Карточкина Анна' }).click();
    await page.getByRole('button', { name: 'Привязать новую карту' }).click();
    const replacementDialog = page.getByRole('dialog');
    await replacementDialog.getByLabel('Штрихкод новой карты').fill('0000001002');
    await replacementDialog.getByRole('button', { name: 'Привязать карту' }).click();
    await expect(page.getByText('0000001002', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    await scan(page, '0000001002');
    await expect(page).toHaveURL(/\/students\/[^?]+\?openedByCard=1/u);
    await expect(page.getByText('0000001002', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Карты', exact: true }).click();
    await page.getByLabel('Поиск карты или клиента').fill('0000001001');
    await expect(page.getByText('0000001001', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'История карты' }).click();
    await expect(page.getByText('Карта отмечена как утерянная')).toBeVisible();
  } finally {
    await application.close();
  }
});
