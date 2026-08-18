import type {
  IntegrationInitialSyncPreview,
  IntegrationLogEntry,
  IntegrationPairInput,
  IntegrationSettingsInput,
  IntegrationStatus,
} from '@arava/shared';
import type { SyncOperation } from '@prisma/client';

import type { DatabaseClient } from './index';
import { DomainError } from './security';
import type { ApplicationService } from './services';

export const INTEGRATION_API_VERSION = 'v1';
export const INTEGRATION_BATCH_SIZE = 25;
export const INITIAL_SYNC_HISTORY_DAYS = 30;
export const INITIAL_SYNC_FUTURE_DAYS = 180;
const REQUEST_TIMEOUT_MS = 10_000;
const STUCK_PROCESSING_MS = 10 * 60_000;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;

const SETTINGS = {
  baseUrl: 'integration.baseUrl',
  enabled: 'integration.enabled',
  lastError: 'integration.lastError',
  lastState: 'integration.lastState',
  lastSuccessfulSync: 'integration.lastSuccessfulSync',
} as const;

export type SyncEntityType =
  | 'BRANCH'
  | 'ROOM'
  | 'TRAINER'
  | 'GROUP'
  | 'STUDENT_IDENTITY'
  | 'GROUP_MEMBERSHIP'
  | 'SCHEDULE'
  | 'LESSON';

export interface IntegrationCredentialStore {
  clearToken(): Promise<void>;
  getDeviceId(): Promise<string>;
  getToken(): Promise<string | undefined>;
  saveToken(token: string): Promise<void>;
}

export interface IntegrationFetchResponse {
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
}

export type IntegrationFetch = (
  input: string,
  init: {
    body?: string;
    headers: Record<string, string>;
    method: string;
    signal: AbortSignal;
  },
) => Promise<IntegrationFetchResponse>;

export interface SyncEntityEnvelope {
  entityId: string;
  entityType: SyncEntityType;
  idempotencyKey: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  updatedAt: string;
  version: string;
}

interface ApiErrorBody {
  code?: string;
  message?: string;
}

interface BatchAcknowledgement {
  accepted: { entityId: string; idempotencyKey: string; version: string }[];
  apiVersion: string;
  deviceToken?: string;
  serverTimestamp: string;
}

class IntegrationApiError extends Error {
  constructor(
    readonly errorCode: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'IntegrationApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function validateIntegrationBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new DomainError('VALIDATION', 'Укажите корректный адрес API сайта.');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHosts.has(url.hostname))) {
    throw new DomainError(
      'VALIDATION',
      'Для интеграции разрешён только HTTPS. HTTP можно использовать только для localhost.',
    );
  }
  if (url.username || url.password) {
    throw new DomainError('VALIDATION', 'Адрес API не должен содержать логин или пароль.');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/u, '');
}

