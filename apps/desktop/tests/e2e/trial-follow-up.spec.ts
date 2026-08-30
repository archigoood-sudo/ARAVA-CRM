import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return chunks.length
    ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
    : {};
}

function respond(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function closeApplication(application: ElectronApplication): Promise<void> {
  try {
    await application.evaluate(({ app }) => app.quit());
  } catch {
    application.process().kill('SIGKILL');
  }
}

test('записывает заявку на пробное и автоматически закрывает follow-up после абонемента', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 150_000);
  let convertedStudentId: string | null = null;
  let groupId: string | null = null;
  let leadStatus = 'NEW';
  const lead = () => ({
    branchCrmId: null,
    childName: 'Иванова Мария',
    convertedStudentCrmId: convertedStudentId,
    crmGroupId: groupId,
    createdAt: new Date().toISOString(),
    existingStudentCandidates: [],
    id: 'trial-lead-e2e',
    originalPhone: '+79991234567',
    phone: '+79991234567',
    source: 'WEBSITE',
    status: leadStatus,
    statusHistory: [],
    updatedAt: new Date().toISOString(),
  });
  const server = createServer(async (request, response) => {
    const requestBody = await body(request);
    if (request.url?.endsWith('/pair')) {
      respond(response, { apiVersion: 'v1', deviceStatus: 'ACTIVE', deviceToken: 'trial-token' });
      return;
    }
    if (request.url?.endsWith('/health')) {
      respond(response, {
        apiVersion: 'v1',
        deviceStatus: 'ACTIVE',
        serverTimestamp: new Date().toISOString(),
      });
      return;
    }
    if (request.url?.endsWith('/payments/provider-health')) {
      respond(response, { apiReachable: true, configured: false, provider: 'AQSI_SBP' });
      return;
    }
    if (request.url?.endsWith('/payments/aqsi/devices')) {
      respond(response, { devices: [], selectedDeviceId: null });
      return;
    }
    if (request.url?.includes('/conflicts')) {
      respond(response, { apiVersion: 'v1', conflicts: [] });
      return;
    }
    if (request.url?.includes('/changes')) {
      respond(response, {
        apiVersion: 'v1',
        changes: [],
        cursor: 0,
        hasMore: false,
        serverTimestamp: new Date().toISOString(),
      });
      return;
    }
    if (request.url === '/api/integration/v1/leads/trial-lead-e2e/convert') {
      convertedStudentId =
        typeof requestBody.crmStudentId === 'string' ? requestBody.crmStudentId : null;
      leadStatus = 'CONVERTED';
      respond(response, { apiVersion: 'v1', lead: lead() });
      return;
    }
    if (request.url === '/api/integration/v1/leads/trial-lead-e2e') {
      if (typeof requestBody.status === 'string') leadStatus = requestBody.status;
      if ('crmGroupId' in requestBody)
        groupId = typeof requestBody.crmGroupId === 'string' ? requestBody.crmGroupId : null;
      respond(response, { apiVersion: 'v1', lead: lead() });
      return;
    }
    if (request.url?.startsWith('/api/integration/v1/leads')) {
      const requestedStatus = new URL(request.url, 'http://localhost').searchParams.get('status');
      const visible = !requestedStatus || requestedStatus === leadStatus;
      respond(response, {
        apiVersion: 'v1',
        leads: visible ? [lead()] : [],
        newCount: leadStatus === 'NEW' ? 1 : 0,
        serverTimestamp: new Date().toISOString(),
        summary: { [leadStatus]: 1 },
      });
      return;
    }
    respond(response, { apiVersion: 'v1', devices: [] });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server unavailable');
  const serverUrl = `http://127.0.0.1:${String(address.port)}`;
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const launch = {
    args: [`--user-data-dir=${testInfo.outputPath('trial-user-data')}`],
    env: { ...process.env, ARAVA_E2E_INTEGRATION_CREDENTIALS: 'memory' },
  };
  const application = executablePath
    ? await electron.launch({ ...launch, executablePath })
    : await electron.launch({
        ...launch,
        args: ['.', ...launch.args],
        cwd: resolve(import.meta.dirname, '../..'),
      });
  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!TrialE2E2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!TrialE2E2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await page.getByRole('link', { name: 'Настройки' }).click();
    await page.getByLabel('Адрес API сайта').fill(serverUrl);
    await page.getByText('Включить интеграцию', { exact: true }).click();
    await page.getByLabel('Код подключения').fill('123456');
    await page.getByRole('button', { name: 'Подключить' }).click();
    await expect(page.getByText('Устройство подключено к сайту.')).toBeVisible();

    const setup = await page.evaluate(async () => {
      const stored = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const token = stored.state?.token ?? '';
      const branch = await api.branches.create(token, { name: 'Пробные E2E' });
      const group = await api.groups.create(token, {
        branchId: branch.id,
        capacity: 15,
        direction: 'Хип-хоп',
        name: 'Пробная группа E2E',
        status: 'RECRUITING',
      });
      const now = new Date();
      const startsAt = new Date(now.getTime() - 15 * 60_000);
      if (startsAt.getDate() !== now.getDate()) startsAt.setHours(0, 0, 0, 0);
      startsAt.setSeconds(0, 0);
      const endsAt = new Date(now.getTime() + 45 * 60_000);
      if (endsAt.getDate() !== now.getDate()) endsAt.setHours(23, 59, 0, 0);
      const time = (value: Date) =>
        `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
      await api.schedules.create(token, {
        branchId: branch.id,
        endTime: time(endsAt),
        groupId: group.id,
        isActive: true,
        startTime: time(startsAt),
        validFrom: `${String(startsAt.getFullYear())}-${String(startsAt.getMonth() + 1).padStart(2, '0')}-${String(startsAt.getDate()).padStart(2, '0')}`,
        weekday: ((startsAt.getDay() + 6) % 7) + 1,
      });
      const rangeEnd = new Date(startsAt);
      rangeEnd.setDate(rangeEnd.getDate() + 60);
      const occurrences = await api.trials.occurrences(token, {
        dateFrom: new Date(
          startsAt.getFullYear(),
          startsAt.getMonth(),
          startsAt.getDate(),
        ).toISOString(),
        dateTo: rangeEnd.toISOString(),
        groupId: group.id,
      });
      if (!occurrences[0]) throw new Error('weekly trial occurrence unavailable');
      return { branch, group, startsAt: occurrences[0].startsAt };
    });
    await page.getByRole('link', { name: 'Заявки' }).click();
    await page.getByText('Иванова Мария', { exact: true }).first().click();
    await page.getByLabel('Целевая группа заявки').selectOption(setup.group.id);
    await expect.poll(() => groupId).toBe(setup.group.id);
    await expect(page.getByLabel('Целевая группа заявки')).toHaveValue(setup.group.id);
    await page.getByLabel('Занятие для пробного').selectOption(setup.startsAt);
    await expect(page.getByLabel('Занятие для пробного')).toHaveValue(setup.startsAt);
    const scheduleTrial = page.getByRole('button', { name: 'Записать на пробное' });
    await expect(scheduleTrial).toBeEnabled();
    await scheduleTrial.click();
    await expect(page.getByText('Пробное сегодня', { exact: true })).toBeVisible();
    const materialized = await page.evaluate(
      async ({ groupId: currentGroupId, startsAt }) => {
        const stored = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
          state?: { token?: string };
        };
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        const token = stored.state?.token ?? '';
        const day = new Date(startsAt);
        const lessons = await api.lessons.list(token, {
          dateFrom: new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString(),
          dateTo: new Date(
            day.getFullYear(),
            day.getMonth(),
            day.getDate(),
            23,
            59,
            59,
            999,
          ).toISOString(),
          groupId: currentGroupId,
        });
        const trials = await api.trials.list(token, { leadId: 'trial-lead-e2e' });
        return { lessonCount: lessons.length, lessonId: trials[0]?.lessonId };
      },
      { groupId: setup.group.id, startsAt: setup.startsAt },
    );
    expect(materialized.lessonCount).toBe(1);
    expect(materialized.lessonId).toBeTruthy();
    if (!materialized.lessonId) throw new Error('trial lesson unavailable');
    await page.getByRole('button', { name: 'Создать ученика' }).click();
    await page.getByRole('button', { name: 'Добавить ученика' }).click();
    await expect(page.getByText('Ученик уже создан и связан.')).toBeVisible();
    const studentId = await page.evaluate(async () => {
      const stored = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return (await api.leads.get(stored.state?.token ?? '', 'trial-lead-e2e'))
        .convertedStudentCrmId;
    });
    expect(studentId).toBeTruthy();
    if (!studentId) throw new Error('student unavailable');
    await page.evaluate(
      async ({ lessonId, studentId: currentStudentId }) => {
        const stored = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
          state?: { token?: string };
        };
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        await api.attendance.save(stored.state?.token ?? '', lessonId, [
          { status: 'PRESENT', studentId: currentStudentId },
        ]);
      },
      { lessonId: materialized.lessonId, studentId },
    );
    const trialFinance = await page.evaluate(async (currentStudentId) => {
      const stored = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return api.subscriptions.listStudent(stored.state?.token ?? '', currentStudentId);
    }, studentId);
    expect(trialFinance.uncoveredDebt).toBe(0);
    expect(trialFinance.uncoveredAttendances).toEqual([]);
    await page.getByRole('link', { name: 'Главная' }).click();
    await expect(page.getByText('Связаться после пробного: Иванова Мария')).toBeVisible();
    await page.getByRole('button', { name: 'Оформить абонемент' }).first().click();
    await expect(page.getByText('Пробные занятия', { exact: true })).toBeVisible();
    await page.evaluate(
      async ({ branchId, studentId: currentStudentId }) => {
        const stored = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
          state?: { token?: string };
        };
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        const token = stored.state?.token ?? '';
        const tariff = await api.tariffs.create(token, {
          branchId,
          currency: 'RUB',
          isActive: true,
          lessonCount: 4,
          name: 'После пробного E2E',
          price: 4000,
          type: 'LESSON_PACK',
        });
        await api.subscriptions.create(token, {
          initialPayment: {
            amount: 4000,
            paidAt: new Date().toISOString(),
            paymentMethod: 'CARD',
          },
          salePrice: 4000,
          startsAt: new Date().toISOString().slice(0, 10),
          studentId: currentStudentId,
          tariffId: tariff.id,
        });
      },
      { branchId: setup.branch.id, studentId },
    );
    await page.getByLabel('Закрыть окно').last().click();
    await page.getByRole('link', { name: 'Главная' }).click();
    await page.getByRole('button', { name: 'Обновить рабочий день' }).click();
    await expect(page.getByText('Связаться после пробного: Иванова Мария')).toHaveCount(0);
    const completedFlow = await page.evaluate(
      async ({ groupId: currentGroupId, studentId: currentStudentId }) => {
        const stored = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
          state?: { token?: string };
        };
        const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
        const token = stored.state?.token ?? '';
        const [profile, trials, roster] = await Promise.all([
          api.students.getProfile(token, currentStudentId),
          api.trials.list(token, { studentId: currentStudentId }),
          api.groups.getRoster(token, currentGroupId, new Date().toISOString().slice(0, 10)),
        ]);
        return {
          membershipCreatedByConfirmedConversion: roster.members.some(
            ({ studentId }) => studentId === currentStudentId,
          ),
          studentStatus: profile.student.status,
          trialState: trials[0]?.state,
        };
      },
      { groupId: setup.group.id, studentId },
    );
    expect(completedFlow).toEqual({
      membershipCreatedByConfirmedConversion: true,
      studentStatus: 'ACTIVE',
      trialState: 'SUBSCRIPTION_PURCHASED',
    });
    await page.getByRole('link', { name: 'Группы' }).click();
    await page
      .getByRole('article')
      .filter({ hasText: 'Пробная группа E2E' })
      .getByRole('button', { name: 'Действия' })
      .click();
    await expect(page.getByText('Иванова Мария', { exact: true })).toBeVisible();
  } finally {
    await closeApplication(application);
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});
