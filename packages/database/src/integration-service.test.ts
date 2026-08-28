import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
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
import { LeadService } from './lead-service';

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
  let backupAttempts: number;
  let backupFailure: Error | undefined;
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
  let conflictSequence: number;
  let changesRequestStarted: (() => void) | undefined;
  let changesResponseGate: Promise<void> | undefined;
  let deviceList: Record<string, unknown>[];
  let database: DatabaseClient;
  let directory: string;
  let integration: IntegrationService;
  let failedProbe: 'CHAT' | 'PUBLICATION' | undefined;
  let healthApiVersion: string;
  let healthDeviceStatus: string;
  let mode: ServerMode;
  let managedConflicts: Record<string, unknown>[];
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
    backupAttempts = 0;
    backupFailure = undefined;
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
    conflictSequence = 0;
    changesRequestStarted = undefined;
    changesResponseGate = undefined;
    deviceList = [];
    failedProbe = undefined;
    healthApiVersion = 'v1';
    healthDeviceStatus = 'ACTIVE';
    mode = 'SUCCESS';
    managedConflicts = [];
    now = new Date('2030-08-18T10:00:00.000Z');
    received = [];
    server = createServer(async (request, response) => {
      const methodWithBody =
        request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT';
      const requestBody =
        methodWithBody && Number(request.headers['content-length'] ?? 0) > 0
          ? await body(request)
          : {};
      received.push({
        headers: request.headers,
        method: request.method,
        path: request.url,
        ...requestBody,
      });
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
      if (request.url?.endsWith('/payments/provider-health')) {
        json(response, 200, {
          apiReachable: true,
          configured: true,
          deviceConfigured: true,
          provider: 'AQSI_SBP',
          selectedDeviceId: 77,
          selectedDeviceName: 'aQsi 5Ф · TEST-77',
        });
        return;
      }
      if (request.method === 'GET' && request.url?.endsWith('/payments/aqsi/devices')) {
        json(response, 200, {
          devices: [
            {
              deviceId: 77,
              model: 'aQsi 5Ф',
              name: 'aQsi 5Ф · TEST-77',
              selected: true,
              serialNumber: 'TEST-77',
            },
          ],
          selectedDeviceId: 77,
        });
        return;
      }
      if (request.method === 'POST' && request.url?.endsWith('/payments/aqsi')) {
        const isCard = requestBody.paymentMethod === 'CARD';
        json(response, 200, {
          amountKopecks: requestBody.amountKopecks,
          aravaOperationId: requestBody.aravaOperationId,
          currency: 'RUB',
          deviceId: 77,
          provider: isCard ? 'AQSI_CARD' : 'AQSI_SBP',
          providerOperationId: isCard ? 'aqsi-card-1' : 'aqsi-sbp-1',
          status: 'WAITING',
          updatedAt: now.toISOString(),
        });
        return;
      }
      if (request.method === 'POST' && request.url?.endsWith('/client-access')) {
        const crmStudentId =
          typeof requestBody.crmStudentId === 'string' ? requestBody.crmStudentId : '';
        if (requestBody.action === 'ISSUE') {
          json(response, 200, {
            codeExpiresAt: now.toISOString(),
            status: {
              canLink: false,
              canReissue: true,
              canRevoke: false,
              crmStudentId,
              invitationId: 'invite-safe',
              maskedPhone: '+7 ••• ••• 30',
              state: 'INVITED',
            },
            temporaryCode: '654321',
          });
          return;
        }
        json(response, 200, {
          canLink: false,
          canReissue: false,
          canRevoke: false,
          crmStudentId,
          state: 'NOT_ISSUED',
        });
        return;
      }
      if (request.method === 'POST' && request.url?.endsWith('/fiscal-receipt')) {
        json(response, 200, {
          amountKopecks: 12_345,
          aravaOperationId: 'operation-card-http',
          currency: 'RUB',
          deviceId: 77,
          fiscalReceipt: {
            canRetry: false,
            fiscalDocumentNumber: 42,
            fiscalSign: '987654321',
            receiptUrl: 'https://receipt.example/42',
            status: 'SUCCEEDED',
            updatedAt: now.toISOString(),
          },
          provider: 'AQSI_CARD',
          providerOperationId: 'aqsi-card-1',
          providerResultId: 'slip-card-1',
          status: 'SUCCEEDED',
          updatedAt: now.toISOString(),
        });
        return;
      }
      if (request.url?.endsWith('/health')) {
        json(response, 200, {
          apiVersion: healthApiVersion,
          deviceStatus: healthDeviceStatus,
          serverTimestamp: now.toISOString(),
        });
        return;
      }
      if (request.method === 'GET' && request.url?.startsWith('/api/integration/v1/chats')) {
        if (failedProbe === 'CHAT') {
          json(response, 503, { code: 'TEMPORARY_ERROR' });
          return;
        }
        json(response, 200, {
          conversations: [],
          serverTimestamp: now.toISOString(),
          totalUnread: 0,
        });
        return;
      }
      if (
        request.method === 'OPTIONS' &&
        request.url?.endsWith('/api/integration/v1/publications/media')
      ) {
        if (failedProbe === 'PUBLICATION') {
          json(response, 503, { code: 'TEMPORARY_ERROR' });
          return;
        }
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url?.includes('/changes?')) {
        const url = new URL(request.url, 'http://localhost');
        const after = Number(url.searchParams.get('after'));
        const requestedTypes = new Set((url.searchParams.get('entityTypes') ?? '').split(','));
        const source =
          url.searchParams.get('snapshot') === 'canonical'
            ? [...canonical.entries()].map(([key, value]) => {
                const separator = key.indexOf(':');
                return {
                  entityId: key.slice(separator + 1),
                  entityType: key.slice(0, separator),
                  operation: value.operation,
                  payload: value.payload,
                  revision: value.revision,
                  sequence: value.sequence,
                  serverUpdatedAt: now.toISOString(),
                  sourceDeviceId: 'mock-server',
                };
              })
            : changes;
        const selected = source.filter(
          (change) =>
            Number(change.sequence) > after && requestedTypes.has(String(change.entityType)),
        );
        const page = {
          apiVersion: 'v1',
          canonicalCount: canonical.size,
          changes: selected,
          cursor: selected.at(-1)?.sequence ?? after,
          hasMore: false,
        };
        changesRequestStarted?.();
        if (changesResponseGate) await changesResponseGate;
        json(response, 200, page);
        return;
      }
      if (request.url === '/api/integration/v1/devices') {
        json(response, 200, { apiVersion: 'v1', devices: deviceList });
        return;
      }
      if (request.method === 'DELETE' && request.url?.startsWith('/api/integration/v1/devices/')) {
        const target = decodeURIComponent(request.url.split('/').at(-1) ?? '');
        const device = deviceList.find((item) => item.deviceId === target);
        if (device) device.status = 'REVOKED';
        json(response, 200, { apiVersion: 'v1', deviceId: target });
        return;
      }
      if (request.method === 'GET' && request.url?.endsWith('/conflicts')) {
        json(response, 200, { apiVersion: 'v1', conflicts: managedConflicts });
        return;
      }
      if (
        request.method === 'POST' &&
        request.url?.includes('/conflicts/') &&
        request.url.endsWith('/resolve')
      ) {
        const conflictId = decodeURIComponent(request.url.split('/').at(-2) ?? '');
        const conflict = managedConflicts.find((item) => item.id === conflictId);
        if (!conflict) {
          json(response, 404, { code: 'NOT_FOUND', message: 'conflict not found' });
          return;
        }
        if (Number(conflict.resolveFailuresRemaining ?? 0) > 0) {
          conflict.resolveFailuresRemaining = Number(conflict.resolveFailuresRemaining) - 1;
          json(response, 503, { code: 'TEMPORARY', message: 'temporary failure' });
          return;
        }
        if (conflict.simulateCanonicalChange === true) {
          const selectedPayload =
            requestBody.resolution === 'ACCEPT_CANDIDATE'
              ? (conflict.candidate as Record<string, unknown>)
              : (conflict.canonical as Record<string, unknown>);
          const revision = Number(conflict.canonicalRevision) + 1;
          const sequence = changes.length + 1;
          const operation =
            requestBody.resolution === 'ACCEPT_CANDIDATE'
              ? String(conflict.candidateOperation)
              : String(conflict.canonicalOperation);
          canonical.set(`${String(conflict.entityType)}:${String(conflict.entityId)}`, {
            operation: operation as 'ARCHIVE' | 'UPSERT',
            payload: selectedPayload,
            revision,
            sequence,
          });
          changes.push({
            entityId: conflict.entityId,
            entityType: conflict.entityType,
            operation,
            payload: selectedPayload,
            revision,
            sequence,
            serverUpdatedAt: now.toISOString(),
            sourceDeviceId: 'mock-server',
          });
        }
        const resolvedConflict = { ...conflict, status: 'RESOLVED' };
        managedConflicts = managedConflicts.filter((item) => item.id !== conflictId);
        json(response, 200, { apiVersion: 'v1', conflict: resolvedConflict });
        return;
      }
      if (request.method === 'POST' && request.url?.endsWith('/reconciliation/preview')) {
        const entities = Array.isArray(requestBody.entities) ? requestBody.entities : [];
        json(response, 200, {
          ambiguous: [],
          apiVersion: 'v1',
          divergent: [],
          identical: [],
          localOnly: entities.map((entity) => ({
            ...(entity as Record<string, unknown>),
            reason: 'Есть только на этом устройстве',
          })),
          serverOnly: [],
          serverCursor: changes.length,
        });
        return;
      }
      if (request.method === 'POST' && request.url?.endsWith('/maintenance/journal')) {
        json(response, 200, {
          activeDeviceCount: 1,
          apiVersion: 'v1',
          deleted: 0,
          maximumCursor: changes.length,
          minimumAcknowledgedCursor: changes.length,
          safeThrough: 0,
        });
        return;
      }
      if (request.method === 'PATCH' && request.url?.startsWith('/api/integration/v1/devices/')) {
        const [path] = request.url.replace(/^\/api\/integration\/v1\/devices\//u, '').split('?');
        const targetDeviceId = decodeURIComponent(path ?? '');
        const displayName =
          typeof requestBody.displayName === 'string' ? requestBody.displayName : undefined;
        if (targetDeviceId) {
          const existing = deviceList.find((device) => device.deviceId === targetDeviceId);
          if (existing && displayName && !existing.displayName) {
            existing.displayName = displayName;
          } else if (displayName) {
            if (existing) {
              existing.displayName = displayName;
            } else {
              deviceList.push({
                conflictCount: 0,
                deviceId: targetDeviceId,
                displayName,
                lastInboundCursor: 0,
                pendingCount: 0,
                status: 'ACTIVE',
              });
            }
          }
        }
        json(response, 200, { apiVersion: 'v1' });
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
            conflictSequence += 1;
            const conflictId = `conflict-${String(conflictSequence)}`;
            const fields = [
              ...new Set([...Object.keys(previous.payload), ...Object.keys(payload)]),
            ];
            managedConflicts.push({
              baseRevision,
              candidate: payload,
              candidateOperation: value.operation,
              canonical: previous.payload,
              canonicalOperation: previous.operation,
              canonicalRevision: previous.revision,
              createdAt: now.toISOString(),
              differences: fields
                .filter(
                  (field) =>
                    JSON.stringify(payload[field]) !== JSON.stringify(previous.payload[field]),
                )
                .map((field) => ({
                  candidate: payload[field],
                  canonical: previous.payload[field],
                  field,
                })),
              entityId: value.entityId,
              entityType: value.entityType,
              id: conflictId,
              simulateCanonicalChange: true,
              sourceDeviceId: request.headers['x-arava-device-id'],
              status: 'OPEN',
            });
            return {
              canonicalOperation: previous.operation,
              canonicalPayload: previous.payload,
              conflictId,
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
      () => {
        backupAttempts += 1;
        if (backupFailure) return Promise.reject(backupFailure);
        return Promise.resolve({
          createdAt: now.toISOString(),
          fileName: 'ARAVA-CRM-recovery.arava-backup',
          id: 'recovery-backup',
          integrity: 'VALID',
          location: join(directory, 'ARAVA-CRM-recovery.arava-backup'),
          size: 1024,
          type: 'MANUAL',
        });
      },
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

  it('sends authenticated aQsi health and device discovery requests through the integration transport', async () => {
    await pair();
    received.length = 0;

    const devices = await integration.listAqsiDevices(ownerToken);

    expect(received.map(({ path }) => path).sort()).toEqual(
      [
        '/api/integration/v1/payments/provider-health',
        '/api/integration/v1/payments/aqsi/devices',
      ].sort(),
    );
    for (const request of received) {
      expect(request.headers).toMatchObject({
        authorization: 'Bearer device-secret',
        'x-arava-api-version': 'v1',
        'x-arava-device-id': credentials.deviceId,
      });
      expect(request.headers).toHaveProperty('x-arava-crm-context');
    }
    expect(devices).toEqual({
      devices: [
        {
          deviceId: 77,
          model: 'aQsi 5Ф',
          name: 'aQsi 5Ф · TEST-77',
          selected: true,
          serialNumber: 'TEST-77',
        },
      ],
      selectedDeviceId: 77,
    });
    expect(JSON.stringify(devices)).not.toContain('device-secret');

    received.length = 0;
    await expect(integration.sbpProviderHealth(ownerToken)).resolves.toMatchObject({
      apiReachable: true,
      configured: true,
      deviceConfigured: true,
      provider: 'AQSI_SBP',
    });
    expect(received.map(({ path }) => path)).toEqual([
      '/api/integration/v1/payments/provider-health',
    ]);
  });

  it('starts both aQsi HTTP requests and reports timeout only when the transport actually stalls', async () => {
    await pair();
    const requestedUrls: string[] = [];
    const stalledClient = new IntegrationApiClient((url, init) => {
      requestedUrls.push(url);
      if (url.endsWith('/payments/aqsi/devices')) {
        return Promise.resolve({
          json: () => Promise.resolve({ devices: [], selectedDeviceId: null }),
          ok: true,
          status: 200,
        });
      }
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('mock transport aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }, 10);
    const stalledService = new IntegrationService(
      database,
      application,
      credentials,
      stalledClient,
      () => now,
    );

    await expect(stalledService.listAqsiDevices(ownerToken)).rejects.toThrow(
      'Сервер не ответил вовремя.',
    );
    expect(requestedUrls.map((url) => new URL(url).pathname)).toEqual([
      '/api/integration/v1/payments/provider-health',
      '/api/integration/v1/payments/aqsi/devices',
    ]);
  });

  it('sends card and SBP modes through the authenticated aQsi payment endpoint', async () => {
    await pair();
    const branch = await application.createBranch(ownerToken, { name: 'Филиал оплаты aQsi' });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Анна',
      lastName: 'Картова',
      status: 'ACTIVE',
    });
    received.length = 0;
    const baseOperation = {
      amount: 12_345,
      branchId: branch.id,
      createdAt: now.toISOString(),
      createdByName: 'Владелец',
      currency: 'RUB' as const,
      id: 'operation-card-http',
      idempotencyKey: 'attempt-card-http',
      providerType: 'ACQUIRING' as const,
      purpose: 'Оплата картой',
      status: 'CREATED' as const,
      studentId: student.id,
      studentName: 'Картова Анна',
      updatedAt: now.toISOString(),
    };
    await expect(integration.startAqsiPayment(ownerToken, baseOperation)).resolves.toMatchObject({
      provider: 'AQSI_CARD',
      status: 'WAITING',
    });
    await expect(
      integration.startAqsiPayment(ownerToken, {
        ...baseOperation,
        id: 'operation-sbp-http',
        idempotencyKey: 'attempt-sbp-http',
        providerType: 'SBP',
      }),
    ).resolves.toMatchObject({ provider: 'AQSI_SBP', status: 'WAITING' });
    const paymentRequests = received.filter(({ path }) => String(path).endsWith('/payments/aqsi'));
    expect(paymentRequests).toHaveLength(2);
    expect(paymentRequests.map(({ paymentMethod }) => paymentMethod)).toEqual(['CARD', 'SBP']);
    for (const request of paymentRequests) {
      expect(request.headers).toMatchObject({
        authorization: 'Bearer device-secret',
        'x-arava-api-version': 'v1',
        'x-arava-device-id': credentials.deviceId,
      });
      expect(JSON.stringify(request)).not.toContain('AQSI_API_KEY');
    }

    const fiscal = await integration.retryAqsiFiscalReceipt(ownerToken, baseOperation);
    expect(fiscal.fiscalReceipt).toMatchObject({
      fiscalDocumentNumber: 42,
      fiscalSign: '987654321',
      status: 'SUCCEEDED',
    });
    const fiscalRequest = received.find(({ path }) => String(path).endsWith('/fiscal-receipt'));
    expect(fiscalRequest?.headers).toMatchObject({
      authorization: 'Bearer device-secret',
      'x-arava-device-id': credentials.deviceId,
    });
    expect(JSON.stringify(fiscalRequest)).not.toContain('AQSI_API_KEY');
  });

  it('manages WEB client access through authenticated narrow transport without persisting codes', async () => {
    await pair();
    const branch = await application.createBranch(ownerToken, { name: 'Кабинет клиента' });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Анна',
      lastName: 'Кабинетова',
      phone: '+7 (999) 100-20-30',
      status: 'ACTIVE',
    });
    received.length = 0;
    await expect(
      integration.getClientAccessStatus(ownerToken, student.id, ['+7 (999) 100-20-30']),
    ).resolves.toMatchObject({ crmStudentId: student.id, state: 'NOT_ISSUED' });
    const issued = await integration.issueClientAccess(ownerToken, student.id, {
      displayName: 'Родитель Анны',
      phone: '+7 (999) 100-20-30',
    });
    expect(issued).toMatchObject({ temporaryCode: '654321', status: { state: 'INVITED' } });
    const calls = received.filter(({ path }) => String(path).endsWith('/client-access'));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      action: 'STATUS',
      crmStudentId: student.id,
      method: 'POST',
      phones: ['+7 (999) 100-20-30'],
    });
    expect(calls[1]).toMatchObject({
      action: 'ISSUE',
      crmStudentId: student.id,
      displayName: 'Родитель Анны',
      phone: '+7 (999) 100-20-30',
    });
    expect(calls[1]?.headers).toMatchObject({
      authorization: 'Bearer device-secret',
      'x-arava-api-version': 'v1',
      'x-arava-device-id': credentials.deviceId,
    });
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'WEB_CLIENT_ACCESS_ISSUED', entityId: student.id },
    });
    expect(JSON.stringify(audit)).not.toContain('654321');
    expect(JSON.stringify(issued)).not.toContain('device-secret');

    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'client-access-admin@arava.local',
      fullName: 'Администратор кабинетов',
      password: 'Admin!ClientAccess2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'client-access-coach@arava.local',
      fullName: 'Тренер кабинетов',
      password: 'Coach!ClientAccess2026',
      role: 'COACH',
    });
    const admin = await application.login({
      email: 'client-access-admin@arava.local',
      password: 'Admin!ClientAccess2026',
    });
    const coach = await application.login({
      email: 'client-access-coach@arava.local',
      password: 'Coach!ClientAccess2026',
    });
    await application.changePassword(admin.token, {
      currentPassword: 'Admin!ClientAccess2026',
      newPassword: 'Admin!ClientAccessChanged2026',
    });
    await application.changePassword(coach.token, {
      currentPassword: 'Coach!ClientAccess2026',
      newPassword: 'Coach!ClientAccessChanged2026',
    });
    await expect(
      integration.getClientAccessStatus(admin.token, student.id, []),
    ).resolves.toMatchObject({ state: 'NOT_ISSUED' });
    await expect(integration.getClientAccessStatus(coach.token, student.id, [])).rejects.toThrow(
      'нет доступа',
    );
    const foreignBranch = await application.createBranch(ownerToken, { name: 'Другой филиал' });
    const foreignStudent = await application.createStudent(ownerToken, {
      branchId: foreignBranch.id,
      firstName: 'Елена',
      lastName: 'Недоступная',
      status: 'ACTIVE',
    });
    await expect(
      integration.getClientAccessStatus(admin.token, foreignStudent.id, []),
    ).rejects.toThrow('нет доступа');
  });

  it('sends default display name on pair and allows renaming connected devices', async () => {
    await pair();
    const pairRequest = received.find((entry) => entry.path === '/api/integration/v1/pair');
    expect(pairRequest?.displayName).toBe(hostname().trim() || 'Устройство CRM');

    const targetDeviceId = credentials.deviceId;
    deviceList = [
      {
        conflictCount: 0,
        deviceId: targetDeviceId,
        displayName: hostname().trim() || 'Устройство CRM',
        lastInboundCursor: 0,
        pendingCount: 0,
        status: 'ACTIVE',
      },
    ];
    const statusBeforeRename = await integration.getStatus(ownerToken);
    const targetBefore = statusBeforeRename.devices.find(
      (device) => device.deviceId === targetDeviceId,
    );
    expect(targetBefore?.displayName).toBe(hostname().trim() || 'Устройство CRM');

    await integration.renameDevice(ownerToken, {
      deviceId: targetDeviceId,
      displayName: 'Ресепшен',
    });
    const patched = received.find((entry) => entry.method === 'PATCH');
    expect(patched).toMatchObject({
      method: 'PATCH',
      path: `/api/integration/v1/devices/${encodeURIComponent(targetDeviceId)}`,
    });
    expect(patched?.displayName).toBe('Ресепшен');

    const statusAfterRename = await integration.getStatus(ownerToken);
    const targetAfter = statusAfterRename.devices.find(
      (device) => device.deviceId === targetDeviceId,
    );
    expect(targetAfter?.displayName).toBe('Ресепшен');
  });

  it('falls back to server-provided legacy name when display name is not set', async () => {
    await pair();
    const targetDeviceId = credentials.deviceId;
    deviceList = [
      {
        conflictCount: 0,
        deviceId: targetDeviceId,
        lastInboundCursor: 0,
        name: 'Старый сервер',
        pendingCount: 0,
        status: 'ACTIVE',
      },
    ];
    const status = await integration.getStatus(ownerToken);
    const device = status.devices.find((item) => item.deviceId === targetDeviceId);
    expect(device?.displayName).toBeUndefined();
    expect(device?.name).toBe('Старый сервер');
  });

  it('revokes only another device and keeps OWNER context outside renderer', async () => {
    await pair();
    deviceList = [
      {
        conflictCount: 0,
        deviceId: credentials.deviceId,
        lastInboundCursor: 0,
        pendingCount: 0,
        status: 'ACTIVE',
      },
      {
        conflictCount: 0,
        deviceId: 'device-b',
        lastInboundCursor: 0,
        pendingCount: 2,
        status: 'ACTIVE',
      },
    ];
    await expect(integration.revokeDevice(ownerToken, credentials.deviceId)).rejects.toThrow(
      'Текущее устройство нельзя отозвать',
    );
    await integration.revokeDevice(ownerToken, 'device-b');
    const request = received.find((entry) => entry.method === 'DELETE');
    expect(request).toMatchObject({ path: '/api/integration/v1/devices/device-b' });
    const context = JSON.parse(
      Buffer.from(
        String(
          request?.headers && (request.headers as Record<string, unknown>)['x-arava-crm-context'],
        ),
        'base64url',
      ).toString('utf8'),
    ) as Record<string, unknown>;
    expect(context).toMatchObject({ role: 'OWNER' });
  });

  it('previews reconciliation without changing local data and exposes explicit conflicts', async () => {
    await pair();
    await application.createBranch(ownerToken, { name: 'Локальный филиал' });
    const beforeOutbox = await database.syncOutbox.count();
    const preview = await integration.reconciliationPreview(ownerToken);
    expect(preview.localOnly.some(({ entityType }) => entityType === 'BRANCH')).toBe(true);
    expect(await database.syncOutbox.count()).toBe(beforeOutbox);

    managedConflicts = [
      {
        baseRevision: 1,
        candidate: { name: 'Устройство' },
        candidateOperation: 'UPSERT',
        canonical: { name: 'Сервер' },
        canonicalOperation: 'UPSERT',
        canonicalRevision: 2,
        createdAt: now.toISOString(),
        differences: [{ candidate: 'Устройство', canonical: 'Сервер', field: 'name' }],
        entityId: 'trial-1',
        entityType: 'TRIAL_APPOINTMENT',
        id: 'conflict-1',
        sourceDeviceId: 'device-b',
        status: 'OPEN',
      },
    ];
    const conflicts = await integration.listConflicts(ownerToken);
    expect(conflicts[0]?.differences[0]).toMatchObject({ field: 'name' });
    const resolved = await integration.resolveConflict(ownerToken, 'conflict-1', {
      expectedCanonicalRevision: 2,
      idempotencyKey: 'resolve:conflict-1:once',
      resolution: 'KEEP_CANONICAL',
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(
      received.filter(
        ({ method, path }) =>
          method === 'POST' && String(path).endsWith('/conflicts/conflict-1/resolve'),
      ),
    ).toHaveLength(1);
  });

  it('retries an OWNER scalar conflict with one idempotency key and keeps it out of Conflict Center', async () => {
    await pair();
    const branch = await application.createBranch(ownerToken, { name: 'Последняя версия' });
    await database.syncOutbox.deleteMany();
    const candidate = await integration.safePayload('BRANCH', branch.id);
    managedConflicts = [
      {
        baseRevision: 1,
        candidate,
        candidateOperation: 'UPSERT',
        canonical: { ...candidate, name: 'Предыдущая версия' },
        canonicalOperation: 'UPSERT',
        canonicalRevision: 2,
        createdAt: now.toISOString(),
        differences: [
          { candidate: 'Последняя версия', canonical: 'Предыдущая версия', field: 'name' },
        ],
        entityId: branch.id,
        entityType: 'BRANCH',
        id: 'auto-branch-conflict',
        resolveFailuresRemaining: 1,
        simulateCanonicalChange: true,
        sourceDeviceId: 'device-b',
        status: 'OPEN',
      },
    ];

    expect(await integration.listConflicts(ownerToken)).toEqual([]);
    await integration.processPending();
    expect(managedConflicts).toHaveLength(1);
    await integration.processPending();
    await integration.processPending();

    expect(managedConflicts).toHaveLength(0);
    expect(await database.branch.findUnique({ where: { id: branch.id } })).toMatchObject({
      name: 'Последняя версия',
    });
    const resolutions = received.filter(
      ({ method, path }) =>
        method === 'POST' && String(path).endsWith('/conflicts/auto-branch-conflict/resolve'),
    );
    expect(resolutions).toHaveLength(2);
    expect(new Set(resolutions.map(({ idempotencyKey }) => idempotencyKey))).toEqual(
      new Set(['auto-lww:auto-branch-conflict:2']),
    );
    expect(resolutions.every(({ resolution }) => resolution === 'ACCEPT_CANDIDATE')).toBe(true);
    expect(
      resolutions.every(({ expectedCanonicalRevision }) => expectedCanonicalRevision === 2),
    ).toBe(true);
    expect(
      await database.syncLog.count({
        where: { entityId: branch.id, operation: 'CONFLICT_AUTO_RESOLVE', result: 'AUTO_RESOLVED' },
      }),
    ).toBe(1);
  });

  it('humanizes trial conflicts without exposing relation ids in the primary presentation', async () => {
    await pair();
    const branch = await application.createBranch(ownerToken, { name: 'Конфликт пробного' });
    const studio = new StudioService(database, application);
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 12,
      direction: 'Хип-хоп',
      name: 'KDS BABY',
      status: 'RECRUITING',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Дамир',
      lastName: 'Саидов',
      status: 'TRIAL',
    });
    const lessonA = await studio.createLesson(ownerToken, {
      endsAt: '2030-08-27T16:00:00.000Z',
      groupId: group.id,
      startsAt: '2030-08-27T15:00:00.000Z',
    });
    const lessonB = await studio.createLesson(ownerToken, {
      endsAt: '2030-08-28T17:00:00.000Z',
      groupId: group.id,
      startsAt: '2030-08-28T16:00:00.000Z',
    });
    managedConflicts = [
      {
        baseRevision: 3,
        candidate: {
          groupId: group.id,
          lessonId: lessonA.id,
          outcome: 'THINKING',
          status: 'BOOKED',
          studentId: student.id,
        },
        candidateOperation: 'UPSERT',
        canonical: {
          groupId: group.id,
          lessonId: lessonB.id,
          outcome: 'DECLINED',
          status: 'BOOKED',
          studentId: student.id,
        },
        canonicalOperation: 'UPSERT',
        canonicalRevision: 4,
        createdAt: now.toISOString(),
        differences: [
          { candidate: lessonA.id, canonical: lessonB.id, field: 'lessonId' },
          { candidate: 'THINKING', canonical: 'DECLINED', field: 'outcome' },
        ],
        entityId: 'trial-conflict',
        entityType: 'TRIAL_APPOINTMENT',
        id: 'trial-humanized',
        sourceDeviceId: 'device-b',
        sourceDeviceName: 'Ресепшен',
        status: 'OPEN',
      },
    ];

    const conflict = (await integration.listConflicts(ownerToken))[0];
    expect(conflict?.display).toMatchObject({
      candidateLabel: 'На устройстве «Ресепшен»',
      category: 'Пробное занятие',
      subject: 'Саидов Дамир',
      title: 'Пробное занятие изменено на другом устройстве',
    });
    expect(conflict?.display.candidateLines).toEqual(
      expect.arrayContaining(['Группа: KDS BABY', 'Результат: Думает']),
    );
    expect(conflict?.display.canonicalLines).toEqual(
      expect.arrayContaining(['Группа: KDS BABY', 'Результат: Отказался']),
    );
    expect(JSON.stringify(conflict?.display)).not.toContain(student.id);
    expect(JSON.stringify(conflict?.display)).not.toContain(group.id);
    expect(JSON.stringify(conflict?.display)).not.toContain(lessonA.id);

    managedConflicts = [
      {
        baseRevision: 1,
        candidate: { firstName: 'Дамир', lastName: 'Саидов', status: 'ACTIVE' },
        candidateOperation: 'UPSERT',
        canonical: { firstName: 'Данил', lastName: 'Саидов', status: 'ACTIVE' },
        canonicalOperation: 'UPSERT',
        canonicalRevision: 2,
        createdAt: now.toISOString(),
        differences: [{ candidate: 'Дамир', canonical: 'Данил', field: 'firstName' }],
        entityId: student.id,
        entityType: 'STUDENT_IDENTITY',
        id: 'student-humanized',
        sourceDeviceId: 'device-b',
        status: 'OPEN',
      },
      {
        baseRevision: 1,
        candidate: { groupId: group.id, status: 'ACTIVE', studentId: student.id },
        candidateOperation: 'UPSERT',
        canonical: { groupId: group.id, status: 'LEFT', studentId: student.id },
        canonicalOperation: 'UPSERT',
        canonicalRevision: 2,
        createdAt: now.toISOString(),
        differences: [{ candidate: 'ACTIVE', canonical: 'LEFT', field: 'status' }],
        entityId: 'membership-humanized',
        entityType: 'GROUP_MEMBERSHIP',
        id: 'membership-humanized',
        sourceDeviceId: 'device-b',
        status: 'OPEN',
      },
      {
        baseRevision: 1,
        candidate: { lessonId: lessonA.id, status: 'PRESENT', studentId: student.id },
        candidateOperation: 'UPSERT',
        canonical: { lessonId: lessonA.id, status: 'ABSENT', studentId: student.id },
        canonicalOperation: 'UPSERT',
        canonicalRevision: 2,
        createdAt: now.toISOString(),
        differences: [{ candidate: 'PRESENT', canonical: 'ABSENT', field: 'status' }],
        entityId: `${lessonA.id}:${student.id}`,
        entityType: 'ATTENDANCE',
        id: 'attendance-humanized',
        sourceDeviceId: 'device-b',
        status: 'OPEN',
      },
      {
        baseRevision: 1,
        candidate: { changed: true },
        candidateOperation: 'UPSERT',
        canonical: { changed: false },
        canonicalOperation: 'UPSERT',
        canonicalRevision: 2,
        createdAt: now.toISOString(),
        differences: [{ candidate: true, canonical: false, field: 'changed' }],
        entityId: 'unknown-humanized',
        entityType: 'FUTURE_ENTITY',
        id: 'unknown-humanized',
        sourceDeviceId: 'device-b',
        status: 'OPEN',
      },
    ];
    const humanized = await integration.listConflicts(ownerToken);
    expect(humanized.map(({ display }) => display.title)).toEqual([
      'Состав группы изменён на двух устройствах',
      'Посещение изменено одновременно',
      'Данные: данные изменены одновременно',
    ]);
    expect(humanized[0]?.display.candidateLines).toContain('Группа: KDS BABY');
    expect(humanized[1]?.display.candidateLines).toContain('Посещение: Присутствовал');
    expect(humanized[2]?.display.canonicalLines).toContain('Изменённое значение: Нет');
  });

  it('creates a backup and replaces sync-managed local data from the server without pushing', async () => {
    await pair();
    const local = await application.createBranch(ownerToken, { name: 'Тестовый филиал' });
    await database.syncOutbox.deleteMany();
    changes.push({
      entityId: 'server-branch',
      entityType: 'BRANCH',
      operation: 'UPSERT',
      payload: {
        address: 'Серверная улица',
        isActive: true,
        name: 'Филиал с сервера',
        phone: '',
      },
      revision: 1,
      sequence: 1,
      serverUpdatedAt: now.toISOString(),
      sourceDeviceId: 'server-device',
    });
    canonical.set('BRANCH:server-branch', {
      operation: 'UPSERT',
      payload: { isActive: true, name: 'Филиал с сервера' },
      revision: 1,
      sequence: 1,
    });
    managedConflicts = [
      {
        baseRevision: 0,
        candidate: { name: 'Тестовый филиал' },
        candidateOperation: 'UPSERT',
        canonical: { name: 'Филиал с сервера' },
        canonicalOperation: 'UPSERT',
        canonicalRevision: 1,
        createdAt: now.toISOString(),
        differences: [
          { candidate: 'Тестовый филиал', canonical: 'Филиал с сервера', field: 'name' },
        ],
        entityId: 'server-branch',
        entityType: 'BRANCH',
        id: 'recovery-conflict',
        sourceDeviceId: credentials.deviceId,
        status: 'OPEN',
      },
    ];
    received = [];
    const tokenBefore = credentials.token;

    const result = await integration.recoverFromServer(ownerToken);

    expect(backupAttempts).toBe(1);
    expect(result).toMatchObject({ receivedChanges: 1, resolvedConflicts: 1, serverCursor: 1 });
    expect(await database.branch.findUnique({ where: { id: local.id } })).toBeNull();
    expect(await database.branch.findUnique({ where: { id: 'server-branch' } })).toMatchObject({
      name: 'Филиал с сервера',
    });
    expect(await database.syncOutbox.count()).toBe(0);
    expect(await database.syncConflict.count()).toBe(0);
    expect(
      await database.appSetting.findUniqueOrThrow({
        where: { key: 'integration.inboundCursor' },
      }),
    ).toMatchObject({ value: '1' });
    expect(credentials.token).toBe(tokenBefore);
    expect(received.filter(({ method }) => method === 'POST')).toEqual([
      expect.objectContaining({
        path: '/api/integration/v1/conflicts/recovery-conflict/resolve',
        resolution: 'KEEP_CANONICAL',
      }),
    ]);
    expect(received.some(({ path }) => path === '/api/integration/v1/sync')).toBe(false);
    await expect(application.restoreSession(ownerToken)).resolves.toMatchObject({ role: 'OWNER' });
  });

  it('restores synchronized trial history and protects an unsent trial before recovery', async () => {
    await pair();
    const branch = await application.createBranch(ownerToken, { name: 'Recovery trials' });
    const studio = new StudioService(database, application);
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 10,
      direction: 'Контемп',
      name: 'Recovery group',
      status: 'RECRUITING',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Ольга',
      lastName: 'Recovery',
      status: 'TRIAL',
    });
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: '2030-08-24T16:00:00.000Z',
      groupId: group.id,
      startsAt: '2030-08-24T15:00:00.000Z',
    });
    const trials = new LeadService(database, application, integration, studio);
    const trial = await trials.scheduleTrial(ownerToken, {
      groupId: group.id,
      startsAt: lesson.startsAt,
      studentId: student.id,
    });
    await expect(integration.recoverFromServer(ownerToken)).rejects.toThrow(
      'неотправленные изменения',
    );
    await database.syncOutbox.deleteMany({
      where: { entityId: trial.id, entityType: 'TRIAL_APPOINTMENT' },
    });
    for (let attempt = 0; attempt < 4; attempt += 1) await integration.processPending();
    expect(await database.syncOutbox.count({ where: { status: 'PENDING' } })).toBe(0);
    expect(
      await database.syncOutbox.findUnique({
        where: { idempotencyKey: `trial-bootstrap:${trial.id}` },
      }),
    ).toMatchObject({ status: 'SYNCED' });

    await integration.recoverFromServer(ownerToken);
    expect(await database.trialAppointment.findUnique({ where: { id: trial.id } })).toMatchObject({
      lessonId: lesson.id,
      status: 'BOOKED',
      studentId: student.id,
    });
  });

  it.each([
    ['ACCEPT_CANDIDATE', 'Версия устройства'],
    ['KEEP_CANONICAL', 'Версия сервера'],
  ] as const)(
    'applies %s conflict resolution to the local canonical state',
    async (resolution, expectedName) => {
      await pair();
      const branch = await application.createBranch(ownerToken, { name: 'Версия устройства' });
      await database.syncOutbox.deleteMany();
      const candidate = await integration.safePayload('BRANCH', branch.id);
      const canonicalPayload = { ...candidate, name: 'Версия сервера' };
      await database.syncEntityState.create({
        data: {
          entityId: branch.id,
          entityType: 'BRANCH',
          revision: 2,
          serverSequence: 0,
          serverUpdatedAt: now,
          sourceDeviceId: credentials.deviceId,
        },
      });
      managedConflicts = [
        {
          baseRevision: 1,
          candidate,
          candidateOperation: 'UPSERT',
          canonical: canonicalPayload,
          canonicalOperation: 'UPSERT',
          canonicalRevision: 2,
          createdAt: now.toISOString(),
          differences: [
            { candidate: 'Версия устройства', canonical: 'Версия сервера', field: 'name' },
          ],
          entityId: branch.id,
          entityType: 'BRANCH',
          id: 'conflict-device-version',
          simulateCanonicalChange: true,
          sourceDeviceId: credentials.deviceId,
          status: 'OPEN',
        },
      ];
      received = [];
      await integration.resolveConflict(ownerToken, 'conflict-device-version', {
        expectedCanonicalRevision: 2,
        idempotencyKey: 'resolve-device-version-once',
        resolution,
      });
      expect(received).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          resolution,
        }),
      );
      expect(await database.branch.findUnique({ where: { id: branch.id } })).toMatchObject({
        name: expectedName,
      });
      expect(managedConflicts).toHaveLength(0);
      expect(
        await database.syncEntityState.findUnique({
          where: { entityType_entityId: { entityId: branch.id, entityType: 'BRANCH' } },
        }),
      ).toMatchObject({ revision: 3 });
    },
  );

  it('runs a fresh canonical pull after a concurrent background cycle finishes', async () => {
    await pair();
    const branch = await application.createBranch(ownerToken, { name: 'Пробный конфликт' });
    const studio = new StudioService(database, application);
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 10,
      direction: 'Контемп',
      name: 'Пробный конфликт',
      status: 'RECRUITING',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Анна',
      lastName: 'Конфликтова',
      status: 'TRIAL',
    });
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: '2030-08-27T16:00:00.000Z',
      groupId: group.id,
      startsAt: '2030-08-27T15:00:00.000Z',
    });
    const trials = new LeadService(database, application, integration, studio);
    const trial = await trials.scheduleTrial(ownerToken, {
      groupId: group.id,
      startsAt: lesson.startsAt,
      studentId: student.id,
    });
    await database.syncOutbox.deleteMany();
    const candidate = await integration.safePayload('TRIAL_APPOINTMENT', trial.id);
    await database.syncEntityState.create({
      data: {
        entityId: trial.id,
        entityType: 'TRIAL_APPOINTMENT',
        revision: 2,
        serverSequence: 0,
        serverUpdatedAt: now,
        sourceDeviceId: credentials.deviceId,
      },
    });
    managedConflicts = [
      {
        baseRevision: 1,
        candidate,
        candidateOperation: 'UPSERT',
        canonical: { ...candidate, outcome: 'DECLINED' },
        canonicalOperation: 'UPSERT',
        canonicalRevision: 2,
        createdAt: now.toISOString(),
        differences: [{ candidate: null, canonical: 'DECLINED', field: 'outcome' }],
        entityId: trial.id,
        entityType: 'TRIAL_APPOINTMENT',
        id: 'conflict-concurrent-sync',
        simulateCanonicalChange: true,
        sourceDeviceId: credentials.deviceId,
        status: 'OPEN',
      },
    ];
    let releaseChanges: () => void = () => undefined;
    changesResponseGate = new Promise<void>((resolve) => {
      releaseChanges = resolve;
    });
    const firstChangesRequest = new Promise<void>((resolve) => {
      changesRequestStarted = resolve;
    });
    const background = integration.processPending();
    await firstChangesRequest;
    const resolution = integration.resolveConflict(ownerToken, 'conflict-concurrent-sync', {
      expectedCanonicalRevision: 2,
      idempotencyKey: 'resolve-concurrent-sync-once',
      resolution: 'KEEP_CANONICAL',
    });
    await new Promise((resolve) => setImmediate(resolve));
    changesResponseGate = undefined;
    releaseChanges();
    await Promise.all([background, resolution]);

    expect(await database.trialAppointment.findUnique({ where: { id: trial.id } })).toMatchObject({
      outcome: 'DECLINED',
    });
    expect(
      received.filter(
        ({ method, path }) =>
          method === 'GET' &&
          String(path).includes('/changes?') &&
          !String(path).includes('snapshot=canonical'),
      ),
    ).toHaveLength(2);
  });

  it('does not expose unsafe generic overwrite for financial conflicts', async () => {
    await pair();
    managedConflicts = [
      {
        baseRevision: 1,
        candidate: { lessonsUsed: 2 },
        candidateOperation: 'UPSERT',
        canonical: { lessonsUsed: 3 },
        canonicalOperation: 'UPSERT',
        canonicalRevision: 2,
        createdAt: now.toISOString(),
        differences: [{ candidate: 2, canonical: 3, field: 'lessonsUsed' }],
        entityId: 'subscription-financial-conflict',
        entityType: 'SUBSCRIPTION',
        id: 'financial-conflict',
        sourceDeviceId: 'device-b',
        status: 'OPEN',
      },
    ];
    received = [];

    await expect(
      integration.resolveConflict(ownerToken, 'financial-conflict', {
        expectedCanonicalRevision: 2,
        idempotencyKey: 'financial-conflict-once',
        resolution: 'ACCEPT_CANDIDATE',
      }),
    ).rejects.toThrow('Финансовый конфликт');
    expect(received.some(({ method }) => method === 'POST')).toBe(false);
  });

  it('aborts recovery before local mutation when the required backup fails', async () => {
    await pair();
    const local = await application.createBranch(ownerToken, { name: 'Сохранить локально' });
    await database.syncOutbox.deleteMany();
    backupFailure = new Error('backup failed');
    await expect(integration.recoverFromServer(ownerToken)).rejects.toThrow('backup failed');
    expect(await database.branch.findUnique({ where: { id: local.id } })).not.toBeNull();
    expect(backupAttempts).toBe(1);
  });

  it('blocks recovery when local-only operational records would be orphaned', async () => {
    await pair();
    const branch = await application.createBranch(ownerToken, { name: 'Локальные операции' });
    await database.calendarException.create({
      data: {
        branchId: branch.id,
        endAt: new Date('2030-08-20T12:00:00.000Z'),
        startAt: new Date('2030-08-20T10:00:00.000Z'),
        title: 'Локальный выходной',
        type: 'DAY_OFF',
      },
    });
    await database.syncOutbox.deleteMany();
    await expect(integration.recoverFromServer(ownerToken)).rejects.toThrow(
      'локальные финансовые или операционные данные',
    );
    expect(backupAttempts).toBe(0);
  });

  it('returns a fully healthy read-only diagnostic without exposing credentials', async () => {
    await pair();
    deviceList.push({
      conflictCount: 0,
      deviceId: credentials.deviceId,
      displayName: 'Ресепшен',
      lastInboundCursor: 0,
      pendingCount: 0,
      status: 'ACTIVE',
    });
    await application.createBranch(ownerToken, { name: 'Диагностика' });
    await integration.processPending();
    const before = {
      conflicts: await database.syncConflict.count(),
      cursor: await database.appSetting.findUnique({ where: { key: 'integration.inboundCursor' } }),
      outbox: await database.syncOutbox.findMany({ orderBy: { id: 'asc' } }),
      token: await credentials.getToken(),
    };

    const result = await integration.diagnose(ownerToken);

    expect(result.overall).toBe('HEALTHY');
    expect(result.device).toEqual({ deviceId: credentials.deviceId, displayName: 'Ресепшен' });
    expect(result.checks.every(({ status }) => status === 'WORKING')).toBe(true);
    expect(result.checks.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'server',
        'integration-health',
        'api-version',
        'device-auth',
        'device-status',
        'device-recognized',
        'outbox-access',
        'outbox-pending',
        'outbox-failed',
        'outbound-last-success',
        'inbound-cursor',
        'inbound-last-success',
        'conflicts',
        'chat-api',
        'publication-api',
        'aqsi-configured',
        'aqsi-reachable',
        'aqsi-device',
      ]),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('device-secret');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Bearer');
    expect({
      conflicts: await database.syncConflict.count(),
      cursor: await database.appSetting.findUnique({ where: { key: 'integration.inboundCursor' } }),
      outbox: await database.syncOutbox.findMany({ orderBy: { id: 'asc' } }),
      token: await credentials.getToken(),
    }).toEqual(before);
  });

  it('reports pending, failed outbox items and unresolved conflicts from local state', async () => {
    await pair();
    await application.createBranch(ownerToken, { name: 'Очередь диагностики' });
    const pending = await integration.diagnose(ownerToken);
    expect(pending.checks.find(({ id }) => id === 'outbox-pending')).toMatchObject({
      status: 'WARNING',
    });

    await database.syncOutbox.updateMany({ data: { status: 'FAILED' } });
    await database.syncConflict.create({
      data: {
        baseRevision: 0,
        candidateOperation: 'UPSERT',
        candidatePayloadJson: '{}',
        canonicalOperation: 'UPSERT',
        canonicalPayloadJson: '{}',
        canonicalRevision: 1,
        entityId: 'diagnostic-entity',
        entityType: 'ATTENDANCE',
        serverConflictId: 'diagnostic-conflict',
      },
    });
    const unhealthy = await integration.diagnose(ownerToken);
    expect(unhealthy.overall).toBe('ERROR');
    expect(unhealthy.checks.find(({ id }) => id === 'outbox-failed')).toMatchObject({
      status: 'ERROR',
    });
    expect(unhealthy.checks.find(({ id }) => id === 'conflicts')).toMatchObject({
      status: 'WARNING',
    });
  });

  it('reports pending, processing and safe failed details separately with durable success time', async () => {
    await pair();
    const first = await application.createBranch(ownerToken, { name: 'Ожидает отправки' });
    const second = await application.createBranch(ownerToken, { name: 'Отправляется' });
    const rows = await database.syncOutbox.findMany({
      orderBy: { createdAt: 'asc' },
      where: { entityId: { in: [first.id, second.id] } },
    });
    await database.syncOutbox.update({
      data: { status: 'PROCESSING' },
      where: { id: rows[1]?.id ?? '' },
    });
    await database.syncOutbox.create({
      data: {
        entityId: 'failed-safe',
        entityType: 'TRIAL_APPOINTMENT',
        idempotencyKey: 'failed-safe-once',
        lastAttemptAt: now,
        lastErrorCode: 'TIMEOUT',
        status: 'FAILED',
      },
    });
    await database.appSetting.upsert({
      create: { key: 'integration.lastSuccessfulSync', value: now.toISOString() },
      update: { value: now.toISOString() },
      where: { key: 'integration.lastSuccessfulSync' },
    });

    const status = await integration.getStatus(ownerToken);
    expect(status).toMatchObject({
      failedCount: 1,
      lastSuccessfulSync: now.toISOString(),
      pendingCount: 1,
      processingCount: 1,
      recoveryBlocked: true,
      retryableFailedCount: 1,
    });
    expect(status.failedItems).toEqual([
      expect.objectContaining({
        entityLabel: 'Пробное занятие',
        reason: 'Сервер не ответил вовремя.',
        retryable: true,
      }),
    ]);
    expect(JSON.stringify(status.failedItems)).not.toContain('failed-safe');
  });

  it('returns complete safe results for offline, timeout and revoked-device failures', async () => {
    await pair();
    const offlineService = new IntegrationService(
      database,
      application,
      credentials,
      new IntegrationApiClient(() => Promise.reject(new Error('private network details'))),
      () => now,
    );
    const offline = await offlineService.diagnose(ownerToken);
    expect(offline.overall).toBe('ERROR');
    expect(offline.checks.find(({ id }) => id === 'server')).toMatchObject({ status: 'ERROR' });
    expect(JSON.stringify(offline)).not.toContain('private network details');

    mode = 'SLOW';
    const timeoutService = new IntegrationService(
      database,
      application,
      credentials,
      new IntegrationApiClient(globalThis.fetch, 10),
      () => now,
    );
    const timeout = await timeoutService.diagnose(ownerToken);
    const timeoutHealth = timeout.checks.find(({ id }) => id === 'integration-health');
    expect(timeoutHealth?.detail).toContain('не ответил');
    expect(timeoutHealth?.status).toBe('ERROR');

    mode = 'REVOKED';
    const revoked = await integration.diagnose(ownerToken);
    const revokedAuth = revoked.checks.find(({ id }) => id === 'device-auth');
    expect(revokedAuth?.detail).toContain('отозвал');
    expect(revokedAuth?.status).toBe('ERROR');
  });

  it('reports incompatible API and independent chat/publication endpoint failures', async () => {
    await pair();
    healthApiVersion = 'v2';
    const incompatible = await integration.diagnose(ownerToken);
    expect(incompatible.checks.find(({ id }) => id === 'api-version')).toMatchObject({
      status: 'ERROR',
    });

    healthApiVersion = 'v1';
    failedProbe = 'CHAT';
    const chatFailure = await integration.diagnose(ownerToken);
    expect(chatFailure.checks.find(({ id }) => id === 'chat-api')).toMatchObject({
      status: 'ERROR',
    });
    expect(chatFailure.checks.find(({ id }) => id === 'publication-api')).toMatchObject({
      status: 'WORKING',
    });

    failedProbe = 'PUBLICATION';
    const publicationFailure = await integration.diagnose(ownerToken);
    expect(publicationFailure.checks.find(({ id }) => id === 'chat-api')).toMatchObject({
      status: 'WORKING',
    });
    expect(publicationFailure.checks.find(({ id }) => id === 'publication-api')).toMatchObject({
      status: 'ERROR',
    });
  });

  it('allows diagnostics only to OWNER', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Права диагностики' });
    for (const role of ['ADMIN', 'COACH'] as const) {
      const email = `diagnostic-${role.toLowerCase()}@arava.local`;
      const password = `${role}!Diagnostic2026`;
      await application.createUser(ownerToken, {
        branchIds: [branch.id],
        email,
        fullName: role,
        password,
        role,
      });
      const session = await application.login({ email, password });
      await application.changePassword(session.token, {
        currentPassword: password,
        newPassword: `${role}!DiagnosticChanged2026`,
      });
      await expect(integration.diagnose(session.token)).rejects.toThrow('только владелец');
      await expect(integration.listConflicts(session.token)).rejects.toThrow('только владелец');
      await expect(integration.recoverFromServer(session.token)).rejects.toThrow('только владелец');
      await expect(integration.revokeDevice(session.token, 'device-b')).rejects.toThrow(
        'только владелец',
      );
    }
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

  it('converges two OWNER devices by server order without clock-based conflicts or an echo loop', async () => {
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
      await database.student.update({
        data: { updatedAt: new Date('2040-01-01T00:00:00.000Z') },
        where: { id: student.id },
      });
      await secondDatabase.student.update({
        data: { updatedAt: new Date('2020-01-01T00:00:00.000Z') },
        where: { id: student.id },
      });
      await integration.processPending();
      await secondIntegration.processPending();
      await integration.processPending();
      await secondIntegration.processPending();
      expect(await database.student.findUnique({ where: { id: student.id } })).toMatchObject({
        firstName: 'Анна Б',
      });
      expect(await secondDatabase.student.findUnique({ where: { id: student.id } })).toMatchObject({
        firstName: 'Анна Б',
      });
      expect(
        await secondDatabase.syncConflict.count({
          where: { entityId: student.id, entityType: 'STUDENT_IDENTITY', status: 'OPEN' },
        }),
      ).toBe(0);
      expect(await integration.listConflicts(ownerToken)).toEqual([]);
      expect(
        await secondDatabase.syncLog.findFirst({
          where: {
            entityId: student.id,
            entityType: 'STUDENT_IDENTITY',
            result: 'AUTO_RESOLVED',
          },
        }),
      ).toMatchObject({ operation: 'CONFLICT_AUTO_RESOLVE' });

      // Device A now works offline. Device B reaches the server first; when A reconnects,
      // its later server submission wins regardless of either device's local clock.
      await application.updateStudent(ownerToken, student.id, {
        branchId: branch.id,
        firstName: 'Анна после офлайна',
        lastName: 'Два устройства',
        status: 'ACTIVE',
      });
      await secondApplication.updateStudent(secondLogin.token, student.id, {
        branchId: branch.id,
        firstName: 'Анна онлайн',
        lastName: 'Два устройства',
        status: 'ACTIVE',
      });
      await database.student.update({
        data: { updatedAt: new Date('2050-01-01T00:00:00.000Z') },
        where: { id: student.id },
      });
      await secondDatabase.student.update({
        data: { updatedAt: new Date('2010-01-01T00:00:00.000Z') },
        where: { id: student.id },
      });
      await secondIntegration.processPending();
      await integration.processPending();
      await secondIntegration.processPending();
      await integration.processPending();
      expect(await database.student.findUnique({ where: { id: student.id } })).toMatchObject({
        firstName: 'Анна после офлайна',
      });
      expect(await secondDatabase.student.findUnique({ where: { id: student.id } })).toMatchObject({
        firstName: 'Анна после офлайна',
      });
      expect(
        await secondDatabase.syncConflict.count({
          where: { entityId: student.id, entityType: 'STUDENT_IDENTITY', status: 'OPEN' },
        }),
      ).toBe(0);
      expect(await database.syncOutbox.count({ where: { entityId: membership.id } })).toBe(0);
    } finally {
      await closeDatabase(secondDatabase);
      await rm(secondDirectory, { force: true, recursive: true });
    }
  });

  it('replicates trial create, reschedule, cancel, and outcome without replaying business commands', async () => {
    await pair();
    const branch = await application.createBranch(ownerToken, { name: 'Пробные sync' });
    const studio = new StudioService(database, application);
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      direction: 'Хип-хоп',
      name: 'Пробная группа',
      status: 'RECRUITING',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Анна',
      lastName: 'Пробная',
      status: 'TRIAL',
    });
    const firstLesson = await studio.createLesson(ownerToken, {
      endsAt: '2030-08-20T16:00:00.000Z',
      groupId: group.id,
      startsAt: '2030-08-20T15:00:00.000Z',
    });
    const secondLesson = await studio.createLesson(ownerToken, {
      endsAt: '2030-08-22T16:00:00.000Z',
      groupId: group.id,
      startsAt: '2030-08-22T15:00:00.000Z',
    });
    const leadService = new LeadService(database, application, integration, studio);
    const first = await leadService.scheduleTrial(ownerToken, {
      groupId: group.id,
      startsAt: firstLesson.startsAt,
      studentId: student.id,
    });
    expect(
      await database.syncOutbox.count({
        where: { entityId: first.id, entityType: 'TRIAL_APPOINTMENT' },
      }),
    ).toBe(1);
    for (let attempt = 0; attempt < 4; attempt += 1) await integration.processPending();

    const secondDirectory = await mkdtemp(join(tmpdir(), 'arava-trial-sync-device-b-'));
    const secondDatabase = createDatabaseClient(toSqliteUrl(join(secondDirectory, 'device-b.db')));
    try {
      await initializeDatabase(secondDatabase);
      const secondApplication = new ApplicationService(secondDatabase);
      const secondLogin = await secondApplication.login({
        email: INITIAL_OWNER_EMAIL,
        password: INITIAL_OWNER_PASSWORD,
      });
      await secondApplication.changePassword(secondLogin.token, {
        currentPassword: INITIAL_OWNER_PASSWORD,
        newPassword: 'Owner!TrialDeviceB2026',
      });
      const secondCredentials = new MemoryCredentials();
      secondCredentials.deviceId = '67b1345e-77e3-47ab-8665-239393041edf';
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
      for (let attempt = 0; attempt < 4; attempt += 1) await secondIntegration.processPending();
      expect(
        await secondDatabase.trialAppointment.findUnique({ where: { id: first.id } }),
      ).toMatchObject({ lessonId: firstLesson.id, status: 'BOOKED', studentId: student.id });

      const secondStudio = new StudioService(secondDatabase, secondApplication);
      const secondLeadService = new LeadService(
        secondDatabase,
        secondApplication,
        secondIntegration,
        secondStudio,
      );
      const purchased = await secondLeadService.setTrialOutcome(secondLogin.token, first.id, {
        expectedVersion: (
          await secondDatabase.trialAppointment.findUniqueOrThrow({ where: { id: first.id } })
        ).version,
        outcome: 'PURCHASED',
      });
      await secondIntegration.processPending();
      await integration.processPending();
      expect(
        await database.trialAppointment.findUniqueOrThrow({ where: { id: first.id } }),
      ).toMatchObject({
        outcome: 'PURCHASED',
        version: purchased.version,
      });
      expect(await database.subscription.count({ where: { studentId: student.id } })).toBe(0);

      const rescheduled = await secondLeadService.scheduleTrial(secondLogin.token, {
        groupId: group.id,
        startsAt: secondLesson.startsAt,
        studentId: student.id,
      });
      await secondLeadService.setTrialOutcome(secondLogin.token, rescheduled.id, {
        expectedVersion: rescheduled.version ?? 1,
        outcome: 'THINKING',
      });
      for (let attempt = 0; attempt < 4; attempt += 1) await secondIntegration.processPending();
      for (let attempt = 0; attempt < 4; attempt += 1) await integration.processPending();

      expect(await database.trialAppointment.findUnique({ where: { id: first.id } })).toMatchObject(
        { status: 'CANCELLED' },
      );
      const replicated = await database.trialAppointment.findUniqueOrThrow({
        where: { id: rescheduled.id },
      });
      expect(replicated).toMatchObject({ lessonId: secondLesson.id, outcome: 'THINKING' });
      expect(await database.subscription.count({ where: { studentId: student.id } })).toBe(0);
      await leadService.setTrialOutcome(ownerToken, replicated.id, {
        expectedVersion: replicated.version,
        outcome: 'DECLINED',
      });
      const secondCopy = await secondDatabase.trialAppointment.findUniqueOrThrow({
        where: { id: rescheduled.id },
      });
      await secondLeadService.setTrialOutcome(secondLogin.token, rescheduled.id, {
        expectedVersion: secondCopy.version,
        outcome: 'NO_SHOW',
      });
      await integration.processPending();
      await secondIntegration.processPending();
      expect(
        await secondDatabase.syncConflict.count({
          where: {
            entityId: rescheduled.id,
            entityType: 'TRIAL_APPOINTMENT',
            status: 'OPEN',
          },
        }),
      ).toBe(1);
      expect(
        await secondDatabase.trialAppointment.findUniqueOrThrow({ where: { id: rescheduled.id } }),
      ).toMatchObject({ outcome: 'NO_SHOW' });

      const current = await database.trialAppointment.findUniqueOrThrow({
        where: { id: replicated.id },
      });
      await leadService.cancelTrial(ownerToken, replicated.id, {
        expectedVersion: current.version,
      });
      await integration.processPending();
      await secondIntegration.processPending();
      expect(
        await secondDatabase.trialAppointment.findUnique({ where: { id: replicated.id } }),
      ).toMatchObject({ status: 'CANCELLED' });
      expect(
        await secondDatabase.syncOutbox.count({
          where: { entityType: 'TRIAL_APPOINTMENT', status: 'PENDING' },
        }),
      ).toBe(0);
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

  it('keeps trainer identity stable and refreshes derived payloads through the existing outbox', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Тренерский филиал' });
    const trainerA = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'trainer-a-sync@arava.local',
      fullName: 'Анна До Переименования',
      password: 'Trainer!A2026',
      role: 'COACH',
    });
    const trainerB = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'trainer-b-sync@arava.local',
      fullName: 'Борис Тренер',
      password: 'Trainer!B2026',
      role: 'COACH',
    });
    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        coachId: trainerA.id,
        direction: 'Хип-хоп',
        name: 'Активная группа',
        status: 'ACTIVE',
      },
    });

    await database.syncOutbox.deleteMany();
    const renamed = await application.updateUser(ownerToken, trainerA.id, {
      branchIds: [branch.id],
      fullName: 'Анна После Переименования',
      isActive: true,
      phone: '+7 999 123-45-67',
      role: 'COACH',
      trainerDescription: 'Ведёт занятия по хип-хопу.',
    });
    expect(renamed.id).toBe(trainerA.id);
    expect(await database.danceGroup.findUniqueOrThrow({ where: { id: group.id } })).toMatchObject({
      coachId: trainerA.id,
    });
    expect(
      await database.syncOutbox.count({
        where: { entityId: trainerA.id, entityType: 'TRAINER', status: 'PENDING' },
      }),
    ).toBe(1);
    const payload = await integration.safePayload('TRAINER', trainerA.id);
    expect(payload).toEqual(
      expect.objectContaining({
        activeGroupIds: [group.id],
        branchIds: [branch.id],
        description: 'Ведёт занятия по хип-хопу.',
        directions: ['Хип-хоп'],
        displayName: 'Анна После Переименования',
        id: trainerA.id,
        isActive: true,
        phone: '+79991234567',
      }),
    );
    for (const forbidden of [
      'email',
      'passwordHash',
      'securityVersion',
      'recoveryCodeHash',
      'mustChangePassword',
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }

    await database.syncOutbox.deleteMany();
    await database.danceGroup.update({
      data: { direction: 'Контемпорари' },
      where: { id: group.id },
    });
    expect(
      await database.syncOutbox.count({
        where: { entityId: trainerA.id, entityType: 'TRAINER' },
      }),
    ).toBe(1);

    await database.syncOutbox.deleteMany();
    await database.danceGroup.update({
      data: { archivedAt: new Date(), status: 'ARCHIVED' },
      where: { id: group.id },
    });
    expect(
      await database.syncOutbox.count({
        where: { entityId: trainerA.id, entityType: 'TRAINER' },
      }),
    ).toBe(1);
    await expect(integration.safePayload('TRAINER', trainerA.id)).resolves.toMatchObject({
      activeGroupIds: [],
      directions: [],
    });

    await database.danceGroup.update({
      data: { archivedAt: null, status: 'ACTIVE' },
      where: { id: group.id },
    });
    await database.syncOutbox.deleteMany();
    await database.danceGroup.update({
      data: { coachId: trainerB.id },
      where: { id: group.id },
    });
    const reassignment = await database.syncOutbox.findMany({
      orderBy: { entityId: 'asc' },
      where: { entityId: { in: [trainerA.id, trainerB.id] }, entityType: 'TRAINER' },
    });
    expect(reassignment.map(({ entityId }) => entityId)).toEqual([trainerA.id, trainerB.id].sort());

    await database.syncOutbox.deleteMany();
    const deactivated = await application.updateUser(ownerToken, trainerB.id, {
      branchIds: [branch.id],
      fullName: trainerB.fullName,
      isActive: false,
      role: 'COACH',
    });
    expect(deactivated.id).toBe(trainerB.id);
    await expect(integration.safePayload('TRAINER', trainerB.id)).resolves.toMatchObject({
      id: trainerB.id,
      isActive: false,
    });
    const reactivated = await application.updateUser(ownerToken, trainerB.id, {
      branchIds: [branch.id],
      fullName: trainerB.fullName,
      isActive: true,
      role: 'COACH',
    });
    expect(reactivated.id).toBe(trainerB.id);
    expect(await database.danceGroup.findUniqueOrThrow({ where: { id: group.id } })).toMatchObject({
      coachId: trainerB.id,
    });
  });

  it('allows ADMIN to observe sync health but keeps configuration OWNER-only and denies COACH', async () => {
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
      if (role === 'ADMIN') {
        await expect(integration.getStatus(session.token)).resolves.toMatchObject({
          failedItems: [],
          processingCount: 0,
        });
      } else {
        await expect(integration.getStatus(session.token)).rejects.toThrow(
          'владельцу и администратору',
        );
      }
      await expect(
        integration.updateSettings(session.token, { baseUrl: serverUrl, enabled: true }),
      ).rejects.toThrow('только владелец');
    }
  });
});

