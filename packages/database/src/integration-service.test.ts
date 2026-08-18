import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  INITIAL_OWNER_EMAIL,
  INITIAL_OWNER_PASSWORD,
  toSqliteUrl,
  type DatabaseClient,
} from './index';
import {
  IntegrationApiClient,
  IntegrationService,
  validateIntegrationBaseUrl,
  type IntegrationCredentialStore,
} from './integration-service';
import { ApplicationService } from './services';
import { StudioService } from './studio-service';

class MemoryCredentials implements IntegrationCredentialStore {
  deviceId = 'e69370b3-70d3-47eb-8d7a-509ba0f27e9d';
  token: string | undefined;
  clearToken() {
    this.token = undefined;
    return Promise.resolve();
  }
  getDeviceId() {
    return Promise.resolve(this.deviceId);
  }
  getToken() {
    return Promise.resolve(this.token);
  }
  saveToken(token: string) {
    this.token = token;
    return Promise.resolve();
  }
}

type ServerMode =
  'SUCCESS' | 'TEMPORARY' | 'VALIDATION' | 'REVOKED' | 'INVALID' | 'RATE_LIMIT' | 'SLOW';

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

describe('Sprint 4.5A multi-device integration', () => {
  let application: ApplicationService;
  let credentials: MemoryCredentials;
  let canonical: Map<
    string,
    {
      operation: 'ARCHIVE' | 'UPSERT';
      payload: Record<string, unknown>;
      revision: number;
      sequence: number;
    }
  >;
  let changes: Record<string, unknown>[];
  let database: DatabaseClient;
  let directory: string;
  let integration: IntegrationService;
  let mode: ServerMode;
  let now: Date;
  let ownerToken: string;
  let received: Record<string, unknown>[];
  let server: Server;
  let serverUrl: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-integration-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'integration.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Integration2026',
    });
    credentials = new MemoryCredentials();
    canonical = new Map();
    changes = [];
    mode = 'SUCCESS';
    now = new Date('2030-08-18T10:00:00.000Z');
    received = [];
    server = createServer(async (request, response) => {
      const requestBody = request.method === 'POST' ? await body(request) : {};
      received.push({ headers: request.headers, path: request.url, ...requestBody });
      if (request.url?.endsWith('/pair')) {
        json(response, 200, {
          apiVersion: 'v1',
          deviceStatus: 'ACTIVE',
          deviceToken: 'device-secret',
        });
        return;
      }
      if (mode === 'REVOKED') {
        json(response, 401, { code: 'DEVICE_REVOKED', message: 'revoked' });
        return;
      }
      if (mode === 'RATE_LIMIT') {
        json(response, 429, { code: 'RATE_LIMITED', message: 'slow down' });
        return;
      }
      if (mode === 'SLOW') {
        setTimeout(
          () =>
            json(response, 200, {
              apiVersion: 'v1',
              deviceStatus: 'ACTIVE',
              serverTimestamp: now.toISOString(),
            }),
          100,
        );
        return;
      }
      if (mode === 'VALIDATION') {
        json(response, 400, { code: 'VALIDATION_ERROR', message: 'invalid entity' });
        return;
      }
      if (mode === 'TEMPORARY') {
        json(response, 500, { code: 'TEMPORARY_ERROR', message: 'later' });
        return;
      }
      if (mode === 'INVALID') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('invalid');
        return;
      }
      if (request.url?.endsWith('/health')) {
        json(response, 200, {
          apiVersion: 'v1',
          deviceStatus: 'ACTIVE',
          serverTimestamp: now.toISOString(),
        });
        return;
      }
      if (request.url?.includes('/changes?')) {
        const after = Number(new URL(request.url, 'http://localhost').searchParams.get('after'));
        json(response, 200, {
          apiVersion: 'v1',
          canonicalCount: canonical.size,
          changes: changes.filter((change) => Number(change.sequence) > after),
          cursor: changes.length,
          hasMore: false,
        });
        return;
      }
      if (request.url?.endsWith('/devices')) {
        json(response, 200, { apiVersion: 'v1', devices: [] });
        return;
      }
      const operations = Array.isArray(requestBody.operations) ? requestBody.operations : [];
      json(response, 200, {
        accepted: operations.map((operation) => {
          const value = operation as Record<string, unknown>;
          const key = `${String(value.entityType)}:${String(value.entityId)}`;
          const previous = canonical.get(key);
          const payload = value.payload as Record<string, unknown>;
          const baseRevision = Number(value.baseRevision ?? 0);
          if (
            previous &&
            baseRevision !== previous.revision &&
            JSON.stringify(payload) !== JSON.stringify(previous.payload)
          ) {
            return {
              canonicalOperation: previous.operation,
              canonicalPayload: previous.payload,
              conflictId: `conflict-${String(changes.length + 1)}`,
              entityId: value.entityId,
              idempotencyKey: value.idempotencyKey,
              revision: previous.revision,
              serverSequence: previous.sequence,
              status: 'CONFLICT',
              version: value.version,
            };
          }
          if (previous && JSON.stringify(payload) === JSON.stringify(previous.payload)) {
            return {
              canonicalOperation: previous.operation,
              canonicalPayload: previous.payload,
              entityId: value.entityId,
              idempotencyKey: value.idempotencyKey,
              revision: previous.revision,
              serverSequence: previous.sequence,
              status: 'ACCEPTED',
              version: value.version,
            };
          }
          const revision = (previous?.revision ?? 0) + 1;
          const sequence = changes.length + 1;
          canonical.set(key, {
            operation: value.operation as 'ARCHIVE' | 'UPSERT',
            payload,
            revision,
            sequence,
          });
          changes.push({
            entityId: value.entityId,
            entityType: value.entityType,
            operation: value.operation,
            payload,
            revision,
            sequence,
            serverUpdatedAt: now.toISOString(),
            sourceDeviceId: request.headers['x-arava-device-id'],
          });
          return {
            canonicalOperation: value.operation,
            canonicalPayload: payload,
            entityId: value.entityId,
            idempotencyKey: value.idempotencyKey,
            revision,
            serverSequence: sequence,
            status: 'ACCEPTED',
            version: value.version,
          };
        }),
        apiVersion: 'v1',
        serverTimestamp: now.toISOString(),
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('mock server unavailable');
    serverUrl = `http://127.0.0.1:${String(address.port)}`;
    integration = new IntegrationService(
      database,
      application,
      credentials,
      new IntegrationApiClient(),
      () => now,
    );
    await integration.initialize();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function pair() {
    await integration.pair(ownerToken, {
      baseUrl: serverUrl,
      enabled: true,
      pairingCode: '123456',
    });
  }

  it('validates HTTPS configuration while explicitly allowing localhost development', () => {
    expect(validateIntegrationBaseUrl('https://arava.example/api')).toBe(
      'https://arava.example/api',
    );
    expect(validateIntegrationBaseUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(() => validateIntegrationBaseUrl('http://arava.example')).toThrow('только HTTPS');
    expect(() => validateIntegrationBaseUrl('file:///tmp/database')).toThrow('только HTTPS');
    expect(() => validateIntegrationBaseUrl('javascript:alert(1)')).toThrow('только HTTPS');
  });

  it('classifies timeout, network, rate limit, and invalid responses without exposing raw bodies', async () => {
    const client = new IntegrationApiClient(globalThis.fetch, 1000);
    mode = 'RATE_LIMIT';
    await expect(client.health(serverUrl, credentials.deviceId, 'token')).rejects.toThrow(
      'slow down',
    );
    mode = 'INVALID';
    await expect(client.health(serverUrl, credentials.deviceId, 'token')).rejects.toThrow(
      'неверный ответ',
    );
    mode = 'SLOW';
    const timeoutClient = new IntegrationApiClient(globalThis.fetch, 10);
    await expect(timeoutClient.health(serverUrl, credentials.deviceId, 'token')).rejects.toThrow(
      'не ответил вовремя',
    );
    await expect(
      client.health('http://127.0.0.1:1', credentials.deviceId, 'token'),
    ).rejects.toThrow('Нет соединения');
  });

  it('pairs with device credentials, sends authenticated headers and syncs a durable transactional outbox', async () => {
    await pair();
    await integration.testConnection(ownerToken);
    const branch = await application.createBranch(ownerToken, { name: 'Центр' });
    const pending = await database.syncOutbox.findFirstOrThrow({
      where: { entityId: branch.id, entityType: 'BRANCH', status: 'PENDING' },
    });
    const recreated = new IntegrationService(
      database,
      application,
      credentials,
      new IntegrationApiClient(),
      () => now,
    );
    await recreated.initialize();
    await recreated.processPending();
    await expect(
      database.syncOutbox.findUniqueOrThrow({ where: { id: pending.id } }),
    ).resolves.toMatchObject({ status: 'SYNCED' });
    expect(received.some((entry) => entry.path === '/api/integration/v1/health')).toBe(true);
    const syncRequest = received.find((entry) => entry.path === '/api/integration/v1/sync/batch');
    expect(syncRequest?.headers).toMatchObject({
      authorization: 'Bearer device-secret',
      'x-arava-api-version': 'v1',
      'x-arava-device-id': credentials.deviceId,
    });
  });

  it('rolls back the outbox marker when the local entity transaction rolls back', async () => {
    const before = await database.syncOutbox.count();
    await expect(
      database.$transaction(async (transaction) => {
        await transaction.branch.create({
          data: { address: '', name: 'Не сохранять', phone: '' },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await database.branch.count({ where: { name: 'Не сохранять' } })).toBe(0);
    expect(await database.syncOutbox.count()).toBe(before);
  });

  it('keeps local changes pending offline, retries temporary failures, and avoids duplicate logical delivery', async () => {
    await pair();
    const branch = await application.createBranch(ownerToken, { name: 'Север' });
    mode = 'TEMPORARY';
    await integration.processPending();
    const retry = await database.syncOutbox.findFirstOrThrow({ where: { entityId: branch.id } });
    expect(retry).toMatchObject({ attemptCount: 1, status: 'PENDING' });
    const key = retry.idempotencyKey;
    mode = 'SUCCESS';
    now = new Date(now.getTime() + 16_000);
    await integration.processPending();
    expect(await database.syncOutbox.findUniqueOrThrow({ where: { id: retry.id } })).toMatchObject({
      idempotencyKey: key,
      status: 'SYNCED',
    });
    expect(await database.syncLog.count({ where: { outboxId: retry.id } })).toBe(2);
  });

  it('synchronizes one entity A to server to B and back without an echo loop', async () => {
    await pair();
    const branch = await application.createBranch(ownerToken, { name: 'Устройство А' });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Анна',
      lastName: 'Два устройства',
      status: 'ACTIVE',
    });
    const firstStudio = new StudioService(database, application);
    const group = await firstStudio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      direction: 'Хип-хоп',
      name: 'Синхронная группа',
      status: 'ACTIVE',
    });
    await integration.processPending();

    const secondDirectory = await mkdtemp(join(tmpdir(), 'arava-integration-device-b-'));
    const secondDatabase = createDatabaseClient(toSqliteUrl(join(secondDirectory, 'device-b.db')));
    try {
      await initializeDatabase(secondDatabase);
      const secondApplication = new ApplicationService(secondDatabase);
      const secondStudio = new StudioService(secondDatabase, secondApplication);
      const secondLogin = await secondApplication.login({
        email: INITIAL_OWNER_EMAIL,
        password: INITIAL_OWNER_PASSWORD,
      });
      await secondApplication.changePassword(secondLogin.token, {
        currentPassword: INITIAL_OWNER_PASSWORD,
        newPassword: 'Owner!DeviceB2026',
      });
      const secondCredentials = new MemoryCredentials();
      secondCredentials.deviceId = '5af6412a-ed81-4a7a-9880-e0fa213f1a9b';
      const secondIntegration = new IntegrationService(
        secondDatabase,
        secondApplication,
        secondCredentials,
        new IntegrationApiClient(),
        () => now,
      );
      await secondIntegration.initialize();
      await secondIntegration.pair(secondLogin.token, {
        baseUrl: serverUrl,
        enabled: true,
        pairingCode: '654321',
      });
      await secondIntegration.processPending();
      expect(await secondDatabase.branch.findUnique({ where: { id: branch.id } })).toMatchObject({
        name: 'Устройство А',
      });
      expect(await secondDatabase.student.findUnique({ where: { id: student.id } })).toMatchObject({
        firstName: 'Анна',
      });
      expect(await secondDatabase.danceGroup.findUnique({ where: { id: group.id } })).toMatchObject(
        { name: 'Синхронная группа' },
      );
      expect(await secondDatabase.syncOutbox.count({ where: { entityId: branch.id } })).toBe(0);

      const membership = await secondStudio.addEnrollment(secondLogin.token, group.id, {
        joinedAt: '2030-08-18',
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: student.id,
      });
      await secondIntegration.processPending();
      await integration.processPending();
      expect(await database.enrollment.findUnique({ where: { id: membership.id } })).toMatchObject({
        groupId: group.id,
        studentId: student.id,
      });

      await application.updateStudent(ownerToken, student.id, {
        branchId: branch.id,
        firstName: 'Анна А',
        lastName: 'Два устройства',
        status: 'ACTIVE',
      });
      await secondApplication.updateStudent(secondLogin.token, student.id, {
        branchId: branch.id,
        firstName: 'Анна Б',
        lastName: 'Два устройства',
        status: 'ACTIVE',
      });
      await integration.processPending();
      await secondIntegration.processPending();
      expect(await database.student.findUnique({ where: { id: student.id } })).toMatchObject({
        firstName: 'Анна А',
      });
      expect(await secondDatabase.student.findUnique({ where: { id: student.id } })).toMatchObject({
        firstName: 'Анна Б',
      });
      expect(
        await secondDatabase.syncConflict.count({
          where: { entityId: student.id, entityType: 'STUDENT_IDENTITY', status: 'OPEN' },
        }),
      ).toBe(1);
      expect(await database.syncOutbox.count({ where: { entityId: membership.id } })).toBe(0);
    } finally {
      await closeDatabase(secondDatabase);
      await rm(secondDirectory, { force: true, recursive: true });
    }
  });

  it('retries a chat outbox item with the same client message id and safe CRM user context', async () => {
    await pair();
    const context = {
      branchIds: [],
      name: 'Владелец',
      role: 'OWNER' as const,
      userId: 'owner-chat-test',
    };
    const row = await database.syncOutbox.create({
      data: {
        entityId: 'private-chat',
        entityType: 'CHAT_MESSAGE',
        idempotencyKey: 'chat:client-message-retry',
        nextAttemptAt: now,
        operation: 'UPSERT',
        payloadJson: JSON.stringify({
          clientMessageId: 'client-message-retry',
          context,
          text: 'Сообщение с повтором',
        }),
      },
    });
    mode = 'TEMPORARY';
    await integration.processPending();
    expect(await database.syncOutbox.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      attemptCount: 1,
      status: 'PENDING',
    });

    mode = 'SUCCESS';
    now = new Date(now.getTime() + 60_000);
    await integration.processPending();
    expect(await database.syncOutbox.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      idempotencyKey: 'chat:client-message-retry',
      status: 'SYNCED',
    });
    const requests = received.filter(
      (entry) => entry.path === '/api/integration/v1/chats/private-chat/messages',
    );
    expect(requests).toHaveLength(2);
    expect(requests.map((entry) => entry.clientMessageId)).toEqual([
      'client-message-retry',
      'client-message-retry',
    ]);
    const encodedContext = requests[0]?.headers as Record<string, string | undefined>;
    expect(
      JSON.parse(Buffer.from(encodedContext['x-arava-crm-context'] ?? '', 'base64url').toString()),
    ).toEqual(context);
  });

  it('keeps permanent failures visible and disconnects a revoked device without losing work', async () => {
    await pair();
    const branch = await application.createBranch(ownerToken, { name: 'Юг' });
    mode = 'VALIDATION';
    await integration.processPending();
    expect(
      await database.syncOutbox.findFirstOrThrow({ where: { entityId: branch.id } }),
    ).toMatchObject({
      lastErrorCode: 'VALIDATION_ERROR',
      status: 'FAILED',
    });
    const second = await application.createBranch(ownerToken, { name: 'Запад' });
    mode = 'REVOKED';
    await integration.processPending();
    expect(credentials.token).toBeUndefined();
    expect(
      await database.syncOutbox.findFirstOrThrow({ where: { entityId: second.id } }),
    ).toMatchObject({
      lastErrorCode: 'DEVICE_REVOKED',
      status: 'FAILED',
    });
    expect((await integration.systemStatus()).connectionState).toBe('AUTH_ERROR');
  });

  it('prepares bounded initial sync DTOs and excludes credentials and security data', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Главный' });
    const trainer = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'private-trainer@arava.local',
      fullName: 'Анна Тренер',
      password: 'Coach!Integration2026',
      phone: '+79990000000',
      role: 'COACH',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      email: 'private-student@arava.local',
      firstName: 'Ирина',
      lastName: 'Ученица',
      notes: 'Секретная заметка',
      phone: '+79991111111',
      status: 'ACTIVE',
    });
    const trainerPayload = await integration.safePayload('TRAINER', trainer.id);
    const studentPayload = await integration.safePayload('STUDENT_IDENTITY', student.id);
    const serialized = JSON.stringify({ studentPayload, trainerPayload });
    for (const forbidden of [
      'passwordHash',
      'private-trainer@arava.local',
      '+79990000000',
      'securityVersion',
      'recoveryCode',
      'payment',
      'audit',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    const preview = await integration.prepareInitialSync(ownerToken);
    expect(preview).toMatchObject({ branches: 1, students: 1, trainers: 1 });
    await integration.queueInitialSync();
    expect(
      await database.syncOutbox.count({ where: { entityType: 'STUDENT_IDENTITY' } }),
    ).toBeGreaterThan(0);
  });

  it('denies configuration to ADMIN and COACH at the service boundary', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Доступ' });
    for (const role of ['ADMIN', 'COACH'] as const) {
      const password = `${role}!Integration2026`;
      await application.createUser(ownerToken, {
        branchIds: [branch.id],
        email: `${role.toLowerCase()}@arava.local`,
        fullName: role,
        password,
        role,
      });
      const session = await application.login({
        email: `${role.toLowerCase()}@arava.local`,
        password,
      });
      await application.changePassword(session.token, {
        currentPassword: password,
        newPassword: `${role}!Changed2026`,
      });
      await expect(integration.getStatus(session.token)).rejects.toThrow('только владелец');
      await expect(
        integration.updateSettings(session.token, { baseUrl: serverUrl, enabled: true }),
      ).rejects.toThrow('только владелец');
    }
  });
});
