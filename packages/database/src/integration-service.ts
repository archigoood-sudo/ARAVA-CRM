import type {
  ChatListQuery,
  ChatListResult,
  ChatMessagePage,
  ChatSendInput,
  ChatSummary,
  IntegrationInitialSyncPreview,
  IntegrationDeviceSummary,
  IntegrationLogEntry,
  IntegrationPairInput,
  IntegrationDeviceRenameInput,
  IntegrationSettingsInput,
  IntegrationStatus,
} from '@arava/shared';
import type { Gender, SyncOperation } from '@prisma/client';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';

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
  lastInboundSync: 'integration.lastInboundSync',
  lastOutboundSync: 'integration.lastOutboundSync',
  inboundCursor: 'integration.inboundCursor',
} as const;

export type SyncEntityType =
  | 'BRANCH'
  | 'ROOM'
  | 'TRAINER'
  | 'GROUP'
  | 'STUDENT_IDENTITY'
  | 'STUDENT_CONTACT'
  | 'GROUP_MEMBERSHIP'
  | 'SCHEDULE'
  | 'LESSON'
  | 'SUBSTITUTION'
  | 'CARD'
  | 'TARIFF'
  | 'SUBSCRIPTION'
  | 'SUBSCRIPTION_LEDGER'
  | 'ATTENDANCE'
  | 'STUDENT_NOTE'
  | 'PUBLICATION'
  | 'CHAT_MESSAGE';

export interface CrmChatRequestContext {
  branchIds: string[];
  name: string;
  role: 'OWNER' | 'ADMIN' | 'COACH';
  userId: string;
}

function sanitizeDisplayName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new DomainError('VALIDATION', 'Укажите имя устройства.');
  if (trimmed.length > 64)
    throw new DomainError('VALIDATION', 'Имя устройства не может быть длиннее 64 символов.');
  if (/[<>]/u.test(trimmed) || /[\r\n\t]/u.test(trimmed)) {
    throw new DomainError('VALIDATION', 'Имя устройства должно быть обычным текстом.');
  }
  const containsControlCharacter = (() => {
    for (const character of trimmed) {
      const code = character.codePointAt(0);
      if (code !== undefined && (code < 0x20 || code === 0x7f)) return true;
    }
    return false;
  })();
  if (containsControlCharacter) {
    throw new DomainError('VALIDATION', 'Имя устройства должно быть обычным текстом.');
  }
  return trimmed;
}

function initialDisplayNameFromHost(): string {
  const currentHost = hostname().trim();
  return currentHost || 'Устройство CRM';
}

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
  baseRevision: number;
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
  accepted: SyncAcknowledgement[];
  apiVersion: string;
  deviceToken?: string;
  serverTimestamp: string;
}

interface SyncAcknowledgement {
  canonicalOperation: 'UPSERT' | 'ARCHIVE';
  canonicalPayload: Record<string, unknown>;
  conflictId?: string;
  entityId: string;
  idempotencyKey: string;
  revision: number;
  serverSequence: number;
  status: 'ACCEPTED' | 'CONFLICT';
  version: string;
}

interface InboundChange {
  entityId: string;
  entityType: Exclude<SyncEntityType, 'CHAT_MESSAGE'>;
  operation: 'UPSERT' | 'ARCHIVE';
  payload: Record<string, unknown>;
  revision: number;
  sequence: number;
  serverUpdatedAt: string;
  sourceDeviceId: string;
}

interface InboundPage {
  canonicalCount: number;
  changes: InboundChange[];
  cursor: number;
  hasMore: boolean;
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

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = optionalString(payload[key]);
  if (!value)
    throw new IntegrationApiError('INVALID_RESPONSE', false, 'Изменение сервера повреждено.');
  return value;
}

function optionalDate(value: unknown): Date | null {
  return typeof value === 'string' && value.length > 0 ? new Date(value) : null;
}

function requiredDate(payload: Record<string, unknown>, key: string): Date {
  const value = optionalDate(payload[key]);
  if (!value || Number.isNaN(value.getTime()))
    throw new IntegrationApiError('INVALID_RESPONSE', false, 'Дата изменения сервера повреждена.');
  return value;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

const INBOUND_ENTITY_TYPES = new Set<InboundChange['entityType']>([
  'BRANCH',
  'ROOM',
  'TRAINER',
  'GROUP',
  'STUDENT_IDENTITY',
  'STUDENT_CONTACT',
  'GROUP_MEMBERSHIP',
  'SCHEDULE',
  'LESSON',
  'SUBSTITUTION',
  'CARD',
  'TARIFF',
  'SUBSCRIPTION',
  'SUBSCRIPTION_LEDGER',
  'ATTENDANCE',
  'STUDENT_NOTE',
  'PUBLICATION',
]);

function parseInboundChange(value: unknown): InboundChange {
  if (
    !isRecord(value) ||
    typeof value.entityId !== 'string' ||
    typeof value.entityType !== 'string' ||
    !INBOUND_ENTITY_TYPES.has(value.entityType as InboundChange['entityType']) ||
    (value.operation !== 'UPSERT' && value.operation !== 'ARCHIVE') ||
    !isRecord(value.payload) ||
    typeof value.revision !== 'number' ||
    typeof value.sequence !== 'number' ||
    typeof value.serverUpdatedAt !== 'string' ||
    typeof value.sourceDeviceId !== 'string'
  )
    throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер вернул неверное изменение.');
  return {
    entityId: value.entityId,
    entityType: value.entityType as InboundChange['entityType'],
    operation: value.operation,
    payload: value.payload,
    revision: value.revision,
    sequence: value.sequence,
    serverUpdatedAt: value.serverUpdatedAt,
    sourceDeviceId: value.sourceDeviceId,
  };
}

function invalidChatResponse(): never {
  throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер вернул неверные данные чата.');
}

function parseChatSummary(value: unknown): ChatSummary {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    (value.type !== 'PRIVATE_ADMIN' && value.type !== 'GROUP') ||
    typeof value.title !== 'string' ||
    typeof value.subtitle !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    typeof value.unreadCount !== 'number' ||
    !Array.isArray(value.linkedStudents)
  ) {
    return invalidChatResponse();
  }
  const linkedStudents = value.linkedStudents.map((student) => {
    if (
      !isRecord(student) ||
      typeof student.studentId !== 'string' ||
      typeof student.branchId !== 'string' ||
      typeof student.firstName !== 'string' ||
      typeof student.lastName !== 'string'
    ) {
      return invalidChatResponse();
    }
    return {
      branchId: student.branchId,
      firstName: student.firstName,
      lastName: student.lastName,
      studentId: student.studentId,
    };
  });
  return {
    branchId: typeof value.branchId === 'string' ? value.branchId : null,
    crmGroupId: typeof value.crmGroupId === 'string' ? value.crmGroupId : null,
    id: value.id,
    lastMessage: typeof value.lastMessage === 'string' ? value.lastMessage : null,
    lastMessageAt: typeof value.lastMessageAt === 'string' ? value.lastMessageAt : null,
    linkedStudents,
    subtitle: value.subtitle,
    title: value.title,
    type: value.type,
    unreadCount: value.unreadCount,
    updatedAt: value.updatedAt,
  };
}

