import { _electron as electron, expect, test, type Page } from '@playwright/test';
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
  await page.locator('main').click({ position: { x: 5, y: 5 } });
  await page.keyboard.type(barcode, { delay: 1 });
  await page.keyboard.press('Enter');
}

test('регистрация, привязка, сканирование, утеря и замена заранее напечатанной карты', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 300_000 : 150_000);
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

    await scan(page, '0000001001');
    await expect(page).toHaveURL(/\/students\/[^?]+\?openedByCard=1/u);
    await expect(page.getByText('Открыто по карте')).toBeVisible();
    await expect(page.getByText('0000001001', { exact: true })).toBeVisible();
    await expect(page.getByText('Абонементов пока нет')).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Карта утеряна' }).click();
    await expect(page.getByText('Утеряна')).toBeVisible();
    await page.getByRole('link', { name: 'Главная', exact: true }).click();
    const dashboardUrl = page.url();
    await scan(page, '0000001001');
    await expect(page.getByText('Карта отмечена как утерянная')).toBeVisible();
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