export class IntegrationApiClient {
  constructor(
    private readonly fetchImplementation: IntegrationFetch = globalThis.fetch,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  private endpoint(baseUrl: string, path: string): string {
    return `${validateIntegrationBaseUrl(baseUrl)}/api/integration/${INTEGRATION_API_VERSION}/${path}`;
  }

  private async request(
    baseUrl: string,
    path: string,
    deviceId: string,
    token: string | undefined,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-ARAVA-API-Version': INTEGRATION_API_VERSION,
      'X-ARAVA-Device-ID': deviceId,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await this.fetchImplementation(this.endpoint(baseUrl, path), {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers,
        method,
        signal: controller.signal,
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер вернул неверный ответ.');
      }
      if (!response.ok) {
        const bodyRecord: ApiErrorBody = isRecord(payload) ? payload : {};
        const code = optionalString(bodyRecord.code) ?? `HTTP_${String(response.status)}`;
        const retryable = response.status === 429 || response.status >= 500;
        throw new IntegrationApiError(
          code,
          retryable,
          optionalString(bodyRecord.message) ?? 'Сервер отклонил запрос синхронизации.',
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof IntegrationApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new IntegrationApiError('TIMEOUT', true, 'Сервер не ответил вовремя.');
      }
      throw new IntegrationApiError('NETWORK_UNAVAILABLE', true, 'Нет соединения с сайтом.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async pair(baseUrl: string, deviceId: string, pairingCode: string): Promise<string> {
    const payload = await this.request(baseUrl, 'pair', deviceId, undefined, 'POST', {
      apiVersion: INTEGRATION_API_VERSION,
      deviceId,
      pairingCode,
    });
    if (!isRecord(payload) || payload.apiVersion !== INTEGRATION_API_VERSION) {
      throw new IntegrationApiError(
        'VERSION_UNSUPPORTED',
        false,
        'Версия API сайта не поддерживается.',
      );
    }
    const token = optionalString(payload.deviceToken);
    if (!token)
      throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер не выдал ключ устройства.');
    return token;
  }

  async health(baseUrl: string, deviceId: string, token: string): Promise<string | undefined> {
    const payload = await this.request(baseUrl, 'health', deviceId, token, 'GET');
    if (!isRecord(payload) || payload.apiVersion !== INTEGRATION_API_VERSION) {
      throw new IntegrationApiError(
        'VERSION_UNSUPPORTED',
        false,
        'Версия API сайта не поддерживается.',
      );
    }
    return optionalString(payload.deviceToken);
  }

  async syncBatch(
    baseUrl: string,
    deviceId: string,
    token: string,
    operations: SyncEntityEnvelope[],
  ): Promise<BatchAcknowledgement> {
    const payload = await this.request(baseUrl, 'sync/batch', deviceId, token, 'POST', {
      apiVersion: INTEGRATION_API_VERSION,
      deviceId,
      operations,
    });
    if (
      !isRecord(payload) ||
      payload.apiVersion !== INTEGRATION_API_VERSION ||
      !Array.isArray(payload.accepted)
    ) {
      throw new IntegrationApiError(
        'INVALID_RESPONSE',
        false,
        'Сервер не подтвердил синхронизацию.',
      );
    }
    const accepted = payload.accepted.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const entityId = optionalString(entry.entityId);
      const idempotencyKey = optionalString(entry.idempotencyKey);
      const version = optionalString(entry.version);
      return entityId && idempotencyKey && version ? [{ entityId, idempotencyKey, version }] : [];
    });
    const serverTimestamp = optionalString(payload.serverTimestamp);
    if (accepted.length !== operations.length || !serverTimestamp) {
      throw new IntegrationApiError(
        'INVALID_RESPONSE',
        false,
        'Сервер подтвердил не все операции.',
      );
    }
    const rotatedToken = optionalString(payload.deviceToken);
    return {
      accepted,
      apiVersion: INTEGRATION_API_VERSION,
      ...(rotatedToken ? { deviceToken: rotatedToken } : {}),
      serverTimestamp,
    };
  }
}

function iso(value: Date | null | undefined): string | undefined {
  return value?.toISOString();
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

const ENTITY_PRIORITY: Record<SyncEntityType, number> = {
  BRANCH: 10,
  ROOM: 20,
  TRAINER: 30,
  GROUP: 40,
  STUDENT_IDENTITY: 50,
  SCHEDULE: 60,
  LESSON: 70,
  GROUP_MEMBERSHIP: 80,
};

export class IntegrationService {
  private processing = false;

  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
    private readonly credentials: IntegrationCredentialStore,
    private readonly api = new IntegrationApiClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async assertOwner(token: string): Promise<void> {
    const actor = await this.application.authenticate(token);
    if (actor.role !== 'OWNER') {
      throw new DomainError('AUTHORIZATION', 'Настраивать интеграцию может только владелец.');
    }
  }

  private async setting(key: string): Promise<string | undefined> {
    return (await this.database.appSetting.findUnique({ where: { key } }))?.value;
  }

  private async setSetting(key: string, value: string): Promise<void> {
    await this.database.appSetting.upsert({
      create: { key, value },
      update: { value },
      where: { key },
    });
  }

  async initialize(): Promise<void> {
    const staleBefore = new Date(this.now().getTime() - STUCK_PROCESSING_MS);
    await this.database.syncOutbox.updateMany({
      data: { nextAttemptAt: this.now(), status: 'PENDING' },
      where: { lastAttemptAt: { lte: staleBefore }, status: 'PROCESSING' },
    });
  }

  async getStatus(token: string): Promise<IntegrationStatus> {
    await this.assertOwner(token);
    return this.systemStatus();
  }

  async systemStatus(): Promise<IntegrationStatus> {
    const [
      deviceId,
      token,
      enabledValue,
      baseUrl,
      counts,
      lastSuccessfulSync,
      lastState,
      lastError,
    ] = await Promise.all([
      this.credentials.getDeviceId(),
      this.credentials.getToken(),
      this.setting(SETTINGS.enabled),
      this.setting(SETTINGS.baseUrl),
      this.database.syncOutbox.groupBy({
        _count: true,
        by: ['status'],
        where: { status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
      }),
      this.setting(SETTINGS.lastSuccessfulSync),
      this.setting(SETTINGS.lastState),
      this.setting(SETTINGS.lastError),
    ]);
    const count = (status: 'PENDING' | 'PROCESSING' | 'FAILED') =>
      counts.find((entry) => entry.status === status)?._count ?? 0;
    const pendingCount = count('PENDING') + count('PROCESSING');
    const failedCount = count('FAILED');
    const enabled = enabledValue === 'true';
    let connectionState: IntegrationStatus['connectionState'];
    if (!enabled) connectionState = 'DISABLED';
    else if (lastState === 'AUTH_ERROR') connectionState = 'AUTH_ERROR';
    else if (lastState === 'VERSION_UNSUPPORTED') connectionState = 'VERSION_UNSUPPORTED';
    else if (!token) connectionState = 'NOT_PAIRED';
    else if (lastState === 'OFFLINE') connectionState = 'OFFLINE';
    else if (pendingCount > 0 || failedCount > 0) connectionState = 'PENDING_CHANGES';
    else connectionState = 'CONNECTED';
    return {
      baseUrl: baseUrl ?? '',
      connectionState,
      deviceId,
      enabled,
      failedCount,
      isPaired: Boolean(token),
      ...(lastError ? { lastError } : {}),
      ...(lastSuccessfulSync ? { lastSuccessfulSync } : {}),
      pendingCount,
      syncInProgress: this.processing,
    };
  }

  async updateSettings(token: string, input: IntegrationSettingsInput): Promise<IntegrationStatus> {
    await this.assertOwner(token);
    const baseUrl = input.baseUrl ? validateIntegrationBaseUrl(input.baseUrl) : '';
    if (input.enabled && !baseUrl) {
      throw new DomainError('VALIDATION', 'Укажите адрес API сайта.');
    }
    await this.database.$transaction([
      this.database.appSetting.upsert({
        create: { key: SETTINGS.baseUrl, value: baseUrl },
        update: { value: baseUrl },
        where: { key: SETTINGS.baseUrl },
      }),
      this.database.appSetting.upsert({
        create: { key: SETTINGS.enabled, value: String(input.enabled) },
        update: { value: String(input.enabled) },
        where: { key: SETTINGS.enabled },
      }),
    ]);
    return this.systemStatus();
  }

  async pair(token: string, input: IntegrationPairInput): Promise<IntegrationStatus> {
    await this.assertOwner(token);
    const baseUrl = validateIntegrationBaseUrl(input.baseUrl);
    const pairingCode = input.pairingCode.trim();
    if (pairingCode.length < 6 || pairingCode.length > 128) {
      throw new DomainError('VALIDATION', 'Введите действующий код подключения.');
    }
    const deviceId = await this.credentials.getDeviceId();
    try {
      const deviceToken = await this.api.pair(baseUrl, deviceId, pairingCode);
      await this.credentials.saveToken(deviceToken);
      await this.database.$transaction([
        this.database.appSetting.upsert({
          create: { key: SETTINGS.baseUrl, value: baseUrl },
          update: { value: baseUrl },
          where: { key: SETTINGS.baseUrl },
        }),
        this.database.appSetting.upsert({
          create: { key: SETTINGS.enabled, value: String(input.enabled) },
          update: { value: String(input.enabled) },
          where: { key: SETTINGS.enabled },
        }),
        this.database.appSetting.upsert({
          create: { key: SETTINGS.lastState, value: 'CONNECTED' },
          update: { value: 'CONNECTED' },
          where: { key: SETTINGS.lastState },
        }),
        this.database.appSetting.deleteMany({ where: { key: SETTINGS.lastError } }),
      ]);
      await this.log(undefined, 'PAIR', 'SUCCESS', 1, undefined, 'Устройство подключено.');
      return await this.systemStatus();
    } catch (error) {
      await this.recordConnectionError(error);
      throw error;
    }
  }

  async testConnection(token: string): Promise<IntegrationStatus> {
    await this.assertOwner(token);
    await this.healthCheck();
    return this.systemStatus();
  }

  async healthCheck(): Promise<void> {
    const [baseUrl, deviceId, token] = await Promise.all([
      this.setting(SETTINGS.baseUrl),
      this.credentials.getDeviceId(),
      this.credentials.getToken(),
    ]);
    if (!baseUrl || !token)
      throw new DomainError('VALIDATION', 'Сначала подключите устройство к сайту.');
    try {
      const rotatedToken = await this.api.health(baseUrl, deviceId, token);
      if (rotatedToken) await this.credentials.saveToken(rotatedToken);
      await Promise.all([
        this.setSetting(SETTINGS.lastState, 'CONNECTED'),
        this.setSetting(SETTINGS.lastError, ''),
      ]);
      await this.log(undefined, 'HEALTH', 'SUCCESS', 1, undefined, 'Соединение установлено.');
    } catch (error) {
      await this.recordConnectionError(error);
      throw error;
    }
  }

  async listLog(token: string): Promise<IntegrationLogEntry[]> {
    await this.assertOwner(token);
    const entries = await this.database.syncLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return entries.map((entry) => ({
      attemptCount: entry.attemptCount,
      createdAt: entry.createdAt.toISOString(),
      ...(entry.entityId ? { entityId: entry.entityId } : {}),
      ...(entry.entityType ? { entityType: entry.entityType } : {}),
      ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
      id: entry.id,
      ...(entry.message ? { message: entry.message } : {}),
      ...(entry.operation ? { operation: entry.operation } : {}),
      result: entry.result,
    }));
  }

  private initialWindow(): { end: Date; start: Date } {
    const now = this.now();
    return {
      end: addDays(now, INITIAL_SYNC_FUTURE_DAYS),
      start: addDays(now, -INITIAL_SYNC_HISTORY_DAYS),
    };
  }

  async prepareInitialSync(token: string): Promise<IntegrationInitialSyncPreview> {
    await this.assertOwner(token);
    return this.initialSyncPreview();
  }

  async initialSyncPreview(): Promise<IntegrationInitialSyncPreview> {
    const { end, start } = this.initialWindow();
    const [branches, rooms, trainers, groups, students, memberships, lessons] = await Promise.all([
      this.database.branch.count(),
      this.database.room.count(),
      this.database.user.count({ where: { role: 'COACH' } }),
      this.database.danceGroup.count(),
      this.database.student.count(),
      this.database.enrollment.count(),
      this.database.lesson.count({ where: { startsAt: { gte: start, lte: end } } }),
    ]);
    return {
      branches,
      groups,
      lessons,
      memberships,
      rooms,
      students,
      trainers,
      windowEndsAt: end.toISOString(),
      windowStartsAt: start.toISOString(),
    };
  }

  async confirmInitialSync(token: string): Promise<IntegrationStatus> {
    await this.assertOwner(token);
    await this.queueInitialSync();
    await this.processPending();
    return this.systemStatus();
  }

  async queueInitialSync(): Promise<void> {
    const { end, start } = this.initialWindow();
    const [branches, rooms, trainers, groups, students, memberships, schedules, lessons] =
      await Promise.all([
        this.database.branch.findMany({ select: { id: true } }),
        this.database.room.findMany({ select: { id: true } }),
        this.database.user.findMany({ select: { id: true }, where: { role: 'COACH' } }),
        this.database.danceGroup.findMany({ select: { id: true } }),
        this.database.student.findMany({ select: { id: true } }),
        this.database.enrollment.findMany({ select: { id: true } }),
        this.database.weeklySchedule.findMany({ select: { id: true } }),
        this.database.lesson.findMany({
          select: { id: true },
          where: { startsAt: { gte: start, lte: end } },
        }),
      ]);
    const rows: { entityId: string; entityType: SyncEntityType }[] = [
      ...branches.map(({ id }) => ({ entityId: id, entityType: 'BRANCH' as const })),
      ...rooms.map(({ id }) => ({ entityId: id, entityType: 'ROOM' as const })),
      ...trainers.map(({ id }) => ({ entityId: id, entityType: 'TRAINER' as const })),
      ...groups.map(({ id }) => ({ entityId: id, entityType: 'GROUP' as const })),
      ...students.map(({ id }) => ({ entityId: id, entityType: 'STUDENT_IDENTITY' as const })),
      ...schedules.map(({ id }) => ({ entityId: id, entityType: 'SCHEDULE' as const })),
      ...lessons.map(({ id }) => ({ entityId: id, entityType: 'LESSON' as const })),
      ...memberships.map(({ id }) => ({ entityId: id, entityType: 'GROUP_MEMBERSHIP' as const })),
    ];
    const timestamp = this.now().toISOString();
    await this.database.syncOutbox.createMany({
      data: rows.map((row, index) => ({
        ...row,
        idempotencyKey: `initial:${timestamp}:${String(index)}:${row.entityType}:${row.entityId}`,
        nextAttemptAt: this.now(),
        payloadJson: '{}',
        updatedAt: this.now(),
      })),
    });
    await this.log(
      undefined,
      'INITIAL_SYNC',
      'QUEUED',
      0,
      undefined,
      `Подготовлено операций: ${String(rows.length)}.`,
    );
  }

  async syncNow(token: string): Promise<IntegrationStatus> {
    await this.assertOwner(token);
    await this.database.syncOutbox.updateMany({
      data: { nextAttemptAt: this.now(), status: 'PENDING' },
      where: {
        OR: [
          { status: 'PENDING' },
          {
            status: 'FAILED',
            lastErrorCode: {
              in: [
                'TIMEOUT',
                'NETWORK_UNAVAILABLE',
                'RATE_LIMITED',
                'TEMPORARY_ERROR',
                'HTTP_429',
                'HTTP_500',
                'HTTP_502',
                'HTTP_503',
                'HTTP_504',
              ],
            },
          },
        ],
      },
    });
    await this.processPending();
    return this.systemStatus();
  }

  async processPending(): Promise<void> {
    if (this.processing) return;
    const [enabled, baseUrl, deviceId, token] = await Promise.all([
      this.setting(SETTINGS.enabled),
      this.setting(SETTINGS.baseUrl),
      this.credentials.getDeviceId(),
      this.credentials.getToken(),
    ]);
    if (enabled !== 'true' || !baseUrl || !token) return;
    this.processing = true;
    try {
      const candidates = await this.database.syncOutbox.findMany({
        orderBy: { createdAt: 'asc' },
        take: INTEGRATION_BATCH_SIZE * 4,
        where: { status: 'PENDING' },
      });
      const selected = candidates
        .filter(({ nextAttemptAt }) => nextAttemptAt <= this.now())
        .sort(
          (left, right) =>
            ENTITY_PRIORITY[left.entityType as SyncEntityType] -
              ENTITY_PRIORITY[right.entityType as SyncEntityType] ||
            left.createdAt.getTime() - right.createdAt.getTime(),
        )
        .slice(0, INTEGRATION_BATCH_SIZE);
      if (selected.length === 0) return;
      const ids = selected.map(({ id }) => id);
      const claimed = await this.database.syncOutbox.updateMany({
        data: { lastAttemptAt: this.now(), status: 'PROCESSING' },
        where: { id: { in: ids }, status: 'PENDING' },
      });
      if (claimed.count !== selected.length) return;
      const envelopes: SyncEntityEnvelope[] = [];
      for (const item of selected) {
        const envelope = await this.buildEnvelope(
          item.entityType as SyncEntityType,
          item.entityId,
          item.operation,
          item.idempotencyKey,
        );
        envelopes.push(envelope);
        await this.database.syncOutbox.update({
          data: { payloadJson: JSON.stringify(envelope.payload) },
          where: { id: item.id },
        });
      }
      try {
        const acknowledgement = await this.api.syncBatch(baseUrl, deviceId, token, envelopes);
        if (acknowledgement.deviceToken)
          await this.credentials.saveToken(acknowledgement.deviceToken);
        const syncedAt = new Date(acknowledgement.serverTimestamp);
        await this.database.$transaction([
          this.database.syncOutbox.updateMany({
            data: { lastErrorCode: null, status: 'SYNCED', syncedAt },
            where: { id: { in: ids }, status: 'PROCESSING' },
          }),
          this.database.appSetting.upsert({
            create: { key: SETTINGS.lastSuccessfulSync, value: syncedAt.toISOString() },
            update: { value: syncedAt.toISOString() },
            where: { key: SETTINGS.lastSuccessfulSync },
          }),
          this.database.appSetting.upsert({
            create: { key: SETTINGS.lastState, value: 'CONNECTED' },
            update: { value: 'CONNECTED' },
            where: { key: SETTINGS.lastState },
          }),
        ]);
        for (const item of selected) {
          await this.log(item, item.operation, 'SYNCED', item.attemptCount + 1);
        }
      } catch (error) {
        await this.failBatch(selected, error);
      }
    } finally {
      this.processing = false;
    }
  }

  private async failBatch(
    items: {
      attemptCount: number;
      entityId: string;
      entityType: string;
      id: string;
      operation: SyncOperation;
    }[],
    error: unknown,
  ): Promise<void> {
    const apiError =
      error instanceof IntegrationApiError
        ? error
        : new IntegrationApiError('TEMPORARY_ERROR', true, 'Синхронизация временно недоступна.');
    const revoked =
      apiError.errorCode === 'DEVICE_REVOKED' || apiError.errorCode === 'AUTH_REQUIRED';
    if (revoked) await this.credentials.clearToken();
    const permanent = revoked || !apiError.retryable;
    for (const item of items) {
      const attemptCount = item.attemptCount + 1;
      const retryDelay =
        RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)] ??
        RETRY_DELAYS_MS.at(-1) ??
        60_000;
      await this.database.syncOutbox.update({
        data: {
          attemptCount,
          lastErrorCode: apiError.errorCode,
          nextAttemptAt: new Date(this.now().getTime() + retryDelay),
          status: permanent ? 'FAILED' : 'PENDING',
        },
        where: { id: item.id },
      });
      await this.log(
        item,
        item.operation,
        permanent ? 'FAILED' : 'RETRY',
        attemptCount,
        apiError.errorCode,
        apiError.message,
      );
    }
    await this.recordConnectionError(apiError);
  }

  private async recordConnectionError(error: unknown): Promise<void> {
    const apiError =
      error instanceof IntegrationApiError
        ? error
        : new IntegrationApiError('NETWORK_UNAVAILABLE', true, 'Нет соединения с сайтом.');
    const state =
      apiError.errorCode === 'DEVICE_REVOKED' || apiError.errorCode === 'AUTH_REQUIRED'
        ? 'AUTH_ERROR'
        : apiError.errorCode === 'VERSION_UNSUPPORTED'
          ? 'VERSION_UNSUPPORTED'
          : 'OFFLINE';
    await Promise.all([
      this.setSetting(SETTINGS.lastState, state),
      this.setSetting(SETTINGS.lastError, apiError.message.slice(0, 300)),
    ]);
  }

  private async log(
    item: { entityId: string; entityType: string; id: string } | undefined,
    operation: string,
    result: string,
    attemptCount: number,
    errorCode?: string,
    message?: string,
  ): Promise<void> {
    await this.database.syncLog.create({
      data: {
        attemptCount,
        ...(item
          ? { entityId: item.entityId, entityType: item.entityType, outboxId: item.id }
          : {}),
        ...(errorCode ? { errorCode } : {}),
        ...(message ? { message: message.slice(0, 300) } : {}),
        operation,
        result,
      },
    });
  }

  private async buildEnvelope(
    entityType: SyncEntityType,
    entityId: string,
    operation: SyncOperation,
    idempotencyKey: string,
  ): Promise<SyncEntityEnvelope> {
    const payload = await this.safePayload(entityType, entityId);
    const updatedAt = optionalString(payload.updatedAt) ?? this.now().toISOString();
    return {
      entityId,
      entityType,
      idempotencyKey,
      operation: payload.missing === true ? 'ARCHIVE' : operation,
      payload,
      updatedAt,
      version: updatedAt,
    };
  }

  async safePayload(
    entityType: SyncEntityType,
    entityId: string,
  ): Promise<Record<string, unknown>> {
    switch (entityType) {
      case 'BRANCH': {
        const row = await this.database.branch.findUnique({ where: { id: entityId } });
        return row
          ? {
              archivedAt: iso(row.archivedAt),
              id: row.id,
              isActive: row.isActive,
              name: row.name,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'ROOM': {
        const row = await this.database.room.findUnique({ where: { id: entityId } });
        return row
          ? {
              branchId: row.branchId,
              capacity: row.capacity,
              id: row.id,
              isActive: row.isActive,
              name: row.name,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'TRAINER': {
        const row = await this.database.user.findUnique({
          include: {
            coachedGroups: { select: { direction: true, id: true }, where: { archivedAt: null } },
          },
          where: { id: entityId },
        });
        return row
          ? {
              activeGroupIds: row.coachedGroups.map(({ id }) => id),
              directions: [...new Set(row.coachedGroups.map(({ direction }) => direction))],
              displayName: row.fullName,
              id: row.id,
              isActive: row.isActive && row.role === 'COACH',
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'GROUP': {
        const row = await this.database.danceGroup.findUnique({ where: { id: entityId } });
        return row
          ? {
              ageFrom: row.ageFrom,
              ageTo: row.ageTo,
              assistantCoachId: row.assistantCoachId,
              branchId: row.branchId,
              coachId: row.coachId,
              color: row.color,
              direction: row.direction,
              id: row.id,
              name: row.name,
              status: row.status,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'STUDENT_IDENTITY': {
        const row = await this.database.student.findUnique({
          include: {
            enrollments: {
              select: { groupId: true },
              where: { leftAt: null, status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] } },
            },
          },
          where: { id: entityId },
        });
        return row
          ? {
              activeGroupIds: row.enrollments.map(({ groupId }) => groupId),
              branchId: row.branchId,
              firstName: row.firstName,
              id: row.id,
              lastName: row.lastName,
              status: row.status,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'GROUP_MEMBERSHIP': {
        const row = await this.database.enrollment.findUnique({ where: { id: entityId } });
        return row
          ? {
              active: row.leftAt === null && ['ACTIVE', 'TRIAL', 'FROZEN'].includes(row.status),
              groupId: row.groupId,
              id: row.id,
              joinedAt: row.joinedAt.toISOString(),
              leftAt: iso(row.leftAt),
              status: row.status,
              studentId: row.studentId,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'SCHEDULE': {
        const row = await this.database.weeklySchedule.findUnique({ where: { id: entityId } });
        return row
          ? {
              branchId: row.branchId,
              coachId: row.coachId,
              endTime: row.endTime,
              groupId: row.groupId,
              id: row.id,
              isActive: row.isActive,
              roomId: row.roomId,
              startTime: row.startTime,
              updatedAt: row.updatedAt.toISOString(),
              validFrom: row.validFrom.toISOString(),
              validTo: iso(row.validTo),
              weekday: row.weekday,
            }
          : { id: entityId, missing: true };
      }
      case 'LESSON': {
        const row = await this.database.lesson.findUnique({ where: { id: entityId } });
        return row
          ? {
              branchId: row.branchId,
              coachId: row.coachId,
              endsAt: row.endsAt.toISOString(),
              groupId: row.groupId,
              id: row.id,
              roomId: row.roomId,
              startsAt: row.startsAt.toISOString(),
              status: row.status,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
    }
  }
}
