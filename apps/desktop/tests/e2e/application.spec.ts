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

    await window.reload();
    await expect(window.getByRole('heading', { name: 'Петрова Мила' })).toBeVisible();
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
