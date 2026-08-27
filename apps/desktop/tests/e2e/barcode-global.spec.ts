import { _electron as electron, expect, test, type Page } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

const ownerPassword = 'Owner!GlobalBarcode2026';
const scannerDelayMs = 120;

async function login(page: Page) {
  await page.getByLabel('Электронная почта').fill('owner@arava.local');
  await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
  await page.getByLabel('Новый пароль', { exact: true }).fill(ownerPassword);
  await page.getByLabel('Повторите новый пароль').fill(ownerPassword);
  await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
  await expect(page.getByRole('link', { name: 'Главная', exact: true })).toBeVisible();
  await page.waitForFunction(() => {
    const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
      state?: { user?: { mustChangePassword?: boolean } };
    };
    return persisted.state?.user?.mustChangePassword === false;
  });
}

async function scan(page: Page, barcode: string, withEnter = true) {
  await page.keyboard.type(barcode, { delay: scannerDelayMs });
  if (withEnter) await page.keyboard.press('Enter');
}

async function openScannedProfile(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Сегодня занятий не найдено')).toBeVisible();
  await dialog.getByRole('button', { name: 'Открыть профиль' }).click();
}

test('глобальный сканер открывает профиль без фокуса в поиске и не меняет посещаемость', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(120_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('global-barcode-user-data')}`;
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
      const branch = await api.branches.create(token, { name: 'Филиал сканера' });
      const firstStudent = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Анна',
        lastName: 'Сканерова',
        status: 'ACTIVE',
      });
      const secondStudent = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Борис',
        lastName: 'Сканеров',
        status: 'ACTIVE',
      });
      const blockedStudent = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Блок',
        lastName: 'Сканеров',
        status: 'ACTIVE',
      });
      await api.cards.assign(token, {
        barcode: '0000091201',
        registerIfUnknown: true,
        studentId: firstStudent.id,
      });
      await api.cards.assign(token, {
        barcode: '0000091202',
        registerIfUnknown: true,
        studentId: secondStudent.id,
      });
      const blockedCard = await api.cards.assign(token, {
        barcode: '0000091203',
        registerIfUnknown: true,
        studentId: blockedStudent.id,
      });
      await api.cards.block(token, blockedCard.id, {});
      const [firstProfile, secondProfile] = await Promise.all([
        api.students.getProfile(token, firstStudent.id),
        api.students.getProfile(token, secondStudent.id),
      ]);
      return {
        attendanceBefore: {
          first: firstProfile.attendance,
          second: secondProfile.attendance,
        },
        firstStudentId: firstStudent.id,
        secondStudentId: secondStudent.id,
      };
    });

    await page.getByRole('link', { name: 'Группы', exact: true }).click();
    await expect(page).toHaveURL(/\/groups$/u);
    await page.getByRole('heading', { name: 'Танцевальные группы', exact: true }).click();
    await scan(page, '0000091201', false);
    await openScannedProfile(page);
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixture.firstStudentId}\\?openedByCard=1$`, 'u'),
    );

    await page.getByRole('link', { name: 'Расписание', exact: true }).click();
    await page.getByRole('heading', { name: 'Расписание занятий', exact: true }).click();
    await scan(page, '0000091201');
    await openScannedProfile(page);
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixture.firstStudentId}\\?openedByCard=1$`, 'u'),
    );
    await scan(page, '0000091202', false);
    await openScannedProfile(page);
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixture.secondStudentId}\\?openedByCard=1$`, 'u'),
    );
    await scan(page, '0000091201');
    await openScannedProfile(page);
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixture.firstStudentId}\\?openedByCard=1$`, 'u'),
    );

    await page.getByRole('link', { name: 'Финансы', exact: true }).click();
    const financeUrl = page.url();
    await scan(page, '0000091299');
    await expect(page.getByText('Карта не найдена', { exact: true })).toBeVisible();
    expect(page.url()).toBe(financeUrl);
    await scan(page, '0000091203');
    await expect(page.getByText('Карта заблокирована', { exact: true })).toBeVisible();
    expect(page.url()).toBe(financeUrl);
    await scan(page, '0000091201');
    await openScannedProfile(page);
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixture.firstStudentId}\\?openedByCard=1$`, 'u'),
    );

    await page.getByRole('link', { name: 'Группы', exact: true }).click();
    await page.getByRole('button', { name: 'Создать группу' }).click();
    const groupName = page.getByRole('dialog').getByLabel('Название группы');
    await groupName.pressSequentially('Ручной ввод', { delay: 220 });
    await expect(groupName).toHaveValue('Ручной ввод');
    await scan(page, '0000091202');
    await openScannedProfile(page);
    await expect(page).toHaveURL(
      new RegExp(`/students/${fixture.secondStudentId}\\?openedByCard=1$`, 'u'),
    );

    const attendanceAfter = await page.evaluate(async ({ firstStudentId, secondStudentId }) => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const [firstProfile, secondProfile] = await Promise.all([
        api.students.getProfile(token, firstStudentId),
        api.students.getProfile(token, secondStudentId),
      ]);
      return { first: firstProfile.attendance, second: secondProfile.attendance };
    }, fixture);
    expect(attendanceAfter).toEqual(fixture.attendanceBefore);
  } finally {
    await application.close();
  }
});