describe('chat image integration transport', () => {
  it('parses supported attachments and downloads them through authenticated device transport', async () => {
    const calls: { headers: Headers; path: string }[] = [];
    const client = new IntegrationApiClient((input, init) => {
      const url = new URL(input);
      calls.push({ headers: new Headers(init.headers), path: url.pathname });
      if (url.pathname.endsWith('/messages')) {
        return Promise.resolve(
          Response.json({
            conversation: {
              branchId: null,
              crmGroupId: null,
              id: 'chat-one',
              lastMessage: 'Фото',
              lastMessageAt: '2026-08-24T12:00:00.000Z',
              linkedStudents: [],
              subtitle: '',
              title: 'Клиент',
              type: 'PRIVATE_ADMIN',
              unreadCount: 1,
              updatedAt: '2026-08-24T12:00:00.000Z',
            },
            hasMore: false,
            messages: [
              {
                attachments: [
                  {
                    height: 480,
                    id: 'image-one',
                    mimeType: 'image/png',
                    originalName: 'photo.png',
                    type: 'image',
                    width: 640,
                  },
                  {
                    height: 256,
                    id: 'sticker-one',
                    mimeType: 'image/webp',
                    type: 'sticker',
                    width: 256,
                  },
                  { id: 'video-one', mimeType: 'video/webm', type: 'video' },
                ],
                body: '',
                createdAt: '2026-08-24T12:00:00.000Z',
                id: 'message-one',
                senderName: 'Клиент',
                senderRole: 'CLIENT',
                senderType: 'client',
              },
            ],
            nextCursor: null,
          }),
        );
      }
      return Promise.resolve(
        new Response(Uint8Array.from([1, 2, 3]), {
          headers: { 'Content-Length': '3', 'Content-Type': 'image/png' },
        }),
      );
    });
    const context = { branchIds: [], name: 'Владелец', role: 'OWNER' as const, userId: 'owner' };

    const messages = await client.chatMessages(
      'https://crm.example.test',
      'device-one',
      'secret-device-token',
      context,
      'chat-one',
    );
    expect(messages.messages[0]?.attachments).toEqual([
      {
        height: 480,
        id: 'image-one',
        kind: 'IMAGE',
        mimeType: 'image/png',
        originalName: 'photo.png',
        width: 640,
      },
      {
        height: 256,
        id: 'sticker-one',
        kind: 'STICKER',
        mimeType: 'image/webp',
        width: 256,
      },
    ]);

    const image = await client.chatImage(
      'https://crm.example.test',
      'device-one',
      'secret-device-token',
      context,
      'chat-one',
      'image-one',
    );
    expect(image).toEqual({ attachmentId: 'image-one', dataUrl: 'data:image/png;base64,AQID' });
    expect(calls[1]).toMatchObject({
      path: '/api/integration/v1/chats/chat-one/attachments/image-one',
    });
    expect(calls[1]?.headers.get('authorization')).toBe('Bearer secret-device-token');
    expect(JSON.stringify(image)).not.toContain('secret-device-token');
  });
});