function parseChatMessagePage(value: unknown): ChatMessagePage {
  if (!isRecord(value) || !Array.isArray(value.messages) || typeof value.hasMore !== 'boolean') {
    return invalidChatResponse();
  }
  const messages = value.messages.map((message) => {
    if (
      !isRecord(message) ||
      typeof message.id !== 'string' ||
      typeof message.body !== 'string' ||
      typeof message.createdAt !== 'string' ||
      typeof message.senderName !== 'string' ||
      typeof message.senderRole !== 'string' ||
      typeof message.senderType !== 'string'
    ) {
      return invalidChatResponse();
    }
    return {
      body: message.body,
      createdAt: message.createdAt,
      id: message.id,
      senderAccountId: typeof message.senderAccountId === 'string' ? message.senderAccountId : null,
      senderName: message.senderName,
      senderRole: message.senderRole,
      senderType: message.senderType,
      status: 'SENT' as const,
    };
  });
  return {
    conversation: parseChatSummary(value.conversation),
    hasMore: value.hasMore,
    messages,
    nextCursor: typeof value.nextCursor === 'string' ? value.nextCursor : null,
  };
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
    method: 'GET' | 'PATCH' | 'POST',
    body?: unknown,
    context?: CrmChatRequestContext,
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
    if (context) {
      headers['X-ARAVA-CRM-Context'] = Buffer.from(JSON.stringify(context), 'utf8').toString(
        'base64url',
      );
    }
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

  async pair(
    baseUrl: string,
    deviceId: string,
    pairingCode: string,
    displayName?: string,
  ): Promise<string> {
    const payload = await this.request(baseUrl, 'pair', deviceId, undefined, 'POST', {
      apiVersion: INTEGRATION_API_VERSION,
      deviceId,
      pairingCode,
      ...(displayName ? { displayName } : {}),
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
      if (
        !entityId ||
        !idempotencyKey ||
        !version ||
        !isRecord(entry.canonicalPayload) ||
        (entry.canonicalOperation !== 'UPSERT' && entry.canonicalOperation !== 'ARCHIVE') ||
        (entry.status !== 'ACCEPTED' && entry.status !== 'CONFLICT') ||
        typeof entry.revision !== 'number' ||
        typeof entry.serverSequence !== 'number'
      )
        return [];
      return [
        {
          canonicalOperation: entry.canonicalOperation,
          canonicalPayload: entry.canonicalPayload,
          ...(typeof entry.conflictId === 'string' ? { conflictId: entry.conflictId } : {}),
          entityId,
          idempotencyKey,
          revision: entry.revision,
          serverSequence: entry.serverSequence,
          status: entry.status,
          version,
        } satisfies SyncAcknowledgement,
      ];
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

  async fetchChanges(
    baseUrl: string,
    deviceId: string,
    token: string,
    input: { after: number; conflictCount: number; pendingCount: number },
  ): Promise<InboundPage> {
    const query = new URLSearchParams({
      after: String(input.after),
      conflictCount: String(input.conflictCount),
      deviceName: hostname(),
      limit: '100',
      pendingCount: String(input.pendingCount),
    });
    const payload = await this.request(
      baseUrl,
      `changes?${query.toString()}`,
      deviceId,
      token,
      'GET',
    );
    if (
      !isRecord(payload) ||
      payload.apiVersion !== INTEGRATION_API_VERSION ||
      !Array.isArray(payload.changes) ||
      typeof payload.cursor !== 'number' ||
      typeof payload.hasMore !== 'boolean' ||
      typeof payload.canonicalCount !== 'number'
    )
      throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер вернул неверный журнал.');
    const changes = payload.changes.map(parseInboundChange);
    return {
      canonicalCount: payload.canonicalCount,
      changes,
      cursor: payload.cursor,
      hasMore: payload.hasMore,
    };
  }

  async listDevices(
    baseUrl: string,
    deviceId: string,
    token: string,
  ): Promise<IntegrationDeviceSummary[]> {
    const payload = await this.request(baseUrl, 'devices', deviceId, token, 'GET');
    if (!isRecord(payload) || !Array.isArray(payload.devices)) return [];
    return payload.devices.flatMap((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.deviceId !== 'string' ||
        (entry.status !== 'ACTIVE' && entry.status !== 'REVOKED') ||
        typeof entry.pendingCount !== 'number' ||
        typeof entry.conflictCount !== 'number' ||
        typeof entry.lastInboundCursor !== 'number'
      )
        return [];
      return [
        {
          conflictCount: entry.conflictCount,
          deviceId: entry.deviceId,
          lastInboundCursor: entry.lastInboundCursor,
          ...(typeof entry.lastInboundSyncAt === 'string'
            ? { lastInboundSyncAt: entry.lastInboundSyncAt }
            : {}),
          ...(typeof entry.lastOutboundSyncAt === 'string'
            ? { lastOutboundSyncAt: entry.lastOutboundSyncAt }
            : {}),
          ...(typeof entry.lastSeenAt === 'string' ? { lastSeenAt: entry.lastSeenAt } : {}),
          ...(typeof entry.displayName === 'string' ? { displayName: entry.displayName } : {}),
          ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
          pendingCount: entry.pendingCount,
          status: entry.status,
        },
      ];
    });
  }

  async renameDevice(
    baseUrl: string,
    deviceId: string,
    token: string,
    input: Pick<IntegrationDeviceRenameInput, 'displayName'>,
  ): Promise<void> {
    await this.request(
      baseUrl,
      `devices/${encodeURIComponent(deviceId)}`,
      deviceId,
      token,
      'PATCH',
      input,
    );
  }

  async uploadPublicationMedia(
    baseUrl: string,
    deviceId: string,
    token: string,
    input: { bytes: Uint8Array; contentType: string; fileName: string; mediaId: string },
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await globalThis.fetch(this.endpoint(baseUrl, 'publications/media'), {
        body: Buffer.from(input.bytes),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': input.contentType,
          'X-ARAVA-API-Version': INTEGRATION_API_VERSION,
          'X-ARAVA-Device-ID': deviceId,
          'X-ARAVA-File-Name': encodeURIComponent(input.fileName),
          'X-ARAVA-Media-ID': input.mediaId,
        },
        method: 'POST',
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => undefined)) as unknown;
      if (!response.ok) {
        const body = isRecord(payload) ? payload : {};
        throw new IntegrationApiError(
          optionalString(body.code) ?? `HTTP_${String(response.status)}`,
          response.status === 429 || response.status >= 500,
          optionalString(body.message) ?? 'Сервер отклонил изображение публикации.',
        );
      }
      if (!isRecord(payload) || typeof payload.mediaRef !== 'string') {
        throw new IntegrationApiError(
          'INVALID_RESPONSE',
          false,
          'Сервер не подтвердил загрузку изображения.',
        );
      }
      return payload.mediaRef;
    } catch (error) {
      if (error instanceof IntegrationApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError')
        throw new IntegrationApiError('TIMEOUT', true, 'Сервер не ответил вовремя.');
      throw new IntegrationApiError('NETWORK_UNAVAILABLE', true, 'Нет соединения с сайтом.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async listChats(
    baseUrl: string,
    deviceId: string,
    token: string,
    context: CrmChatRequestContext,
    query: ChatListQuery,
  ): Promise<ChatListResult> {
    const parameters = new URLSearchParams();
    if (query.filter && query.filter !== 'ALL') parameters.set('filter', query.filter);
    if (query.search) parameters.set('search', query.search);
    if (query.updatedSince) parameters.set('updatedSince', query.updatedSince);
    const suffix = parameters.size ? `?${parameters.toString()}` : '';
    const payload = await this.request(
      baseUrl,
      `chats${suffix}`,
      deviceId,
      token,
      'GET',
      undefined,
      context,
    );
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.conversations) ||
      typeof payload.serverTimestamp !== 'string' ||
      typeof payload.totalUnread !== 'number'
    ) {
      return invalidChatResponse();
    }
    return {
      conversations: payload.conversations.map(parseChatSummary),
      serverTimestamp: payload.serverTimestamp,
      totalUnread: payload.totalUnread,
    };
  }

  async getChat(
    baseUrl: string,
    deviceId: string,
    token: string,
    context: CrmChatRequestContext,
    conversationId: string,
  ): Promise<ChatSummary> {
    const payload = await this.request(
      baseUrl,
      `chats/${encodeURIComponent(conversationId)}`,
      deviceId,
      token,
      'GET',
      undefined,
      context,
    );
    if (!isRecord(payload) || !isRecord(payload.conversation)) {
      throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер вернул неверный чат.');
    }
    return parseChatSummary(payload.conversation);
  }

  async chatMessages(
    baseUrl: string,
    deviceId: string,
    token: string,
    context: CrmChatRequestContext,
    conversationId: string,
    before?: string,
  ): Promise<ChatMessagePage> {
    const parameters = new URLSearchParams({ limit: '50' });
    if (before) parameters.set('before', before);
    const payload = await this.request(
      baseUrl,
      `chats/${encodeURIComponent(conversationId)}/messages?${parameters.toString()}`,
      deviceId,
      token,
      'GET',
      undefined,
      context,
    );
    return parseChatMessagePage(payload);
  }

  async sendChatMessage(
    baseUrl: string,
    deviceId: string,
    token: string,
    context: CrmChatRequestContext,
    conversationId: string,
    input: ChatSendInput,
  ): Promise<void> {
    await this.request(
      baseUrl,
      `chats/${encodeURIComponent(conversationId)}/messages`,
      deviceId,
      token,
      'POST',
      input,
      context,
    );
  }

  async markChatRead(
    baseUrl: string,
    deviceId: string,
    token: string,
    context: CrmChatRequestContext,
    conversationId: string,
  ): Promise<void> {
    await this.request(
      baseUrl,
      `chats/${encodeURIComponent(conversationId)}/read`,
      deviceId,
      token,
      'POST',
      {},
      context,
    );
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
  STUDENT_CONTACT: 55,
  GROUP_MEMBERSHIP: 60,
  SCHEDULE: 70,
  LESSON: 80,
  SUBSTITUTION: 90,
  CARD: 100,
  TARIFF: 110,
  SUBSCRIPTION: 120,
  ATTENDANCE: 130,
  SUBSCRIPTION_LEDGER: 140,
  STUDENT_NOTE: 150,
  CHAT_MESSAGE: 5,
  PUBLICATION: 160,
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

  private async chatConnection(): Promise<{ baseUrl: string; deviceId: string; token: string }> {
    const [enabled, baseUrl, deviceId, token] = await Promise.all([
      this.setting(SETTINGS.enabled),
      this.setting(SETTINGS.baseUrl),
      this.credentials.getDeviceId(),
      this.credentials.getToken(),
    ]);
    if (enabled !== 'true' || !baseUrl || !token) {
      throw new DomainError(
        'VALIDATION',
        'Сначала подключите CRM к сайту в настройках интеграции.',
      );
    }
    return { baseUrl, deviceId, token };
  }

  async listRemoteChats(
    context: CrmChatRequestContext,
    query: ChatListQuery,
  ): Promise<ChatListResult> {
    const connection = await this.chatConnection();
    return this.api.listChats(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      context,
      query,
    );
  }

  async getRemoteChat(
    context: CrmChatRequestContext,
    conversationId: string,
  ): Promise<ChatSummary> {
    const connection = await this.chatConnection();
    return this.api.getChat(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      context,
      conversationId,
    );
  }

  async getRemoteChatMessages(
    context: CrmChatRequestContext,
    conversationId: string,
    before?: string,
  ): Promise<ChatMessagePage> {
    const connection = await this.chatConnection();
    return this.api.chatMessages(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      context,
      conversationId,
      before,
    );
  }

  async markRemoteChatRead(context: CrmChatRequestContext, conversationId: string): Promise<void> {
    const connection = await this.chatConnection();
    await this.api.markChatRead(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      context,
      conversationId,
    );
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
      conflictCount,
      inboundCursor,
      lastInboundSync,
      lastOutboundSync,
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
      this.database.syncConflict.count({ where: { status: 'OPEN' } }),
      this.setting(SETTINGS.inboundCursor),
      this.setting(SETTINGS.lastInboundSync),
      this.setting(SETTINGS.lastOutboundSync),
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
    else if (lastState === 'RECONCILIATION_REQUIRED') connectionState = 'RECONCILIATION_REQUIRED';
    else if (!token) connectionState = 'NOT_PAIRED';
    else if (conflictCount > 0) connectionState = 'CONFLICT';
    else if (lastState === 'OFFLINE') connectionState = 'OFFLINE';
    else if (failedCount > 0) connectionState = 'SYNC_ERROR';
    else if (pendingCount > 0 || failedCount > 0) connectionState = 'PENDING_CHANGES';
    else connectionState = 'CONNECTED';
    let devices: IntegrationDeviceSummary[] = [];
    if (enabled && token && baseUrl) {
      try {
        devices = await this.api.listDevices(baseUrl, deviceId, token);
      } catch {
        // Status stays available from durable local state while offline.
      }
    }
    return {
      baseUrl: baseUrl ?? '',
      connectionState,
      conflictCount,
      devices,
      deviceId,
      enabled,
      failedCount,
      isPaired: Boolean(token),
      ...(lastError ? { lastError } : {}),
      ...(lastInboundSync ? { lastInboundSync } : {}),
      ...(lastOutboundSync ? { lastOutboundSync } : {}),
      ...(lastSuccessfulSync ? { lastSuccessfulSync } : {}),
      inboundCursor: Number(inboundCursor ?? 0),
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
      const deviceToken = await this.api.pair(
        baseUrl,
        deviceId,
        pairingCode,
        initialDisplayNameFromHost(),
      );
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

  async renameDevice(
    token: string,
    input: IntegrationDeviceRenameInput,
  ): Promise<IntegrationStatus> {
    await this.assertOwner(token);
    const displayName = sanitizeDisplayName(input.displayName);
    const [baseUrl, tokenValue, enabledValue] = await Promise.all([
      this.setting(SETTINGS.baseUrl),
      this.credentials.getToken(),
      this.setting(SETTINGS.enabled),
    ]);
    if (enabledValue !== 'true' || !baseUrl || !tokenValue) {
      throw new DomainError(
        'VALIDATION',
        'Сначала подключите CRM к сайту в настройках интеграции.',
      );
    }
    await this.api.renameDevice(baseUrl, input.deviceId, tokenValue, { displayName });
    return this.systemStatus();
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
    const [branches, rooms, trainers, groups, students, memberships, lessons, remoteEntities] =
      await Promise.all([
        this.database.branch.count(),
        this.database.room.count(),
        this.database.user.count({ where: { role: 'COACH' } }),
        this.database.danceGroup.count(),
        this.database.student.count(),
        this.database.enrollment.count(),
        this.database.lesson.count({ where: { startsAt: { gte: start, lte: end } } }),
        this.database.syncEntityState.count(),
      ]);
    const localOperationalEntities =
      branches + rooms + trainers + groups + students + memberships + lessons;
    return {
      branches,
      groups,
      lessons,
      localOperationalEntities,
      memberships,
      remoteEntities,
      requiresReconciliation: remoteEntities > 0 && localOperationalEntities > 0,
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
    const [
      branches,
      rooms,
      trainers,
      groups,
      students,
      contacts,
      memberships,
      schedules,
      lessons,
      substitutions,
      cards,
      tariffs,
      subscriptions,
      ledgers,
      attendance,
      notes,
    ] = await Promise.all([
      this.database.branch.findMany({ select: { id: true } }),
      this.database.room.findMany({ select: { id: true } }),
      this.database.user.findMany({ select: { id: true }, where: { role: 'COACH' } }),
      this.database.danceGroup.findMany({ select: { id: true } }),
      this.database.student.findMany({ select: { id: true } }),
      this.database.studentContact.findMany({ select: { id: true } }),
      this.database.enrollment.findMany({ select: { id: true } }),
      this.database.weeklySchedule.findMany({ select: { id: true } }),
      this.database.lesson.findMany({
        select: { id: true },
        where: { startsAt: { gte: start, lte: end } },
      }),
      this.database.trainerSubstitution.findMany({ select: { id: true } }),
      this.database.membershipCard.findMany({ select: { id: true } }),
      this.database.tariff.findMany({ select: { id: true } }),
      this.database.subscription.findMany({ select: { id: true } }),
      this.database.subscriptionLedger.findMany({ select: { id: true } }),
      this.database.attendance.findMany({ select: { lessonId: true, studentId: true } }),
      this.database.studentNote.findMany({ select: { id: true } }),
    ]);
    const rows: { entityId: string; entityType: SyncEntityType }[] = [
      ...branches.map(({ id }) => ({ entityId: id, entityType: 'BRANCH' as const })),
      ...rooms.map(({ id }) => ({ entityId: id, entityType: 'ROOM' as const })),
      ...trainers.map(({ id }) => ({ entityId: id, entityType: 'TRAINER' as const })),
      ...groups.map(({ id }) => ({ entityId: id, entityType: 'GROUP' as const })),
      ...students.map(({ id }) => ({ entityId: id, entityType: 'STUDENT_IDENTITY' as const })),
      ...contacts.map(({ id }) => ({ entityId: id, entityType: 'STUDENT_CONTACT' as const })),
      ...schedules.map(({ id }) => ({ entityId: id, entityType: 'SCHEDULE' as const })),
      ...lessons.map(({ id }) => ({ entityId: id, entityType: 'LESSON' as const })),
      ...memberships.map(({ id }) => ({ entityId: id, entityType: 'GROUP_MEMBERSHIP' as const })),
      ...substitutions.map(({ id }) => ({ entityId: id, entityType: 'SUBSTITUTION' as const })),
      ...cards.map(({ id }) => ({ entityId: id, entityType: 'CARD' as const })),
      ...tariffs.map(({ id }) => ({ entityId: id, entityType: 'TARIFF' as const })),
      ...subscriptions.map(({ id }) => ({ entityId: id, entityType: 'SUBSCRIPTION' as const })),
      ...ledgers.map(({ id }) => ({ entityId: id, entityType: 'SUBSCRIPTION_LEDGER' as const })),
      ...attendance.map(({ lessonId, studentId }) => ({
        entityId: `${lessonId}:${studentId}`,
        entityType: 'ATTENDANCE' as const,
      })),
      ...notes.map(({ id }) => ({ entityId: id, entityType: 'STUDENT_NOTE' as const })),
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
      const pendingChat = candidates.find(
        (item) => item.entityType === 'CHAT_MESSAGE' && item.nextAttemptAt <= this.now(),
      );
      if (pendingChat) {
        await this.processPendingChat(pendingChat);
        await this.processInboundSafely(baseUrl, deviceId, token);
        return;
      }
      const due = candidates.filter(({ nextAttemptAt }) => nextAttemptAt <= this.now());
      const latestByEntity = new Map<string, (typeof due)[number]>();
      for (const item of due) latestByEntity.set(`${item.entityType}:${item.entityId}`, item);
      const superseded = due.filter(
        (item) => latestByEntity.get(`${item.entityType}:${item.entityId}`)?.id !== item.id,
      );
      if (superseded.length > 0) {
        await this.database.syncOutbox.updateMany({
          data: { status: 'SYNCED', syncedAt: this.now() },
          where: { id: { in: superseded.map(({ id }) => id) }, status: 'PENDING' },
        });
      }
      const selected = [...latestByEntity.values()]
        .sort(
          (left, right) =>
            ENTITY_PRIORITY[left.entityType as SyncEntityType] -
              ENTITY_PRIORITY[right.entityType as SyncEntityType] ||
            left.createdAt.getTime() - right.createdAt.getTime(),
        )
        .slice(0, INTEGRATION_BATCH_SIZE);
      if (selected.length === 0) {
        await this.processInboundSafely(baseUrl, deviceId, token);
        return;
      }
      const ids = selected.map(({ id }) => id);
      const claimed = await this.database.syncOutbox.updateMany({
        data: { lastAttemptAt: this.now(), status: 'PROCESSING' },
        where: { id: { in: ids }, status: 'PENDING' },
      });
      if (claimed.count !== selected.length) return;
      try {
        const envelopes: SyncEntityEnvelope[] = [];
        for (const item of selected) {
          if (item.entityType === 'PUBLICATION' && item.operation === 'UPSERT') {
            await this.preparePublicationMedia(baseUrl, deviceId, token, item.entityId);
          }
          const envelope = await this.buildEnvelope(
            item.entityType as SyncEntityType,
            item.entityId,
            item.operation,
            item.idempotencyKey,
            item.baseRevision,
          );
          envelopes.push(envelope);
          await this.database.syncOutbox.update({
            data: { payloadJson: JSON.stringify(envelope.payload) },
            where: { id: item.id },
          });
        }
        const acknowledgement = await this.api.syncBatch(baseUrl, deviceId, token, envelopes);
        if (acknowledgement.deviceToken)
          await this.credentials.saveToken(acknowledgement.deviceToken);
        const syncedAt = new Date(acknowledgement.serverTimestamp);
        await this.recordOutboundAcknowledgements(selected, acknowledgement.accepted, syncedAt);
        await this.setSetting(SETTINGS.lastOutboundSync, syncedAt.toISOString());
        for (const item of selected) {
          await this.log(item, item.operation, 'SYNCED', item.attemptCount + 1);
        }
      } catch (error) {
        await this.failBatch(selected, error);
      }
      await this.processInboundSafely(baseUrl, deviceId, token);
    } finally {
      this.processing = false;
    }
  }

  private async processInboundSafely(
    baseUrl: string,
    deviceId: string,
    token: string,
  ): Promise<void> {
    try {
      await this.processInbound(baseUrl, deviceId, token);
    } catch (error) {
      await this.recordConnectionError(error);
    }
  }

  private async recordOutboundAcknowledgements(
    items: {
      baseRevision: number;
      entityId: string;
      entityType: string;
      id: string;
      idempotencyKey: string;
      operation: SyncOperation;
      payloadJson: string;
    }[],
    acknowledgements: SyncAcknowledgement[],
    syncedAt: Date,
  ): Promise<void> {
    const deviceId = await this.credentials.getDeviceId();
    await this.database.$transaction(async (transaction) => {
      for (const acknowledgement of acknowledgements) {
        const item = items.find(
          ({ idempotencyKey }) => idempotencyKey === acknowledgement.idempotencyKey,
        );
        if (!item) {
          throw new IntegrationApiError(
            'INVALID_RESPONSE',
            false,
            'Сервер подтвердил неизвестную операцию.',
          );
        }
        await transaction.syncOutbox.update({
          data: {
            lastErrorCode: acknowledgement.status === 'CONFLICT' ? 'SYNC_CONFLICT' : null,
            status: 'SYNCED',
            syncedAt,
          },
          where: { id: item.id },
        });
        await transaction.syncEntityState.upsert({
          create: {
            entityId: item.entityId,
            entityType: item.entityType,
            revision: acknowledgement.revision,
            serverSequence: acknowledgement.serverSequence,
            serverUpdatedAt: syncedAt,
            sourceDeviceId: deviceId,
          },
          update: {
            revision: acknowledgement.revision,
            serverSequence: acknowledgement.serverSequence,
            serverUpdatedAt: syncedAt,
            sourceDeviceId: deviceId,
          },
          where: {
            entityType_entityId: { entityId: item.entityId, entityType: item.entityType },
          },
        });
        if (acknowledgement.status === 'CONFLICT') {
          if (!acknowledgement.conflictId)
            throw new IntegrationApiError(
              'INVALID_RESPONSE',
              false,
              'Сервер не вернул номер конфликта.',
            );
          await transaction.syncConflict.upsert({
            create: {
              baseRevision: item.baseRevision,
              candidateOperation: item.operation,
              candidatePayloadJson: item.payloadJson,
              canonicalOperation: acknowledgement.canonicalOperation,
              canonicalPayloadJson: JSON.stringify(acknowledgement.canonicalPayload),
              canonicalRevision: acknowledgement.revision,
              entityId: item.entityId,
              entityType: item.entityType,
              serverConflictId: acknowledgement.conflictId,
              sourceDeviceId: deviceId,
            },
            update: {
              candidatePayloadJson: item.payloadJson,
              canonicalPayloadJson: JSON.stringify(acknowledgement.canonicalPayload),
              canonicalRevision: acknowledgement.revision,
              status: 'OPEN',
            },
            where: { serverConflictId: acknowledgement.conflictId },
          });
        }
      }
      await transaction.appSetting.upsert({
        create: { key: SETTINGS.lastState, value: 'CONNECTED' },
        update: { value: 'CONNECTED' },
        where: { key: SETTINGS.lastState },
      });
      await transaction.appSetting.upsert({
        create: { key: SETTINGS.lastSuccessfulSync, value: syncedAt.toISOString() },
        update: { value: syncedAt.toISOString() },
        where: { key: SETTINGS.lastSuccessfulSync },
      });
    });
  }

  private async processInbound(baseUrl: string, deviceId: string, token: string): Promise<void> {
    let cursor = Number((await this.setting(SETTINGS.inboundCursor)) ?? 0);
    for (let pageNumber = 0; pageNumber < 25; pageNumber += 1) {
      const [pendingCount, conflictCount] = await Promise.all([
        this.database.syncOutbox.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
        this.database.syncConflict.count({ where: { status: 'OPEN' } }),
      ]);
      const page = await this.api.fetchChanges(baseUrl, deviceId, token, {
        after: cursor,
        conflictCount,
        pendingCount,
      });
      if (cursor === 0 && page.canonicalCount > 0) {
        const [knownEntities, localEntities] = await Promise.all([
          this.database.syncEntityState.count(),
          this.countLocalOperationalEntities(),
        ]);
        if (knownEntities === 0 && localEntities > 0) {
          throw new IntegrationApiError(
            'RECONCILIATION_REQUIRED',
            false,
            'На устройстве и сервере уже есть данные. Требуется безопасное первичное согласование.',
          );
        }
      }
      for (const change of page.changes) await this.applyInboundChange(change);
      cursor = page.cursor;
      const synchronizedAt = this.now().toISOString();
      await this.database.$transaction([
        this.database.appSetting.upsert({
          create: { key: SETTINGS.inboundCursor, value: String(cursor) },
          update: { value: String(cursor) },
          where: { key: SETTINGS.inboundCursor },
        }),
        this.database.appSetting.upsert({
          create: { key: SETTINGS.lastInboundSync, value: synchronizedAt },
          update: { value: synchronizedAt },
          where: { key: SETTINGS.lastInboundSync },
        }),
        this.database.appSetting.upsert({
          create: { key: SETTINGS.lastSuccessfulSync, value: synchronizedAt },
          update: { value: synchronizedAt },
          where: { key: SETTINGS.lastSuccessfulSync },
        }),
        this.database.appSetting.upsert({
          create: { key: SETTINGS.lastState, value: 'CONNECTED' },
          update: { value: 'CONNECTED' },
          where: { key: SETTINGS.lastState },
        }),
        this.database.appSetting.deleteMany({ where: { key: SETTINGS.lastError } }),
      ]);
      if (!page.hasMore) break;
    }
  }

  private async countLocalOperationalEntities(): Promise<number> {
    const counts = await Promise.all([
      this.database.branch.count(),
      this.database.room.count(),
      this.database.user.count({ where: { role: 'COACH' } }),
      this.database.danceGroup.count(),
      this.database.student.count(),
      this.database.enrollment.count(),
      this.database.weeklySchedule.count(),
      this.database.lesson.count(),
    ]);
    return counts.reduce((total, count) => total + count, 0);
  }

  private async applyInboundChange(change: InboundChange): Promise<void> {
    const state = await this.database.syncEntityState.findUnique({
      where: {
        entityType_entityId: { entityId: change.entityId, entityType: change.entityType },
      },
    });
    if (state && state.revision >= change.revision) return;
    const pending = await this.database.syncOutbox.findFirst({
      orderBy: { createdAt: 'desc' },
      where: {
        entityId: change.entityId,
        entityType: change.entityType,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    });
    if (pending) {
      await this.database.syncConflict.create({
        data: {
          baseRevision: pending.baseRevision,
          candidateOperation: pending.operation,
          candidatePayloadJson: pending.payloadJson,
          canonicalOperation: change.operation,
          canonicalPayloadJson: JSON.stringify(change.payload),
          canonicalRevision: change.revision,
          entityId: change.entityId,
          entityType: change.entityType,
          sourceDeviceId: change.sourceDeviceId,
        },
      });
      return;
    }
    const owner = await this.database.user.findFirst({
      orderBy: { createdAt: 'asc' },
      where: { role: 'OWNER' },
    });
    if (!owner) throw new IntegrationApiError('LOCAL_STATE', false, 'В базе нет владельца.');
    await this.database.$transaction(async (transaction) => {
      await transaction.appSetting.upsert({
        create: { key: 'integration.applyingRemote', value: 'true' },
        update: { value: 'true' },
        where: { key: 'integration.applyingRemote' },
      });
      try {
        await this.applyReplica(transaction, change, owner.id);
        await transaction.syncEntityState.upsert({
          create: {
            entityId: change.entityId,
            entityType: change.entityType,
            revision: change.revision,
            serverSequence: change.sequence,
            serverUpdatedAt: new Date(change.serverUpdatedAt),
            sourceDeviceId: change.sourceDeviceId,
          },
          update: {
            revision: change.revision,
            serverSequence: change.sequence,
            serverUpdatedAt: new Date(change.serverUpdatedAt),
            sourceDeviceId: change.sourceDeviceId,
          },
          where: {
            entityType_entityId: { entityId: change.entityId, entityType: change.entityType },
          },
        });
      } finally {
        await transaction.appSetting.upsert({
          create: { key: 'integration.applyingRemote', value: 'false' },
          update: { value: 'false' },
          where: { key: 'integration.applyingRemote' },
        });
      }
    });
  }

  private async applyReplica(
    transaction: Parameters<Parameters<DatabaseClient['$transaction']>[0]>[0],
    change: InboundChange,
    ownerId: string,
  ): Promise<void> {
    const payload = change.payload;
    const archived = change.operation === 'ARCHIVE' || payload.missing === true;
    switch (change.entityType) {
      case 'BRANCH':
        if (archived) {
          await transaction.branch.updateMany({
            data: { archivedAt: this.now(), isActive: false },
            where: { id: change.entityId },
          });
        } else {
          await transaction.branch.upsert({
            create: {
              address: nullableString(payload.address) ?? '',
              description: nullableString(payload.description),
              id: change.entityId,
              isActive: booleanValue(payload.isActive, true),
              name: requiredString(payload, 'name'),
              phone: nullableString(payload.phone) ?? '',
            },
            update: {
              address: nullableString(payload.address) ?? '',
              archivedAt: optionalDate(payload.archivedAt),
              description: nullableString(payload.description),
              isActive: booleanValue(payload.isActive, true),
              name: requiredString(payload, 'name'),
              phone: nullableString(payload.phone) ?? '',
            },
            where: { id: change.entityId },
          });
        }
        break;
      case 'ROOM':
        if (archived) {
          await transaction.room.updateMany({
            data: { archivedAt: this.now(), isActive: false },
            where: { id: change.entityId },
          });
        } else {
          const data = {
            areaSquareMeters:
              typeof payload.areaSquareMeters === 'number' ? payload.areaSquareMeters : null,
            branchId: requiredString(payload, 'branchId'),
            capacity: typeof payload.capacity === 'number' ? payload.capacity : null,
            colorKey: nullableString(payload.colorKey),
            description: nullableString(payload.description),
            floor: nullableString(payload.floor),
            isActive: booleanValue(payload.isActive, true),
            name: requiredString(payload, 'name'),
            sortOrder: numberValue(payload.sortOrder),
          };
          await transaction.room.upsert({
            create: { id: change.entityId, ...data },
            update: { ...data, archivedAt: optionalDate(payload.archivedAt) },
            where: { id: change.entityId },
          });
        }
        break;
      case 'TRAINER': {
        if (archived) {
          await transaction.user.updateMany({
            data: { isActive: false },
            where: { id: change.entityId, role: 'COACH' },
          });
          break;
        }
        const fullName = requiredString(payload, 'displayName');
        await transaction.user.upsert({
          create: {
            email: `sync-${change.entityId}@device.arava.invalid`,
            fullName,
            id: change.entityId,
            isActive: booleanValue(payload.isActive),
            mustChangePassword: true,
            passwordHash: 'REMOTE_ACCOUNT_LOGIN_DISABLED',
            role: 'COACH',
          },
          update: { fullName, isActive: booleanValue(payload.isActive) },
          where: { id: change.entityId },
        });
        const branchIds = Array.isArray(payload.branchIds)
          ? payload.branchIds.filter((value): value is string => typeof value === 'string')
          : [];
        await transaction.userBranch.deleteMany({ where: { userId: change.entityId } });
        if (branchIds.length > 0) {
          await transaction.userBranch.createMany({
            data: branchIds.map((branchId) => ({ branchId, userId: change.entityId })),
          });
        }
        break;
      }
      case 'GROUP': {
        if (archived) {
          await transaction.danceGroup.updateMany({
            data: { archivedAt: this.now(), status: 'ARCHIVED' },
            where: { id: change.entityId },
          });
          break;
        }
        const data = {
          ageFrom: typeof payload.ageFrom === 'number' ? payload.ageFrom : null,
          ageTo: typeof payload.ageTo === 'number' ? payload.ageTo : null,
          assistantCoachId: nullableString(payload.assistantCoachId),
          branchId: requiredString(payload, 'branchId'),
          capacity: numberValue(payload.capacity, 20),
          coachId: nullableString(payload.coachId),
          color: nullableString(payload.color),
          description: nullableString(payload.description),
          direction: requiredString(payload, 'direction'),
          name: requiredString(payload, 'name'),
          status: enumValue(
            payload.status,
            ['ACTIVE', 'RECRUITING', 'PAUSED', 'ARCHIVED'] as const,
            'RECRUITING',
          ),
        };
        await transaction.danceGroup.upsert({
          create: { id: change.entityId, ...data },
          update: { ...data, archivedAt: optionalDate(payload.archivedAt) },
          where: { id: change.entityId },
        });
        break;
      }
      case 'STUDENT_IDENTITY': {
        if (archived) {
          await transaction.student.updateMany({
            data: { archivedAt: this.now(), status: 'ARCHIVED' },
            where: { id: change.entityId },
          });
          break;
        }
        const gender: Gender | null =
          payload.gender === 'FEMALE' || payload.gender === 'MALE' || payload.gender === 'OTHER'
            ? payload.gender
            : null;
        const data = {
          birthDate: optionalDate(payload.birthDate),
          branchId: requiredString(payload, 'branchId'),
          email: nullableString(payload.email),
          firstName: requiredString(payload, 'firstName'),
          gender,
          lastName: requiredString(payload, 'lastName'),
          middleName: nullableString(payload.middleName),
          notes: nullableString(payload.notes),
          phone: nullableString(payload.phone),
          status: enumValue(
            payload.status,
            ['ACTIVE', 'TRIAL', 'FROZEN', 'LEFT', 'ARCHIVED'] as const,
            'ACTIVE',
          ),
        };
        await transaction.student.upsert({
          create: { id: change.entityId, ...data },
          update: { ...data, archivedAt: optionalDate(payload.archivedAt) },
          where: { id: change.entityId },
        });
        break;
      }
      case 'STUDENT_CONTACT': {
        if (archived) {
          await transaction.studentContact.updateMany({
            data: { archivedAt: this.now() },
            where: { id: change.entityId },
          });
          break;
        }
        const data = {
          email: nullableString(payload.email),
          fullName: requiredString(payload, 'fullName'),
          isPrimary: booleanValue(payload.isPrimary),
          notes: nullableString(payload.notes),
          phone: requiredString(payload, 'phone'),
          relationship: requiredString(payload, 'relationship'),
          secondaryPhone: nullableString(payload.secondaryPhone),
          studentId: requiredString(payload, 'studentId'),
          telegram: nullableString(payload.telegram),
          whatsapp: booleanValue(payload.whatsapp),
        };
        await transaction.studentContact.upsert({
          create: { id: change.entityId, ...data },
          update: { ...data, archivedAt: optionalDate(payload.archivedAt) },
          where: { id: change.entityId },
        });
        break;
      }
      case 'GROUP_MEMBERSHIP': {
        if (archived) {
          await transaction.enrollment.updateMany({
            data: { leftAt: this.now(), status: 'LEFT' },
            where: { id: change.entityId },
          });
          break;
        }
        const data = {
          groupId: requiredString(payload, 'groupId'),
          joinedAt: requiredDate(payload, 'joinedAt'),
          leftAt: optionalDate(payload.leftAt),
          notes: nullableString(payload.notes),
          status: enumValue(
            payload.status,
            ['ACTIVE', 'TRIAL', 'FROZEN', 'LEFT'] as const,
            'ACTIVE',
          ),
          studentId: requiredString(payload, 'studentId'),
        };
        await transaction.enrollment.upsert({
          create: { id: change.entityId, ...data },
          update: data,
          where: { id: change.entityId },
        });
        break;
      }
      case 'SCHEDULE': {
        if (archived) {
          await transaction.weeklySchedule.updateMany({
            data: { isActive: false },
            where: { id: change.entityId },
          });
          break;
        }
        const data = {
          branchId: requiredString(payload, 'branchId'),
          coachId: nullableString(payload.coachId),
          endTime: requiredString(payload, 'endTime'),
          groupId: requiredString(payload, 'groupId'),
          isActive: booleanValue(payload.isActive, true),
          room: nullableString(payload.room),
          roomId: nullableString(payload.roomId),
          startTime: requiredString(payload, 'startTime'),
          validFrom: requiredDate(payload, 'validFrom'),
          validTo: optionalDate(payload.validTo),
          weekday: numberValue(payload.weekday),
        };
        await transaction.weeklySchedule.upsert({
          create: { id: change.entityId, ...data },
          update: data,
          where: { id: change.entityId },
        });
        break;
      }
      case 'LESSON': {
        if (archived) return;
        const data = {
          attendanceCompletedAt: optionalDate(payload.attendanceCompletedAt),
          branchId: requiredString(payload, 'branchId'),
          cancellationReason: nullableString(payload.cancellationReason),
          coachId: nullableString(payload.coachId),
          endsAt: requiredDate(payload, 'endsAt'),
          groupId: requiredString(payload, 'groupId'),
          notes: nullableString(payload.notes),
          room: nullableString(payload.room),
          roomId: nullableString(payload.roomId),
          scheduleTemplateId: nullableString(payload.scheduleTemplateId),
          startsAt: requiredDate(payload, 'startsAt'),
          status: enumValue(
            payload.status,
            ['PLANNED', 'COMPLETED', 'CANCELLED'] as const,
            'PLANNED',
          ),
        };
        await transaction.lesson.upsert({
          create: { id: change.entityId, ...data },
          update: data,
          where: { id: change.entityId },
        });
        break;
      }
      case 'SUBSTITUTION': {
        if (archived) return;
        const data = {
          createdByUserId: ownerId,
          lessonId: requiredString(payload, 'lessonId'),
          originalTrainerId: nullableString(payload.originalTrainerId),
          reason: nullableString(payload.reason),
          substituteTrainerId: requiredString(payload, 'substituteTrainerId'),
        };
        await transaction.trainerSubstitution.upsert({
          create: { id: change.entityId, ...data },
          update: data,
          where: { id: change.entityId },
        });
        break;
      }
      case 'CARD': {
        if (archived) {
          await transaction.membershipCard.updateMany({
            data: { archivedAt: this.now(), status: 'ARCHIVED' },
            where: { id: change.entityId },
          });
          break;
        }
        const data = {
          archivedAt: optionalDate(payload.archivedAt),
          barcode: requiredString(payload, 'barcode'),
          blockedAt: optionalDate(payload.blockedAt),
          issuedAt: optionalDate(payload.issuedAt),
          notes: nullableString(payload.notes),
          status: enumValue(
            payload.status,
            ['FREE', 'ASSIGNED', 'BLOCKED', 'LOST', 'ARCHIVED'] as const,
            'FREE',
          ),
          studentId: nullableString(payload.studentId),
          unassignedAt: optionalDate(payload.unassignedAt),
        };
        await transaction.membershipCard.upsert({
          create: { createdByUserId: ownerId, id: change.entityId, ...data },
          update: data,
          where: { id: change.entityId },
        });
        break;
      }
      case 'TARIFF': {
        if (archived) {
          await transaction.tariff.updateMany({
            data: { archivedAt: this.now(), isActive: false },
            where: { id: change.entityId },
          });
          break;
        }
        const data = {
          archivedAt: optionalDate(payload.archivedAt),
          branchId: nullableString(payload.branchId),
          currency: optionalString(payload.currency) ?? 'RUB',
          description: nullableString(payload.description),
          freezeDays: typeof payload.freezeDays === 'number' ? payload.freezeDays : null,
          isActive: booleanValue(payload.isActive, true),
          lessonCount: typeof payload.lessonCount === 'number' ? payload.lessonCount : null,
          name: requiredString(payload, 'name'),
          price: numberValue(payload.price),
          type: enumValue(
            payload.type,
            ['LESSON_PACK', 'UNLIMITED', 'SINGLE_LESSON', 'TRIAL'] as const,
            'LESSON_PACK',
          ),
          validityDays: typeof payload.validityDays === 'number' ? payload.validityDays : null,
        };
        await transaction.tariff.upsert({
          create: { id: change.entityId, ...data },
          update: data,
          where: { id: change.entityId },
        });
        break;
      }
      case 'SUBSCRIPTION': {
        if (archived) return;
        const data = {
          branchId: requiredString(payload, 'branchId'),
          createdByUserId: ownerId,
          expiresAt: optionalDate(payload.expiresAt),
          freezeEndsAt: optionalDate(payload.freezeEndsAt),
          freezeStartedAt: optionalDate(payload.freezeStartedAt),
          frozenDaysUsed: numberValue(payload.frozenDaysUsed),
          lessonLimit: typeof payload.lessonLimit === 'number' ? payload.lessonLimit : null,
          lessonsUsed: numberValue(payload.lessonsUsed),
          notes: nullableString(payload.notes),
          purchasedAt: requiredDate(payload, 'purchasedAt'),
          salePrice: numberValue(payload.salePrice),
          startsAt: requiredDate(payload, 'startsAt'),
          status: enumValue(
            payload.status,
            ['ACTIVE', 'PENDING', 'EXPIRED', 'FROZEN', 'CANCELLED', 'USED_UP'] as const,
            'PENDING',
          ),
          studentId: requiredString(payload, 'studentId'),
          tariffId: requiredString(payload, 'tariffId'),
        };
        await transaction.subscription.upsert({
          create: { id: change.entityId, ...data },
          update: data,
          where: { id: change.entityId },
        });
        break;
      }
      case 'SUBSCRIPTION_LEDGER': {
        if (archived) return;
        const data = {
          amountDelta: typeof payload.amountDelta === 'number' ? payload.amountDelta : null,
          attendanceId: nullableString(payload.attendanceId),
          comment: nullableString(payload.comment),
          createdByUserId: ownerId,
          lessonDelta: numberValue(payload.lessonDelta),
          lessonId: nullableString(payload.lessonId),
          reversesLedgerId: nullableString(payload.reversesLedgerId),
          studentId: requiredString(payload, 'studentId'),
          subscriptionId: requiredString(payload, 'subscriptionId'),
          type: enumValue(
            payload.type,
            [
              'PURCHASE',
              'LESSON_WRITE_OFF',
              'REVERSAL',
              'MANUAL_ADJUSTMENT',
              'FREEZE',
              'UNFREEZE',
            ] as const,
            'MANUAL_ADJUSTMENT',
          ),
        };
        await transaction.subscriptionLedger.upsert({
          create: { createdAt: requiredDate(payload, 'createdAt'), id: change.entityId, ...data },
          update: data,
          where: { id: change.entityId },
        });
        break;
      }
      case 'ATTENDANCE': {
        if (archived) return;
        const lessonId = requiredString(payload, 'lessonId');
        const studentId = requiredString(payload, 'studentId');
        const data = {
          comment: nullableString(payload.comment),
          markedAt: requiredDate(payload, 'markedAt'),
          markedByUserId: ownerId,
          status: enumValue(
            payload.status,
            ['PRESENT', 'ABSENT', 'EXCUSED', 'LATE', 'TRIAL'] as const,
            'ABSENT',
          ),
        };
        await transaction.attendance.upsert({
          create: { lessonId, studentId, ...data },
          update: data,
          where: { lessonId_studentId: { lessonId, studentId } },
        });
        break;
      }
      case 'STUDENT_NOTE': {
        if (archived) {
          await transaction.studentNote.updateMany({
            data: { archivedAt: this.now() },
            where: { id: change.entityId },
          });
          break;
        }
        const data = {
          archivedAt: optionalDate(payload.archivedAt),
          authorUserId: ownerId,
          studentId: requiredString(payload, 'studentId'),
          text: requiredString(payload, 'text'),
        };
        await transaction.studentNote.upsert({
          create: { id: change.entityId, ...data },
          update: data,
          where: { id: change.entityId },
        });
        break;
      }
      case 'PUBLICATION':
        // Website publication replication remains owned by the publication pipeline.
        break;
    }
  }

  private async preparePublicationMedia(
    baseUrl: string,
    deviceId: string,
    token: string,
    publicationId: string,
  ): Promise<void> {
    const publication = await this.database.publication.findUnique({
      where: { id: publicationId },
    });
    if (!publication?.mediaLocalPath || publication.mediaRef) return;
    if (!publication.mediaContentType || !publication.mediaFileName) {
      throw new IntegrationApiError(
        'INVALID_PAYLOAD',
        false,
        'Данные изображения публикации повреждены.',
      );
    }
    const bytes = await readFile(publication.mediaLocalPath);
    const mediaRef = await this.api.uploadPublicationMedia(baseUrl, deviceId, token, {
      bytes,
      contentType: publication.mediaContentType,
      fileName: publication.mediaFileName,
      mediaId: `publication-${publication.id}`,
    });
    await this.database.publication.update({ data: { mediaRef }, where: { id: publicationId } });
  }

  private async processPendingChat(item: {
    attemptCount: number;
    entityId: string;
    entityType: string;
    id: string;
    idempotencyKey: string;
    operation: SyncOperation;
    payloadJson: string;
  }): Promise<void> {
    const claimed = await this.database.syncOutbox.updateMany({
      data: { lastAttemptAt: this.now(), status: 'PROCESSING' },
      where: { id: item.id, status: 'PENDING' },
    });
    if (claimed.count !== 1) return;
    try {
      const payload = JSON.parse(item.payloadJson) as unknown;
      if (!isRecord(payload) || !isRecord(payload.context)) {
        throw new IntegrationApiError('INVALID_PAYLOAD', false, 'Отложенное сообщение повреждено.');
      }
      const context = payload.context as unknown as CrmChatRequestContext;
      const text = optionalString(payload.text);
      const clientMessageId = optionalString(payload.clientMessageId);
      if (!text || !clientMessageId) {
        throw new IntegrationApiError('INVALID_PAYLOAD', false, 'Отложенное сообщение повреждено.');
      }
      const connection = await this.chatConnection();
      await this.api.sendChatMessage(
        connection.baseUrl,
        connection.deviceId,
        connection.token,
        context,
        item.entityId,
        { clientMessageId, text },
      );
      await this.database.$transaction([
        this.database.syncOutbox.update({
          data: { lastErrorCode: null, status: 'SYNCED', syncedAt: this.now() },
          where: { id: item.id },
        }),
        this.database.appSetting.upsert({
          create: { key: SETTINGS.lastState, value: 'CONNECTED' },
          update: { value: 'CONNECTED' },
          where: { key: SETTINGS.lastState },
        }),
      ]);
      await this.log(item, 'CHAT_SEND', 'SYNCED', item.attemptCount + 1);
    } catch (error) {
      await this.failBatch([item], error);
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
          : apiError.errorCode === 'RECONCILIATION_REQUIRED'
            ? 'RECONCILIATION_REQUIRED'
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
    baseRevision: number,
  ): Promise<SyncEntityEnvelope> {
    const payload = await this.safePayload(entityType, entityId);
    const updatedAt = optionalString(payload.updatedAt) ?? this.now().toISOString();
    return {
      baseRevision,
      entityId,
      entityType,
      idempotencyKey,
      operation: payload.missing === true ? 'ARCHIVE' : operation,
      payload: operation === 'ARCHIVE' ? { id: entityId, missing: true } : payload,
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
              address: row.address,
              archivedAt: iso(row.archivedAt),
              description: row.description,
              id: row.id,
              isActive: row.isActive,
              name: row.name,
              phone: row.phone,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'ROOM': {
        const row = await this.database.room.findUnique({ where: { id: entityId } });
        return row
          ? {
              archivedAt: iso(row.archivedAt),
              areaSquareMeters: row.areaSquareMeters,
              branchId: row.branchId,
              capacity: row.capacity,
              colorKey: row.colorKey,
              description: row.description,
              floor: row.floor,
              id: row.id,
              isActive: row.isActive,
              name: row.name,
              sortOrder: row.sortOrder,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'TRAINER': {
        const row = await this.database.user.findUnique({
          include: {
            branchAssignments: { select: { branchId: true } },
            coachedGroups: { select: { direction: true, id: true }, where: { archivedAt: null } },
          },
          where: { id: entityId },
        });
        return row
          ? {
              activeGroupIds: row.coachedGroups.map(({ id }) => id),
              branchIds: row.branchAssignments.map(({ branchId }) => branchId),
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
              description: row.description,
              direction: row.direction,
              id: row.id,
              name: row.name,
              archivedAt: iso(row.archivedAt),
              capacity: row.capacity,
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
              archivedAt: iso(row.archivedAt),
              birthDate: iso(row.birthDate),
              email: row.email,
              firstName: row.firstName,
              gender: row.gender,
              id: row.id,
              lastName: row.lastName,
              middleName: row.middleName,
              notes: row.notes,
              phone: row.phone,
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
              notes: row.notes,
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
              room: row.room,
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
              attendanceCompletedAt: iso(row.attendanceCompletedAt),
              cancellationReason: row.cancellationReason,
              endsAt: row.endsAt.toISOString(),
              groupId: row.groupId,
              id: row.id,
              roomId: row.roomId,
              room: row.room,
              notes: row.notes,
              scheduleTemplateId: row.scheduleTemplateId,
              startsAt: row.startsAt.toISOString(),
              status: row.status,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'STUDENT_CONTACT': {
        const row = await this.database.studentContact.findUnique({ where: { id: entityId } });
        return row
          ? {
              archivedAt: iso(row.archivedAt),
              email: row.email,
              fullName: row.fullName,
              id: row.id,
              isPrimary: row.isPrimary,
              notes: row.notes,
              phone: row.phone,
              relationship: row.relationship,
              secondaryPhone: row.secondaryPhone,
              studentId: row.studentId,
              telegram: row.telegram,
              updatedAt: row.updatedAt.toISOString(),
              whatsapp: row.whatsapp,
            }
          : { id: entityId, missing: true };
      }
      case 'SUBSTITUTION': {
        const row = await this.database.trainerSubstitution.findUnique({
          where: { id: entityId },
        });
        return row
          ? {
              createdAt: row.createdAt.toISOString(),
              id: row.id,
              lessonId: row.lessonId,
              originalTrainerId: row.originalTrainerId,
              reason: row.reason,
              substituteTrainerId: row.substituteTrainerId,
            }
          : { id: entityId, missing: true };
      }
      case 'CARD': {
        const row = await this.database.membershipCard.findUnique({ where: { id: entityId } });
        return row
          ? {
              archivedAt: iso(row.archivedAt),
              barcode: row.barcode,
              blockedAt: iso(row.blockedAt),
              id: row.id,
              issuedAt: iso(row.issuedAt),
              notes: row.notes,
              status: row.status,
              studentId: row.studentId,
              unassignedAt: iso(row.unassignedAt),
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'TARIFF': {
        const row = await this.database.tariff.findUnique({ where: { id: entityId } });
        return row
          ? {
              archivedAt: iso(row.archivedAt),
              branchId: row.branchId,
              currency: row.currency,
              description: row.description,
              freezeDays: row.freezeDays,
              id: row.id,
              isActive: row.isActive,
              lessonCount: row.lessonCount,
              name: row.name,
              price: row.price,
              type: row.type,
              updatedAt: row.updatedAt.toISOString(),
              validityDays: row.validityDays,
            }
          : { id: entityId, missing: true };
      }
      case 'SUBSCRIPTION': {
        const row = await this.database.subscription.findUnique({ where: { id: entityId } });
        return row
          ? {
              branchId: row.branchId,
              expiresAt: iso(row.expiresAt),
              freezeEndsAt: iso(row.freezeEndsAt),
              freezeStartedAt: iso(row.freezeStartedAt),
              frozenDaysUsed: row.frozenDaysUsed,
              id: row.id,
              lessonLimit: row.lessonLimit,
              lessonsUsed: row.lessonsUsed,
              notes: row.notes,
              purchasedAt: row.purchasedAt.toISOString(),
              salePrice: row.salePrice,
              startsAt: row.startsAt.toISOString(),
              status: row.status,
              studentId: row.studentId,
              tariffId: row.tariffId,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'SUBSCRIPTION_LEDGER': {
        const row = await this.database.subscriptionLedger.findUnique({ where: { id: entityId } });
        return row
          ? {
              amountDelta: row.amountDelta,
              attendanceId: row.attendanceId,
              comment: row.comment,
              createdAt: row.createdAt.toISOString(),
              id: row.id,
              lessonDelta: row.lessonDelta,
              lessonId: row.lessonId,
              reversesLedgerId: row.reversesLedgerId,
              studentId: row.studentId,
              subscriptionId: row.subscriptionId,
              type: row.type,
            }
          : { id: entityId, missing: true };
      }
      case 'ATTENDANCE': {
        const separator = entityId.indexOf(':');
        if (separator < 1) return { id: entityId, missing: true };
        const lessonId = entityId.slice(0, separator);
        const studentId = entityId.slice(separator + 1);
        const row = await this.database.attendance.findUnique({
          where: { lessonId_studentId: { lessonId, studentId } },
        });
        return row
          ? {
              comment: row.comment,
              id: entityId,
              lessonId: row.lessonId,
              markedAt: row.markedAt.toISOString(),
              status: row.status,
              studentId: row.studentId,
            }
          : { id: entityId, missing: true };
      }
      case 'STUDENT_NOTE': {
        const row = await this.database.studentNote.findUnique({
          include: { author: { select: { fullName: true } } },
          where: { id: entityId },
        });
        return row
          ? {
              archivedAt: iso(row.archivedAt),
              authorName: row.author.fullName,
              createdAt: row.createdAt.toISOString(),
              id: row.id,
              studentId: row.studentId,
              text: row.text,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'PUBLICATION': {
        const row = await this.database.publication.findUnique({
          include: {
            createdBy: { select: { fullName: true, id: true, role: true } },
            targets: true,
          },
          where: { id: entityId },
        });
        return row
          ? {
              audienceMode: row.audienceMode,
              author: {
                id: row.createdBy.id,
                name: row.createdBy.fullName,
                role: row.createdBy.role,
              },
              body: row.body,
              eventLocation: row.eventLocation,
              eventStartsAt: iso(row.eventStartsAt),
              expiresAt: iso(row.expiresAt),
              id: row.id,
              mediaRef: row.mediaRef,
              publishAt: iso(row.publishAt),
              status: row.status,
              targets: row.targets.map((target) => ({ id: target.targetId, type: target.type })),
              title: row.title,
              type: row.type,
              updatedAt: row.updatedAt.toISOString(),
            }
          : { id: entityId, missing: true };
      }
      case 'CHAT_MESSAGE':
        return { id: entityId, missing: true };
    }
  }
}
