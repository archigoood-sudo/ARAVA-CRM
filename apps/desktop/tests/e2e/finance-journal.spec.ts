import { _electron as electron, expect, test } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { resolve } from 'node:path';

test('журнал финансов показывает оплаты, возвраты, фильтры и сохраняет контекст', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 150_000);
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userData = `--user-data-dir=${testInfo.outputPath('finance-journal-user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userData], executablePath })
    : await electron.launch({ args: ['.', userData], cwd: resolve(import.meta.dirname, '../..') });
  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!FinanceJournalE2E2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!FinanceJournalE2E2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await page.waitForFunction(() => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { user?: { mustChangePassword?: boolean } };
      };
      return persisted.state?.user?.mustChangePassword === false;
    });

    const context = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Журнал финансов E2E' });
      const anna = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Анна',
        lastName: 'Журналова E2E',
        phone: '+79991110001',
        status: 'ACTIVE',
      });
      const boris = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Борис',
        lastName: 'Безналичный E2E',
        phone: '+79991110002',
        status: 'ACTIVE',
      });
      const cash = await api.payments.create(token, {
        amount: 330_000,
        branchId: branch.id,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
        studentId: anna.id,
      });
      await api.refunds.create(token, cash.id, {
        amount: 100_000,
        reason: 'Возврат E2E',
        refundedAt: new Date().toISOString(),
      });
      await api.payments.create(token, {
        amount: 200_000,
        branchId: branch.id,
        paidAt: new Date().toISOString(),
        paymentMethod: 'SBP',
        studentId: boris.id,
      });
      return { annaId: anna.id };
    });

    await page.getByRole('link', { name: 'Финансы' }).click();
    await page.getByRole('button', { name: 'Операции' }).click();
    await expect(page.getByRole('region', { name: 'Журнал финансовых операций' })).toBeVisible();
    await expect(page.getByText('Журналова E2E Анна').first()).toBeVisible();
    await expect(page.getByText('Безналичный E2E Борис').first()).toBeVisible();
    await expect(page.getByText('Возвращено').first().locator('..')).toContainText('1 000 ₽');
    await expect(page.getByText('Чистый приход').locator('..')).toContainText('4 300 ₽');

    await page.getByLabel('Способ оплаты журнала').selectOption('CASH');
    await expect(page.getByText('Безналичный E2E Борис')).toHaveCount(0);
    await expect(page.getByText('Журналова E2E Анна').first()).toBeVisible();
    await page.getByLabel('Тип финансовой операции').selectOption('REFUND');
    await expect(page.getByText('Возврат').last()).toBeVisible();
    await expect(page.getByText('Оплачено')).toHaveCount(0);

    await page.getByText('Журналова E2E Анна').first().click();
    await expect(page).toHaveURL(new RegExp(`/students/${context.annaId}$`, 'u'));
    await page.goBack();
    await expect(page).toHaveURL(/finance\?.*view=operations.*method=CASH.*type=REFUND/u);
    await expect(page.getByLabel('Способ оплаты журнала')).toHaveValue('CASH');
    await expect(page.getByLabel('Тип финансовой операции')).toHaveValue('REFUND');
  } finally {
    await application.close();
  }
});
