import { _electron as electron, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const ownerEmail = 'owner@arava.local';
const initialPassword = 'Arava!ChangeMe1';
const securePassword = 'Owner!Secure2026';

test('вход, создание филиала, ученика и контакта родителя, восстановление и выход', async ({
  request: _request,
}, testInfo) => {
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userDataArgument], executablePath })
    : await electron.launch({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const window = await application.firstWindow();
    await expect(window).toHaveTitle('ARAVA CRM');
    await expect.poll(() => window.evaluate(() => Object.hasOwn(globalThis, 'arava'))).toBe(true);
    await expect(window.getByRole('heading', { name: 'Вход в ARAVA' })).toBeVisible();

    await window.getByLabel('Электронная почта').fill(ownerEmail);
    await window.getByLabel('Пароль').fill(initialPassword);
    await window.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await expect(
      window.getByRole('heading', { name: 'Защитите свою учётную запись' }),
    ).toBeVisible();
    await window.getByLabel('Текущий пароль').fill(initialPassword);
    await window.getByLabel('Новый пароль').fill(securePassword);
    await window.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(
      window.getByRole('heading', {
        name: /(Доброе утро|Добрый день|Добрый вечер|Доброй ночи), Владелец/u,
      }),
    ).toBeVisible();

    await window.getByRole('link', { name: 'Филиалы' }).click();
    await window.getByRole('button', { name: 'Создать филиал' }).click();
    const branchDialog = window.getByRole('dialog');
    await branchDialog.getByLabel('Название филиала').fill('Центральный филиал');
    await branchDialog.getByLabel('Адрес').fill('ул. Арава, 12');
    await branchDialog.getByLabel('Телефон').fill('+7 (999) 123-45-67');
    await branchDialog.getByRole('button', { name: 'Создать филиал' }).click();
    await expect(window.getByText('Центральный филиал')).toBeVisible();

    await window.getByRole('link', { name: 'Ученики' }).click();
    await window.getByRole('button', { name: 'Добавить ученика' }).click();
    const studentDialog = window.getByRole('dialog');
    await studentDialog.getByLabel('Фамилия').fill('Петрова');
    await studentDialog.getByLabel('Имя').fill('Мила');
    await studentDialog.getByLabel('Телефон').fill('+7 (999) 333-22-11');
    await studentDialog.getByRole('button', { name: 'Добавить ученика' }).click();
    await expect(window.getByRole('link', { name: /Петрова Мила/u })).toBeVisible();

    await window.getByRole('link', { name: /Петрова Мила/u }).click();
    await window.getByRole('button', { name: 'Добавить контакт' }).click();
    const contactDialog = window.getByRole('dialog');
    await contactDialog.getByLabel('Имя и фамилия контактного лица').fill('Анна Петрова');
    await contactDialog.getByLabel('Кем приходится').fill('Мама');
    await contactDialog.getByLabel('Телефон контактного лица').fill('+7 (999) 444-55-66');
    await contactDialog.getByText('Основной контакт', { exact: true }).click();
    await contactDialog.getByRole('button', { name: 'Добавить контакт' }).click();
    await expect(window.getByText('Анна Петрова')).toBeVisible();
    await expect(window.getByText('+79994445566')).toBeVisible();

    await window.getByRole('link', { name: 'Группы' }).click();
    await window.getByRole('button', { name: 'Создать группу' }).click();
    const groupDialog = window.getByRole('dialog');
    await groupDialog.getByLabel('Название группы').fill('Импульс E2E');
    await groupDialog.getByLabel('Направление').fill('Хип-хоп');
    await groupDialog.getByLabel('Филиал').selectOption({ label: 'Центральный филиал' });
    await groupDialog.getByRole('button', { name: 'Сохранить группу' }).click();
    await expect(window.getByText('Импульс E2E')).toBeVisible();
    await window.getByRole('button', { name: 'Действия' }).click();
    await window.getByRole('button', { name: 'Добавить ученика' }).click();
    const enrollmentDialog = window.getByRole('dialog');
    await enrollmentDialog.getByLabel('Выберите ученика').selectOption({ label: 'Петрова Мила' });
    await enrollmentDialog.getByRole('button', { name: 'Добавить в группу' }).click();
    await expect(window.getByText('Петрова Мила')).toBeVisible();

    await window.getByRole('link', { name: 'Расписание' }).click();
    await window.getByRole('button', { name: 'Добавить в расписание' }).click();
    const scheduleDialog = window.getByRole('dialog');
    await scheduleDialog.locator('select').nth(1).selectOption({ label: 'Импульс E2E' });
    await scheduleDialog
      .locator('select')
      .nth(2)
      .selectOption(String(new Date().getDay() || 7));
    await scheduleDialog.locator('input[type="text"]').fill('Зал E2E');
    await scheduleDialog.getByRole('button', { name: 'Сохранить расписание' }).click();
    await expect(window.getByText('Импульс E2E')).toBeVisible();
    await window.getByRole('button', { name: 'Создать занятия' }).click();
    await expect(window.getByText(/Создано занятий:/u)).toBeVisible();
    await window.getByRole('button', { name: 'Открыть посещаемость' }).first().click();
    await expect(
      window.getByRole('heading', { name: /Посещаемость · Импульс E2E/u }),
    ).toBeVisible();
    await window.getByRole('button', { name: 'Отметить всех присутствующими' }).click();
    await expect(window.getByText('Присутствовал')).toBeVisible();

    await window.reload();
    await expect(
      window.getByRole('heading', { name: /Посещаемость · Импульс E2E/u }),
    ).toBeVisible();
    await window.getByRole('button', { name: 'Выйти' }).click();
    await expect(window.getByRole('heading', { name: 'Вход в ARAVA' })).toBeVisible();
    await window.getByLabel('Электронная почта').fill(ownerEmail);
    await window.getByLabel('Пароль').fill(securePassword);
    await window.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await expect(
      window.getByRole('heading', {
        name: /(Доброе утро|Добрый день|Добрый вечер|Доброй ночи), Владелец/u,
      }),
    ).toBeVisible();
  } finally {
    await application.close();
  }
});
