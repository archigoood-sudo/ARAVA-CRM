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

const password = 'Owner!DocumentsE2E2026';

async function launch(userData: string): Promise<ElectronApplication> {
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  return executablePath
    ? electron.launch({ args: [`--user-data-dir=${userData}`], executablePath })
    : electron.launch({
        args: ['.', `--user-data-dir=${userData}`],
        cwd: resolve(import.meta.dirname, '../..'),
      });
}

async function login(page: Page, email: string, pass: string) {
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
}

async function openStudentFromSearch(page: Page) {
  await page.getByRole('button', { name: 'Поиск по приложению' }).click();
  const search = page.getByRole('region', { name: 'Глобальный поиск' });
  await search.getByLabel('Поиск по приложению').fill('Документальный Лев');
  await search.getByRole('button', { name: /Документальный Лев/u }).click();
}

test('договор и существующее media-согласие сохраняются после перезапуска', async ({
  request: _request,
}, testInfo: TestInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 150_000);
  const userData = testInfo.outputPath('student-documents-user-data');
  let application = await launch(userData);
  let studentId = '';
  try {
    let page = await application.firstWindow();
    await login(page, 'owner@arava.local', 'Arava!ChangeMe1');
    await page.getByLabel('Новый пароль', { exact: true }).fill(password);
    await page.getByLabel('Повторите новый пароль').fill(password);
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByRole('link', { name: 'Главная', exact: true })).toBeVisible();
    studentId = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branch = await api.branches.create(token, { name: 'Документы E2E' });
      const student = await api.students.create(token, {
        branchId: branch.id,
        firstName: 'Лев',
        lastName: 'Документальный',
        status: 'ACTIVE',
      });
      return student.id;
    });
    await openStudentFromSearch(page);
    const documents = page.getByTestId('student-documents');
    await expect(documents).toBeVisible();

    await documents.getByRole('button', { name: 'Оформить новый' }).click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(documents.getByText(/№ 26-\d{4} · Действует/u)).toBeVisible();

    await documents.getByRole('button', { name: 'Добавить существующий' }).click();
    const addDocumentDialog = page.getByRole('dialog');
    await addDocumentDialog.getByLabel('Тип документа').selectOption('MEDIA_CONSENT');
    await addDocumentDialog.getByLabel('Состояние').selectOption('NOT_ALLOWED');
    await addDocumentDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(documents.getByText(/Не разрешено/u).first()).toBeVisible();

    await application.close();
    application = await launch(userData);
    page = await application.firstWindow();
    if (
      await page
        .getByLabel('Электронная почта')
        .isVisible()
        .catch(() => false)
    ) {
      await login(page, 'owner@arava.local', password);
    }
    await openStudentFromSearch(page);
    await expect(page).toHaveURL(new RegExp(`/students/${studentId}$`, 'u'));
    await expect(
      page.getByTestId('student-documents').getByText(/№ 26-\d{4} · Действует/u),
    ).toBeVisible();
    await expect(
      page
        .getByTestId('student-documents')
        .getByText(/Не разрешено/u)
        .first(),
    ).toBeVisible();
  } finally {
    await application.close().catch(() => undefined);
  }
});
