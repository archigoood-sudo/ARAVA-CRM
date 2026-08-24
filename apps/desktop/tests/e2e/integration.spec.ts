import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { AravaDesktopApi } from '@arava/shared';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';

async function requestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function respond(response: ServerResponse, value: unknown) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function stopServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  const closed = new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  server.closeAllConnections();
  await closed;
}

async function closeApplication(application: ElectronApplication): Promise<void> {
  const childProcess = application.process();
  const hasExited = () => childProcess.exitCode !== null;
  if (hasExited()) return;
  const exited = new Promise<boolean>((resolveExit) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    const timeout = setTimeout(() => {
      childProcess.off('exit', onExit);
      resolveExit(false);
    }, 5_000);
    childProcess.once('exit', onExit);
    if (hasExited()) onExit();
  });
  try {
    await application.evaluate(({ app }) => {
      setImmediate(() => app.quit());
    });
  } catch {
    // The transport may close as soon as Electron accepts the quit request.
  }
  if (!(await exited)) {
    const killed = new Promise<void>((resolveExit) =>
      childProcess.once('exit', () => resolveExit()),
    );
    childProcess.kill('SIGKILL');
    await Promise.race([
      killed,
      new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ]);
  }
}

test('OWNER подключает сайт, выполняет initial/offline sync и видит журнал', async ({
  request: _request,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 300_000 : 150_000);
  let receivedOperations = 0;
  let leadStatus = 'NEW';
  let convertedStudentId: string | null = null;
  let targetGroupId: string | null = null;
  const receivedPaymentPaths: string[] = [];
  let conflictOpen = true;
  let recoveryMode = false;
  const receivedChatMessages: string[] = [];
  const receivedChatImages: string[] = [];
  const chat = {
    branchId: null,
    crmGroupId: null,
    id: 'private-e2e',
    lastMessage: 'Сообщение клиента',
    lastMessageAt: '2026-08-18T12:00:00.000Z',
    linkedStudents: [],
    subtitle: 'Личный чат',
    title: 'Анна Клиент',
    type: 'PRIVATE_ADMIN',
    unreadCount: 1,
    updatedAt: '2026-08-18T12:00:00.000Z',
  };
  const websiteLead = () => ({
    branchCrmId: null,
    childAge: 9,
    childName: 'Иванова Мария',
    convertedAt: convertedStudentId ? new Date().toISOString() : null,
    convertedStudentCrmId: convertedStudentId,
    crmGroupId: targetGroupId,
    createdAt: '2026-08-23T10:00:00.000Z',
    direction: 'Хип-хоп',
    existingStudentCandidates: [
      { crmStudentId: 'student-existing-e2e', displayName: 'Существующая Мария' },
    ],
    id: 'lead-e2e',
    note: 'Позвонить вечером',
    originalPhone: '+7 999 123-45-67',
    parentName: 'Анна Иванова',
    phone: '+79991234567',
    source: 'WEBSITE',
    sourceDetail: '/',
    status: leadStatus,
    statusHistory: [],
    updatedAt: new Date().toISOString(),
    utmCampaign: 'autumn-2026',
    utmMedium: 'cpc',
    utmSource: 'search',
  });
  const server = createServer(async (request, response) => {
    const body =
      request.method === 'POST' || request.method === 'PATCH' ? await requestBody(request) : {};
    if (request.url?.endsWith('/pair')) {
      respond(response, { apiVersion: 'v1', deviceStatus: 'ACTIVE', deviceToken: 'e2e-token' });
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
    if (request.url?.startsWith('/api/integration/v1/chats/private-e2e/attachments/')) {
      receivedChatImages.push(request.url);
      if (request.url.endsWith('/image-missing')) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Изображение недоступно.' }));
        return;
      }
      response.writeHead(200, { 'Content-Length': '8', 'Content-Type': 'image/jpeg' });
      response.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]));
      return;
    }
    if (request.url?.startsWith('/api/integration/v1/chats/private-e2e/messages')) {
      if (request.method === 'POST') {
        receivedChatMessages.push(typeof body.text === 'string' ? body.text : '');
        respond(response, { message: { id: body.clientMessageId }, conversation: chat });
        return;
      }
      respond(response, {
        conversation: chat,
        hasMore: false,
        messages: [
          {
            attachments: [
              {
                height: 480,
                id: 'image-e2e',
                mimeType: 'image/jpeg',
                originalName: 'фото клиента.jpg',
                type: 'image',
                width: 640,
              },
              {
                id: 'image-missing',
                mimeType: 'image/jpeg',
                originalName: 'недоступное фото.jpg',
                type: 'image',
              },
            ],
            body: 'Сообщение клиента',
            createdAt: '2026-08-18T12:00:00.000Z',
            id: 'client-message-e2e',
            senderAccountId: 'client-e2e',
            senderName: 'Анна Клиент',
            senderRole: 'CLIENT',
            senderType: 'client',
          },
        ],
        nextCursor: null,
      });
      return;
    }
    if (request.url?.startsWith('/api/integration/v1/chats/private-e2e/read')) {
      respond(response, { ok: true });
      return;
    }
    if (request.url?.startsWith('/api/integration/v1/chats/private-e2e')) {
      respond(response, { conversation: chat });
      return;
    }
    if (request.url?.startsWith('/api/integration/v1/chats')) {
      respond(response, {
        conversations: [chat],
        serverTimestamp: new Date().toISOString(),
        totalUnread: 1,
      });
      return;
    }
    if (request.url === '/api/integration/v1/leads/lead-e2e/convert' && request.method === 'POST') {
      convertedStudentId = typeof body.crmStudentId === 'string' ? body.crmStudentId : null;
      leadStatus = 'CONVERTED';
      respond(response, { apiVersion: 'v1', lead: websiteLead() });
      return;
    }
    if (request.url === '/api/integration/v1/leads/lead-e2e') {
      if (request.method === 'PATCH' && typeof body.status === 'string') leadStatus = body.status;
      if (request.method === 'PATCH' && 'crmGroupId' in body)
        targetGroupId = typeof body.crmGroupId === 'string' ? body.crmGroupId : null;
      respond(response, { apiVersion: 'v1', lead: websiteLead() });
      return;
    }
    if (request.url?.startsWith('/api/integration/v1/leads') && request.method === 'GET') {
      const statusFilter = new URL(request.url, 'http://localhost').searchParams.get('status');
      const visible = !statusFilter || statusFilter === leadStatus;
      respond(response, {
        apiVersion: 'v1',
        leads: visible ? [websiteLead()] : [],
        newCount: leadStatus === 'NEW' ? 1 : 0,
        serverTimestamp: new Date().toISOString(),
        summary: { [leadStatus]: 1 },
      });
      return;
    }
    if (request.url?.startsWith('/api/integration/v1/changes')) {
      if (recoveryMode) {
        respond(response, {
          apiVersion: 'v1',
          canonicalCount: 1,
          changes: [
            {
              entityId: 'server-recovery-branch',
              entityType: 'BRANCH',
              operation: 'UPSERT',
              payload: {
                address: 'Серверная улица',
                isActive: true,
                name: 'Филиал после восстановления',
                phone: '',
              },
              revision: 1,
              sequence: 1,
              serverUpdatedAt: new Date().toISOString(),
              sourceDeviceId: 'server-device',
            },
          ],
          cursor: 1,
          hasMore: false,
        });
        return;
      }
      respond(response, {
        apiVersion: 'v1',
        canonicalCount: 0,
        changes: [],
        cursor: 0,
        hasMore: false,
      });
      return;
    }
    if (request.url === '/api/integration/v1/devices') {
      const deviceId = String(request.headers['x-arava-device-id'] ?? 'e2e-device');
      respond(response, {
        apiVersion: 'v1',
        devices: [
          {
            conflictCount: 0,
            deviceId,
            displayName: 'Диагностическое устройство',
            lastInboundCursor: 0,
            pendingCount: 0,
            status: 'ACTIVE',
          },
        ],
      });
      return;
    }
    if (request.url?.endsWith('/payments/provider-health')) {
      receivedPaymentPaths.push(request.url);
      respond(response, {
        apiReachable: true,
        configured: true,
        deviceConfigured: true,
        provider: 'AQSI_SBP',
        selectedDeviceId: 101,
        selectedDeviceName: 'aQsi 5Ф · E2E-001',
      });
      return;
    }
    if (request.method === 'GET' && request.url?.endsWith('/payments/aqsi/devices')) {
      receivedPaymentPaths.push(request.url);
      respond(response, {
        devices: [
          {
            deviceId: 101,
            model: 'aQsi 5Ф',
            name: 'aQsi 5Ф · E2E-001',
            selected: true,
            serialNumber: 'E2E-001',
          },
        ],
        selectedDeviceId: 101,
      });
      return;
    }
    if (request.method === 'GET' && request.url?.endsWith('/conflicts')) {
      respond(response, {
        apiVersion: 'v1',
        conflicts: conflictOpen
          ? [
              {
                baseRevision: 0,
                candidate: { name: 'Филиал устройства' },
                candidateOperation: 'UPSERT',
                canonical: { name: 'Филиал сервера' },
                canonicalOperation: 'UPSERT',
                canonicalRevision: 1,
                createdAt: new Date().toISOString(),
                differences: [
                  { candidate: 'Филиал устройства', canonical: 'Филиал сервера', field: 'name' },
                ],
                entityId: 'branch-conflict',
                entityType: 'BRANCH',
                id: 'conflict-e2e',
                sourceDeviceId: 'other-device',
                sourceDeviceName: 'Второй компьютер',
                status: 'OPEN',
              },
            ]
          : [],
      });
      return;
    }
    if (request.method === 'POST' && request.url?.endsWith('/conflicts/conflict-e2e/resolve')) {
      conflictOpen = false;
      respond(response, {
        apiVersion: 'v1',
        conflict: {
          baseRevision: 0,
          candidate: { name: 'Филиал устройства' },
          candidateOperation: 'UPSERT',
          canonical: { name: 'Филиал сервера' },
          canonicalOperation: 'UPSERT',
          canonicalRevision: 1,
          createdAt: new Date().toISOString(),
          differences: [
            { candidate: 'Филиал устройства', canonical: 'Филиал сервера', field: 'name' },
          ],
          entityId: 'branch-conflict',
          entityType: 'BRANCH',
          id: 'conflict-e2e',
          sourceDeviceId: 'other-device',
          status: 'RESOLVED',
        },
      });
      return;
    }
    if (request.method === 'POST' && request.url?.endsWith('/reconciliation/preview')) {
      respond(response, {
        ambiguous: [],
        apiVersion: 'v1',
        divergent: [],
        identical: [],
        localOnly: [],
        serverOnly: [],
        serverCursor: 0,
      });
      return;
    }
    if (request.method === 'POST' && request.url?.endsWith('/maintenance/journal')) {
      respond(response, {
        activeDeviceCount: 1,
        apiVersion: 'v1',
        deleted: 0,
        maximumCursor: 0,
        minimumAcknowledgedCursor: 0,
        safeThrough: 0,
      });
      return;
    }
    const operations = Array.isArray(body.operations) ? body.operations : [];
    receivedOperations += operations.length;
    respond(response, {
      accepted: operations.map((operation) => {
        const value = operation as Record<string, unknown>;
        return {
          canonicalOperation: value.operation,
          canonicalPayload: value.payload,
          entityId: value.entityId,
          idempotencyKey: value.idempotencyKey,
          revision: 1,
          serverSequence: 1,
          status: 'ACCEPTED',
          version: value.version,
        };
      }),
      apiVersion: 'v1',
      serverTimestamp: new Date().toISOString(),
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server unavailable');
  const serverUrl = `http://127.0.0.1:${String(address.port)}`;

  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('integration-user-data')}`;
  const launchArguments = [userDataArgument];
  const launchEnvironment = {
    ...process.env,
    ARAVA_E2E_INTEGRATION_CREDENTIALS: 'memory',
  };
  const application = executablePath
    ? await electron.launch({ args: launchArguments, env: launchEnvironment, executablePath })
    : await electron.launch({
        args: ['.', ...launchArguments],
        cwd: resolve(import.meta.dirname, '../..'),
        env: launchEnvironment,
      });

  try {
    const page = await application.firstWindow();
    await page.getByLabel('Электронная почта').fill('owner@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Arava!ChangeMe1');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await page.getByLabel('Новый пароль', { exact: true }).fill('Owner!IntegrationE2E2026');
    await page.getByLabel('Повторите новый пароль').fill('Owner!IntegrationE2E2026');
    await page.getByRole('button', { name: 'Сохранить пароль и продолжить' }).click();
    await page.getByRole('link', { name: 'Настройки' }).click();
    await expect(page.getByText('Интеграция с сайтом', { exact: true })).toBeVisible();
    await page.getByLabel('Адрес API сайта').fill(serverUrl);
    await page.getByText('Включить интеграцию', { exact: true }).click();
    await page.getByLabel('Код подключения').fill('123456');
    await page.getByRole('button', { name: 'Подключить' }).click();
    await expect(page.getByText('Устройство подключено к сайту.')).toBeVisible();
    const aqsiSettings = page.getByTestId('aqsi-settings');
    await expect(aqsiSettings.getByLabel('Касса для оплаты')).toHaveValue('101');
    await expect
      .poll(() => receivedPaymentPaths)
      .toEqual([
        '/api/integration/v1/payments/provider-health',
        '/api/integration/v1/payments/aqsi/devices',
      ]);
    await page.getByRole('button', { name: 'Проверить соединение' }).click();
    await expect(page.getByText('Соединение с сайтом установлено.')).toBeVisible();
    await page.getByRole('button', { name: 'Запустить диагностику' }).click();
    const diagnostics = page.getByTestId('integration-diagnostics');
    await expect(
      diagnostics.getByText('Есть предупреждения', { exact: true }).first(),
    ).toBeVisible();
    await expect(diagnostics.getByText('Сервер доступен', { exact: true })).toBeVisible();
    await expect(diagnostics.getByText('Устройство авторизовано', { exact: true })).toBeVisible();
    await expect(diagnostics).not.toContainText('e2e-token');
    const conflictCenter = page.getByTestId('integration-conflicts');
    await expect(conflictCenter.getByRole('cell', { name: 'Филиал сервера' })).toBeVisible();
    await conflictCenter.getByRole('button', { name: 'Оставить текущую версию' }).click();
    await page.getByRole('button', { name: 'Подтвердить решение' }).click();
    await expect(
      page.getByText('Конфликт разрешён. Новая версия будет получена активными устройствами.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Сверить данные' }).click();
    await expect(page.getByTestId('integration-reconciliation')).toContainText('Совпадает: 0');
    await page.getByRole('link', { name: 'Чаты' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Чаты' })).toBeVisible();
    await expect(page.getByText('Анна Клиент', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Сообщение клиента', { exact: true }).last()).toBeVisible();
    const clientImage = page.getByRole('button', {
      name: 'Открыть изображение: фото клиента.jpg',
    });
    await expect(clientImage).toBeVisible();
    await expect(page.getByText('Изображение недоступно', { exact: true })).toBeVisible();
    await clientImage.click();
    await expect(page.getByRole('dialog').getByAltText('фото клиента.jpg')).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть окно' }).last().click();
    await expect
      .poll(() => receivedChatImages.filter((path) => path.endsWith('/image-e2e')).length)
      .toBe(1);
    await page.getByLabel('Сообщение').fill('Ответ администратора');
    await page.getByRole('button', { name: 'Отправить' }).click();
    await expect.poll(() => receivedChatMessages).toEqual(['Ответ администратора']);
    const leadGroup = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const token = persisted.state?.token ?? '';
      const branch = await api.branches.create(token, { name: 'Филиал заявок E2E' });
      return api.groups.create(token, {
        branchId: branch.id,
        capacity: 20,
        direction: 'Хип-хоп',
        name: 'WEB-группа E2E',
        status: 'RECRUITING',
      });
    });
    await page.getByRole('link', { name: 'Заявки' }).click();
    await expect(page.getByRole('link', { name: /Заявки 1/u })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Заявки' })).toBeVisible();
    await page.getByText('Иванова Мария', { exact: true }).first().click();
    const leadDetail = page.getByTestId('lead-detail');
    await expect(leadDetail).toContainText('Позвонить вечером');
    await leadDetail.getByLabel('Изменить статус заявки').selectOption('CONTACTED');
    await expect(leadDetail.getByText('Связались', { exact: true }).first()).toBeVisible();
    await page.reload();
    await page.getByText('Иванова Мария', { exact: true }).first().click();
    await expect(
      page.getByTestId('lead-detail').getByText('Связались', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText('Возможно, этот человек уже есть в CRM')).toBeVisible();
    await page.getByLabel('Целевая группа заявки').selectOption(leadGroup.id);
    await expect(page.getByLabel('Целевая группа заявки')).toHaveValue(leadGroup.id);
    await page.getByRole('button', { name: 'Всё равно создать нового' }).click();
    await page.getByRole('button', { name: 'Создать ученика' }).click();
    await expect(page.getByLabel('Фамилия')).toHaveValue('Иванова');
    await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Мария');
    await expect(page.getByLabel('Заметки')).toHaveValue(/Возраст: 9/u);
    await page.getByRole('button', { name: 'Добавить ученика' }).click();
    await expect(page.getByText('Ученик уже создан и связан.')).toBeVisible();
    expect(convertedStudentId).toBeTruthy();
    await expect
      .poll(async () =>
        page.evaluate(
          async ({ groupId, studentId }) => {
            const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
              state?: { token?: string };
            };
            const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
            const group = await api.groups.get(persisted.state?.token ?? '', groupId);
            return group.participants.some(
              (participant) => participant.studentId === studentId && !participant.leftAt,
            );
          },
          { groupId: leadGroup.id, studentId: convertedStudentId ?? '' },
        ),
      )
      .toBe(true);
    await page.getByRole('link', { name: 'Настройки' }).click();
    await page.getByRole('button', { name: 'Первичная синхронизация' }).click();
    await expect(page.getByText('Данные для первичной синхронизации')).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Подтвердить первичную синхронизацию' }).click();
    await expect(page.getByText('Первичная синхронизация поставлена в очередь.')).toBeVisible();

    const pendingAfterLocalChange = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const token = persisted.state?.token ?? '';
      await api.branches.create(token, { name: 'Интеграционный филиал' });
      return (await api.integration.getStatus(token)).pendingCount;
    });
    expect(pendingAfterLocalChange).toBeGreaterThan(0);
    await page.getByRole('button', { name: /Синхронизировать сейчас/u }).click();
    await expect.poll(() => receivedOperations).toBeGreaterThan(0);
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
            state?: { token?: string };
          };
          const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
          return (await api.integration.getStatus(persisted.state?.token ?? '')).pendingCount;
        }),
      )
      .toBe(0);
    const finalStatus = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return api.integration.getStatus(persisted.state?.token ?? '');
    });
    expect(finalStatus.failedCount).toBe(0);

    await stopServer(server);
    const offlineResult = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const token = persisted.state?.token ?? '';
      const branch = await api.branches.create(token, { name: 'Офлайн-филиал' });
      try {
        await api.integration.syncNow(token);
      } catch {
        // The local mutation must remain successful while the server is offline.
      }
      return {
        branchExists: (await api.branches.list(token)).some(({ id }) => id === branch.id),
        pending: (await api.integration.getStatus(token)).pendingCount,
      };
    });
    expect(offlineResult.branchExists).toBe(true);
    expect(offlineResult.pending).toBeGreaterThan(0);
    await new Promise<void>((resolveListen) =>
      server.listen(address.port, '127.0.0.1', resolveListen),
    );
    await page.getByRole('button', { name: /Синхронизировать сейчас/u }).click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
            state?: { token?: string };
          };
          const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
          return (await api.integration.getStatus(persisted.state?.token ?? '')).pendingCount;
        }),
      )
      .toBe(0);
    await page.getByRole('button', { name: 'Журнал синхронизации' }).click();
    await expect(page.getByRole('cell', { name: 'Синхронизировано' }).first()).toBeVisible();

    const operationsBeforeRecovery = receivedOperations;
    recoveryMode = true;
    await page.getByRole('button', { name: 'Загрузить состояние с сервера' }).click();
    await expect(
      page.getByText(
        'Локальные синхронизируемые данные этого компьютера будут заменены состоянием сервера. Данные на сервере не изменятся.',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Подтвердить загрузку' }).click();
    await expect(page.getByText(/Состояние сервера загружено/u)).toBeVisible();
    const recovered = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const token = persisted.state?.token ?? '';
      return {
        branches: await api.branches.list(token),
        status: await api.integration.getStatus(token),
      };
    });
    expect(recovered.branches.map(({ name }) => name)).toEqual(['Филиал после восстановления']);
    expect(recovered.status.inboundCursor).toBe(1);
    expect(recovered.status.pendingCount).toBe(0);
    expect(recovered.status.failedCount).toBe(0);
    expect(receivedOperations).toBe(operationsBeforeRecovery);

    await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      const token = persisted.state?.token ?? '';
      const branch = (await api.branches.list(token))[0];
      if (!branch) throw new Error('branch unavailable');
      await api.users.create(token, {
        branchIds: [branch.id],
        email: 'leads-coach-e2e@arava.local',
        fullName: 'Тренер заявок E2E',
        password: 'Coach!LeadsE2E2026',
        role: 'COACH',
      });
      await api.auth.logout(token);
      localStorage.removeItem('arava-auth');
      window.location.hash = '#/login';
    });
    await page.getByLabel('Электронная почта').fill('leads-coach-e2e@arava.local');
    await page.getByLabel('Пароль', { exact: true }).fill('Coach!LeadsE2E2026');
    await page.getByRole('button', { name: 'Войти в рабочее пространство' }).click();
    await expect(page.getByRole('link', { name: 'Заявки' })).toHaveCount(0);
  } finally {
    await closeApplication(application);
    await stopServer(server);
  }
});
