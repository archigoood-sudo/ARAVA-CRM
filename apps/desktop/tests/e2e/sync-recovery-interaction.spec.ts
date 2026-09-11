import { createDatabaseClient, toSqliteUrl } from '@arava/database';
import { expect, test, type ElectronApplication, type Locator } from '@playwright/test';
import { join, resolve } from 'node:path';

import { launchElectron } from './electron-launch';

const initialPassword = 'Arava!ChangeMe1';
const ownerEmail = 'owner@arava.local';
const securePassword = 'Owner!SyncInteraction2026';

async function launch(userData: string): Promise<ElectronApplication> {
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const argument = `--user-data-dir=${userData}`;
  return executablePath
    ? launchElectron({ args: [argument], executablePath })
    : launchElectron({ args: ['.', argument], cwd: resolve(import.meta.dirname, '../..') });
}

async function expectClickableHitTarget(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.click({ trial: true });
  const hit = await locator.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    const target = document.elementFromPoint(
      rectangle.left + rectangle.width / 2,
      rectangle.top + rectangle.height / 2,
    );
    return target
      ? {
          blockedBy:
            target instanceof HTMLElement ? target.outerHTML.slice(0, 240) : target.nodeName,
          ownsTarget: target === element || element.contains(target),
        }
      : undefined;
  });
  if (hit) expect(hit.ownsTarget, `Click intercepted by ${hit.blockedBy}`).toBe(true);
}

test('migrated database with historical FAILED remains fully clickable after restart', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(180_000);
  const userData = testInfo.outputPath('sync-recovery-user-data');
  let application = await launch(userData);

  try {
    let page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill(ownerEmail);
    await page.getByLabel('Пароль', { exact: true }).fill(initialPassword);
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill(securePassword);
    await page.getByLabel('Повторите новый пароль').fill(securePassword);
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await expect(page.getByRole('heading', { name: /^Сегодня,/u })).toBeVisible();
    await application.close();

    const database = createDatabaseClient(toSqliteUrl(join(userData, 'arava.db')));
    await database.$connect();
    try {
      const failedAt = new Date('2026-09-08T14:45:00.728Z');
      await database.syncOutbox.createMany({
        data: Array.from({ length: 2161 }, (_, index) => ({
          attemptCount: 1,
          createdAt: failedAt,
          entityId: `historical-attendance-${String(index)}`,
          entityType: 'ATTENDANCE',
          id: `historical-failed-${String(index)}`,
          idempotencyKey: `historical-failed-key-${String(index)}`,
          lastAttemptAt: failedAt,
          lastErrorCode: 'VALIDATION_ERROR',
          nextAttemptAt: failedAt,
          operation: 'UPSERT' as const,
          payloadJson: '{"unknownLegacyField":true}',
          payloadVersion: 1,
          status: 'FAILED' as const,
          updatedAt: failedAt,
        })),
      });
    } finally {
      await database.$disconnect();
    }

    application = await launch(userData);
    page = await application.firstWindow();
    const rendererErrors: string[] = [];
    page.on('pageerror', (error) => rendererErrors.push(error.message));
    await expect(page.getByRole('heading', { name: /^Сегодня,/u })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const students = page.getByRole('link', { name: 'Ученики', exact: true });
    await expectClickableHitTarget(students);
    await students.click();
    await expect(page.getByRole('heading', { level: 2, name: 'Ученики' })).toBeVisible();

    const settings = page.getByRole('link', { name: 'Настройки', exact: true });
    await expectClickableHitTarget(settings);
    await settings.click();
    await expect(page.getByText('Интеграция с сайтом', { exact: true })).toBeVisible();
    const integrationControl = page.getByRole('button', { name: 'Журнал синхронизации' });
    await expectClickableHitTarget(integrationControl);
    await integrationControl.click();
    await expect(page.getByRole('button', { name: 'Скрыть журнал' })).toBeVisible();

    const branches = page.getByRole('link', { name: 'Филиалы', exact: true });
    await expectClickableHitTarget(branches);
    await branches.click();
    const createBranch = page.getByRole('button', { name: 'Создать филиал' });
    await expectClickableHitTarget(createBranch);
    await createBranch.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть окно' }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(rendererErrors).toEqual([]);

    await application.close();
    application = await launch(userData);
    page = await application.firstWindow();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    const dashboard = page.getByRole('link', { name: 'Главная', exact: true });
    await expectClickableHitTarget(dashboard);
    await dashboard.click();
    await expect(page.getByRole('heading', { name: /^Сегодня,/u })).toBeVisible();
  } finally {
    await application.close().catch(() => undefined);
  }

  const verificationDatabase = createDatabaseClient(toSqliteUrl(join(userData, 'arava.db')));
  await verificationDatabase.$connect();
  try {
    await expect(
      verificationDatabase.syncOutbox.count({ where: { status: 'FAILED' } }),
    ).resolves.toBe(2161);
  } finally {
    await verificationDatabase.$disconnect();
  }
});
