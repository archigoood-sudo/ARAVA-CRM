import { _electron as electron, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const ownerEmail = 'owner@arava.local';
const initialPassword = 'Arava!ChangeMe1';
const securePassword = 'Owner!Secure2026';

test('вход, создание филиала, ученика и контакта родителя, восстановление и выход', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(120_000);
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
    await expect(window.getByRole('heading', { name: 'Создайте новый пароль' })).toBeVisible();
    await window.getByLabel('Новый пароль', { exact: true }).fill(securePassword);
    await window.getByLabel('Повторите новый пароль').fill(securePassword);
    await window.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(window.getByRole('heading', { name: /^Сегодня,/u })).toBeVisible();

    await window.getByRole('link', { name: 'Филиалы', exact: true }).click();
    await window.getByRole('button', { name: 'Создать филиал' }).click();
    const branchDialog = window.getByRole('dialog');
    await branchDialog.getByLabel('Название филиала').fill('Центральный филиал');
    await branchDialog.getByLabel('Адрес').fill('ул. Арава, 12');
    await branchDialog.getByLabel('Телефон').fill('+7 (999) 123-45-67');
    await branchDialog.getByRole('button', { name: 'Создать филиал' }).click();
    await expect(window.getByText('Центральный филиал')).toBeVisible();

    await window.getByRole('link', { name: 'Филиалы и залы' }).click();
    await expect(window.getByRole('heading', { name: 'Центральный филиал' })).toBeVisible();
    const addRoomButton = window.getByRole('button', { name: 'Добавить зал' });
    await expect(addRoomButton).toBeEnabled();
    await addRoomButton.click();
    const roomDialog = window.getByRole('dialog');
    await expect(roomDialog).toBeVisible();
    const roomNameField = roomDialog.locator('input').nth(0);
    const roomCapacityField = roomDialog.locator('input').nth(1);
    await expect(roomNameField).toBeEditable();
    await roomNameField.fill('Зал E2E');
    await roomCapacityField.fill('20');
    await expect(roomDialog.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
    await roomDialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(window.getByText('Зал E2E')).toBeVisible();
    await addRoomButton.click();
    await expect(roomDialog).toBeVisible();
    await roomNameField.fill('Зал 2 E2E');
    await roomCapacityField.fill('15');
    await roomDialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(window.getByText('Зал 2 E2E')).toBeVisible();

    await window.getByRole('link', { name: 'Ученики' }).click();
    await window.getByRole('button', { name: 'Добавить ученика' }).click();
    const studentDialog = window.getByRole('dialog');
    await studentDialog.getByLabel('Фамилия').fill('Петрова');
    await studentDialog.getByLabel('Имя').fill('Мила');
    await studentDialog.getByLabel('Телефон').fill('+7 (999) 333-22-11');
    await studentDialog.getByRole('button', { name: 'Добавить ученика' }).click();
    await expect(window.getByRole('link', { name: /Петрова Мила/u })).toBeVisible();

    await window.getByRole('button', { name: 'Добавить ученика' }).click();
    await studentDialog.getByLabel('Фамилия').fill('Соколова');
    await studentDialog.getByLabel('Имя').fill('Ирина');
    await studentDialog.getByRole('button', { name: 'Добавить ученика' }).click();
    await expect(window.getByRole('link', { name: /Соколова Ирина/u })).toBeVisible();

    await window.getByRole('link', { name: 'Главная', exact: true }).click();
    await window.setViewportSize({ height: 768, width: 1366 });
    await expect(window.getByRole('heading', { name: /^Сегодня,/u })).toBeVisible();
    const today = window.getByRole('region', { name: 'Показатели сегодня' });
    await expect(today.getByText('Ожидается')).toBeVisible();
    await expect(today.getByText('Уже пришли')).toBeVisible();
    await expect(today.getByText('Пробных')).toBeVisible();
    await expect(window.getByText('Получено сегодня')).toBeVisible();
    await expect(window.getByText('Ход дня', { exact: true })).toHaveCount(0);
    await expect(window.getByRole('heading', { name: 'Сейчас в студии' })).toBeVisible();
    await expect(window.getByRole('heading', { name: 'Ближайшие' })).toBeVisible();
    await expect(window.getByRole('heading', { name: 'Требуют внимания' })).toBeVisible();
    await expect
      .poll(() =>
        window.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    const noSubscriptionTask = window
      .locator('article')
      .filter({ hasText: 'У Петрова Мила нет действующего абонемента.' });
    await expect(noSubscriptionTask).toBeVisible();
    await noSubscriptionTask.getByRole('button', { name: 'Оформить абонемент' }).click();
    await expect(window.getByRole('heading', { name: 'Петрова Мила' })).toBeVisible();
    await window.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click();

    await window.getByRole('button', { name: 'Добавить контакт' }).click();
    const contactDialog = window.getByRole('dialog');
    await contactDialog.getByLabel('Имя и фамилия контактного лица').fill('Анна Петрова');
    await contactDialog.getByLabel('Кем приходится').fill('Мама');
    await contactDialog.getByLabel('Телефон контактного лица').fill('+7 (999) 444-55-66');
    await contactDialog.getByText('Основной контакт', { exact: true }).click();
    await contactDialog.getByRole('button', { name: 'Добавить контакт' }).click();
    await expect(window.getByText('Анна Петрова')).toBeVisible();
    await expect(window.getByText('+79994445566')).toBeVisible();

    await window.getByRole('link', { name: 'Тарифы' }).click();
    await window.getByRole('button', { name: 'Создать тариф' }).click();
    const tariffDialog = window.getByRole('dialog');
    await tariffDialog.getByLabel('Название').fill('Абонемент E2E');
    await tariffDialog.getByLabel('Доступность').selectOption({ label: 'Центральный филиал' });
    await tariffDialog.getByLabel('Стоимость, ₽').fill('4000');
    await tariffDialog.getByLabel('Количество занятий').fill('4');
    await tariffDialog.getByLabel('Доступно дней заморозки').fill('7');
    await tariffDialog.getByRole('button', { name: 'Сохранить тариф' }).click();
    await expect(window.getByText('Абонемент E2E')).toBeVisible();

    await window.getByRole('link', { name: 'Ученики' }).click();
    await window.getByRole('link', { name: /Петрова Мила/u }).click();
    await window.getByRole('button', { name: 'Продать абонемент' }).first().click();
    const subscriptionDialog = window.getByRole('dialog');
    await subscriptionDialog.getByLabel('Тариф').selectOption({ index: 1 });
    await subscriptionDialog.getByRole('button', { name: 'Продолжить к оплате' }).click();
    const firstPaymentDialog = window.getByRole('dialog');
    await expect(firstPaymentDialog.getByText('Абонемент E2E')).toBeVisible();
    await expect(firstPaymentDialog.getByLabel('Сумма, ₽')).toHaveValue('4000');
    await firstPaymentDialog.getByRole('button', { name: 'Оплатить и выдать' }).click();
    await expect(window.getByRole('button', { name: /Абонемент E2E/u })).toBeVisible();

    await window.getByRole('link', { name: 'Главная', exact: true }).click();
    await expect(
      window.locator('article').filter({ hasText: 'Петрова Мила: есть задолженность' }),
    ).toHaveCount(0);

    await window.getByRole('link', { name: 'Группы', exact: true }).click();
    await window.getByRole('button', { name: 'Создать группу' }).click();
    const groupDialog = window.getByRole('dialog');
    await groupDialog.getByLabel('Название группы').fill('Импульс E2E');
    await groupDialog.getByLabel('Направление').fill('Хип-хоп');
    await groupDialog.getByLabel('Филиал').selectOption({ label: 'Центральный филиал' });
    await groupDialog.getByRole('button', { name: 'Сохранить группу' }).click();
    await expect(window.getByText('Импульс E2E').first()).toBeVisible();

    await window.getByRole('button', { name: 'Создать группу' }).click();
    await groupDialog.getByLabel('Название группы').fill('Ритм E2E');
    await groupDialog.getByLabel('Направление').fill('Контемпорари');
    await groupDialog.getByLabel('Филиал').selectOption({ label: 'Центральный филиал' });
    await groupDialog.getByRole('button', { name: 'Сохранить группу' }).click();
    await expect(window.getByText('Ритм E2E').first()).toBeVisible();

    await window
      .locator('article')
      .filter({ hasText: 'Импульс E2E' })
      .getByRole('button', { name: 'Действия' })
      .click();
    await window.getByRole('button', { name: 'Добавить учеников' }).first().click();
    const enrollmentSelection = window.getByRole('dialog', { name: 'Добавить учеников' });
    await expect(enrollmentSelection.getByLabel('Выбрать Петрова Мила')).toBeVisible();
    await expect(enrollmentSelection.getByLabel('Выбрать Соколова Ирина')).toBeVisible();
    await enrollmentSelection.getByLabel('Выбрать Петрова Мила').check();
    await enrollmentSelection.getByRole('button', { name: 'Продолжить' }).click();
    const enrollmentDialog = window.getByRole('dialog', { name: 'Добавить в группу' });
    await enrollmentDialog.getByRole('button', { name: 'Проверить изменения' }).click();
    await enrollmentDialog.getByRole('button', { name: 'Добавить 1 учеников' }).click();
    await expect(window.getByText('Петрова Мила')).toBeVisible();

    await window.getByRole('link', { name: 'Ученики' }).click();
    await window.getByRole('link', { name: /Петрова Мила/u }).click();
    await window.getByRole('button', { name: 'Добавить в группу' }).first().click();
    const groupMembershipDialog = window.getByRole('dialog', { name: 'Добавить в группу' });
    const groupMembershipSelect = groupMembershipDialog.getByLabel('Группа');
    const rhythmOption = groupMembershipSelect.getByRole('option', { name: /Ритм E2E/u });
    await expect(rhythmOption).toBeAttached();
    await expect(groupMembershipSelect.getByRole('option', { name: /Импульс E2E/u })).toHaveCount(
      0,
    );
    await groupMembershipSelect.selectOption((await rhythmOption.getAttribute('value')) ?? '');
    await groupMembershipDialog.getByRole('button', { name: 'Проверить изменения' }).click();
    await groupMembershipDialog.getByRole('button', { name: 'Добавить 1 учеников' }).click();
    await expect(groupMembershipDialog).not.toBeVisible();

    await window.getByRole('link', { name: 'Расписание' }).click();
    await window.getByRole('button', { name: 'Добавить в расписание' }).click();
    const scheduleDialog = window.getByRole('dialog');
    await scheduleDialog.locator('select').nth(1).selectOption({ label: 'Импульс E2E' });
    await scheduleDialog
      .locator('select')
      .nth(2)
      .selectOption(String(new Date().getDay() || 7));
    await scheduleDialog.locator('select').nth(4).selectOption({ label: 'Зал E2E' });
    await scheduleDialog.getByRole('button', { name: 'Сохранить расписание' }).click();
    await expect(scheduleDialog).not.toBeVisible();
    await window.getByRole('button', { name: 'Добавить в расписание' }).click();
    await scheduleDialog.locator('select').nth(1).selectOption({ label: 'Ритм E2E' });
    await scheduleDialog
      .locator('select')
      .nth(2)
      .selectOption(String(new Date().getDay() || 7));
    await scheduleDialog.locator('select').nth(4).selectOption({ label: 'Зал 2 E2E' });
    await scheduleDialog.getByRole('button', { name: 'Сохранить расписание' }).click();
    await expect(scheduleDialog).not.toBeVisible();
    const firstRoomSection = window.locator('[data-room-id]').filter({ hasText: 'Зал E2E' });
    const secondRoomSection = window.locator('[data-room-id]').filter({ hasText: 'Зал 2 E2E' });
    await expect(firstRoomSection).toContainText('Импульс E2E');
    await expect(firstRoomSection).not.toContainText('Ритм E2E');
    await expect(secondRoomSection).toContainText('Ритм E2E');
    await expect(secondRoomSection).not.toContainText('Импульс E2E');
    await window.getByRole('link', { name: 'Главная', exact: true }).click();
    const todayLessons = window
      .getByRole('region', { name: 'Показатели сегодня' })
      .getByRole('button')
      .filter({ hasText: 'Занятий' });
    await expect(todayLessons).toContainText('2');
    await window.getByRole('link', { name: 'Расписание', exact: true }).click();
    await window.getByRole('button', { name: 'Создать занятия' }).click();
    await expect(window.getByText(/Создано занятий:/u)).toBeVisible();
    await window.evaluate(() => {
      globalThis.print = () => document.documentElement.setAttribute('data-print-called', 'true');
    });
    await firstRoomSection.getByRole('button', { name: 'Печать недели' }).click();
    await expect
      .poll(() => window.evaluate(() => document.documentElement.dataset.printCalled))
      .toBe('true');
    const printSheet = window.getByTestId('room-week-print-sheet');
    await expect(printSheet).toContainText('Зал E2E');
    await expect(printSheet).toContainText('Импульс E2E');
    await expect(printSheet).not.toContainText('Ритм E2E');
    await expect(printSheet).toContainText(/—/u);
    await window.emulateMedia({ media: 'print' });
    await expect(firstRoomSection.getByRole('button', { name: 'Печать недели' })).not.toBeVisible();
    await window.emulateMedia({ media: 'screen' });
    await window.evaluate(() => globalThis.dispatchEvent(new Event('afterprint')));
    await window.getByRole('button', { name: 'Открыть посещаемость' }).first().click();
    await expect(window.getByRole('heading', { name: 'Импульс E2E', exact: true })).toBeVisible();
    await window.getByRole('button', { name: 'Отметить всех присутствующими' }).click();
    await expect(window.getByText('Присутствовал').first()).toBeVisible();

    await window.getByRole('link', { name: 'Ученики' }).click();
    await window.getByRole('link', { name: /Петрова Мила/u }).click();
    await window.getByRole('button', { name: /Абонемент E2E/u }).click();
    await expect(window.getByText('Использовано 1 из 4')).toBeVisible();
    await window.getByRole('button', { name: 'Закрыть окно' }).last().click();

    await window.getByRole('link', { name: 'Расписание' }).click();
    await window.getByRole('button', { name: 'Открыть посещаемость' }).first().click();
    await window.getByRole('button', { name: 'Петрова Мила: Болел' }).click();
    await expect(window.getByText('Болел').first()).toBeVisible();
    await window.getByRole('link', { name: 'Ученики' }).click();
    await window.getByRole('link', { name: /Петрова Мила/u }).click();
    await window.getByRole('button', { name: /Абонемент E2E/u }).click();
    await expect(window.getByText('Использовано 0 из 4')).toBeVisible();
    await window.getByRole('button', { name: 'Заморозить' }).click();
    const freezeDialog = window.getByRole('dialog');
    await freezeDialog.getByLabel('Количество дней').fill('3');
    await freezeDialog.getByRole('button', { name: 'Заморозить' }).click();
    await expect(window.getByText('Заморожен').first()).toBeVisible();

    await window.getByRole('link', { name: 'Финансы' }).click();
    await window.getByRole('button', { name: 'Операции' }).click();
    const fullPaymentRow = window
      .getByRole('row')
      .filter({ hasText: /4[\s\u00a0]000/u })
      .last();
    await fullPaymentRow.click();
    await window.getByRole('button', { name: 'Оформить возврат' }).click();
    const refundDialog = window.getByRole('dialog').last();
    await refundDialog.getByLabel('Сумма возврата, ₽').fill('4000');
    await refundDialog.getByLabel('Причина возврата').fill('Возврат по заявлению родителя');
    await refundDialog.getByRole('button', { name: 'Оформить возврат' }).click();
    await expect(
      window.getByRole('dialog').first().getByText('Возвращён', { exact: true }),
    ).toBeVisible();

    await window.reload();
    await expect(window.getByRole('heading', { name: 'Финансы' })).toBeVisible();
    await window.getByRole('button', { name: 'Выйти' }).click();
    await expect(window.getByRole('heading', { name: 'Вход в ARAVA' })).toBeVisible();
    await window.getByLabel('Электронная почта').fill(ownerEmail);
    await window.getByLabel('Пароль').fill(securePassword);
    await window.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await expect(window.getByRole('heading', { name: /^Сегодня,/u })).toBeVisible();
  } finally {
    await application.close();
  }
});
