import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { access, stat } from 'node:fs/promises';
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

async function openStudentFromSearch(page: Page, name = 'Документальный Лев') {
  await page.getByRole('button', { name: 'Поиск по приложению' }).click();
  const search = page.getByRole('region', { name: 'Глобальный поиск' });
  await search.getByLabel('Поиск по приложению').fill(name);
  await search.getByRole('button', { name: new RegExp(name, 'u') }).click();
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
        birthDate: '2015-04-12',
        branchId: branch.id,
        firstName: 'Лев',
        lastName: 'Документальный',
        status: 'ACTIVE',
      });
      await api.contacts.create(token, student.id, {
        fullName: 'Анна Документальная',
        isPrimary: true,
        phone: '+79990000011',
        relationship: 'Мама',
        whatsapp: false,
      });
      return student.id;
    });
    await openStudentFromSearch(page);
    const documents = page.getByTestId('student-documents');
    await expect(documents).toBeVisible();

    await documents.getByRole('button', { name: 'Оформить новый' }).click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(documents.getByText(/№ 26-\d{4} · Действует/u)).toBeVisible();

    await documents.getByRole('button', { name: 'Сформировать документы' }).click();
    const packDialog = page.getByRole('dialog', { name: 'Комплект документов' });
    await expect(packDialog.getByText('Несовершеннолетний')).toBeVisible();
    await expect(packDialog.getByRole('listitem')).toHaveCount(4);
    await packDialog
      .getByLabel('Родитель / законный представитель')
      .selectOption({ label: 'Анна Документальная · Мама' });
    await packDialog.getByRole('button', { name: 'Предпросмотр' }).click();
    await expect
      .poll(() => application.windows().some((window) => window.url().includes('/documents.pdf')))
      .toBe(true);
    const previewWindow = application
      .windows()
      .find((window) => window.url().includes('/documents.pdf'));
    expect(previewWindow).toBeDefined();
    if (!previewWindow) throw new Error('Окно предпросмотра PDF не открылось.');
    await previewWindow.waitForLoadState('domcontentloaded');
    await previewWindow.close();
    await expect(documents.getByRole('button', { name: 'Файл' })).toHaveCount(0);

    const savedPdf = testInfo.outputPath('child-document-pack.pdf');
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
    }, savedPdf);
    page.once('dialog', (dialog) => void dialog.accept());
    await packDialog.getByRole('button', { name: 'Сохранить PDF' }).click();
    await expect(documents.getByRole('button', { name: 'Файл' })).toBeVisible();
    await expect
      .poll(async () =>
        stat(savedPdf)
          .then(({ size }) => size)
          .catch(() => 0),
      )
      .toBeGreaterThan(1_000);
    await packDialog.getByRole('button', { name: 'Закрыть', exact: true }).last().click();

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

    const adultId = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const token = persisted.state?.token ?? '';
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const branches = await api.branches.list(token);
      const branchId = branches[0]?.id ?? '';
      const adult = await api.students.create(token, {
        birthDate: '1990-01-10',
        branchId,
        firstName: 'Мария',
        lastName: 'Совершеннолетняя',
        status: 'ACTIVE',
      });
      await api.studentDocuments.create(token, adult.id, {
        documentDate: '2026-08-28',
        documentType: 'CONTRACT',
        source: 'GENERATED',
        status: 'ACTIVE',
      });
      return adult.id;
    });
    await openStudentFromSearch(page, 'Совершеннолетняя Мария');
    await expect(page).toHaveURL(new RegExp(`/students/${adultId}$`, 'u'));
    const adultGenerate = page.getByTestId('generate-document-pack');
    await expect(adultGenerate).toBeVisible();
    await adultGenerate.click();
    const adultPack = page.getByRole('dialog', { name: 'Комплект документов' });
    await expect(adultPack).toBeVisible();
    await expect(adultPack.getByText(/Совершеннолетний/u)).toBeVisible();
    await expect(adultPack.getByLabel('Родитель / законный представитель')).toHaveCount(0);
    await expect(adultPack.getByRole('listitem')).toHaveCount(4);
    const adultPdf = testInfo.outputPath('adult-document-pack.pdf');
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
    }, adultPdf);
    page.once('dialog', (dialog) => void dialog.accept());
    await adultPack.getByRole('button', { name: 'Сохранить PDF' }).click();
    await expect
      .poll(async () =>
        stat(adultPdf)
          .then(({ size }) => size)
          .catch(() => 0),
      )
      .toBeGreaterThan(1_000);
    await adultPack.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
    await expect(access(savedPdf)).resolves.toBeUndefined();
    await expect(access(adultPdf)).resolves.toBeUndefined();
  } finally {
    await application.close().catch(() => undefined);
  }
});
