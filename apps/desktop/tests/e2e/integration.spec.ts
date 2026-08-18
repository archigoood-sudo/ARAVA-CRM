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
  const receivedChatMessages: string[] = [];
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
  const server = createServer(async (request, response) => {
    const body = request.method === 'POST' ? await requestBody(request) : {};
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
    const operations = Array.isArray(body.operations) ? body.operations : [];
    receivedOperations += operations.length;
    respond(response, {
      accepted: operations.map((operation) => {
        const value = operation as Record<string, unknown>;
        return {
          entityId: value.entityId,
          idempotencyKey: value.idempotencyKey,
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
    await page.getByRole('button', { name: 'Проверить соединение' }).click();
    await expect(page.getByText('Соединение с сайтом установлено.')).toBeVisible();
    await page.getByRole('link', { name: 'Чаты' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Чаты' })).toBeVisible();
    await expect(page.getByText('Анна Клиент', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Сообщение клиента', { exact: true }).last()).toBeVisible();
    await page.getByLabel('Сообщение').fill('Ответ администратора');
    await page.getByRole('button', { name: 'Отправить' }).click();
    await expect.poll(() => receivedChatMessages).toEqual(['Ответ администратора']);
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
    const finalStatus = await page.evaluate(async () => {
      const persisted = JSON.parse(localStorage.getItem('arava-auth') ?? '{}') as {
        state?: { token?: string };
      };
      const api = (globalThis as typeof globalThis & { arava: AravaDesktopApi }).arava;
      return api.integration.getStatus(persisted.state?.token ?? '');
    });
    expect(finalStatus.pendingCount).toBe(0);

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
  } finally {
    await closeApplication(application);
    await stopServer(server);
  }
});
