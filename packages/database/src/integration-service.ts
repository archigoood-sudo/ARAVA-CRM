import type {
  AqsiDeviceList,
  AqsiDeviceSummary,
  AqsiGatewayPayment,
  AuthenticatedUser,
  ChatListQuery,
  ChatListResult,
  ChatMessagePage,
  ChatSendInput,
  ChatSummary,
  IntegrationInitialSyncPreview,
  IntegrationConflictResolutionInput,
  IntegrationConflictSummary,
  IntegrationDiagnosticCheck,
  IntegrationDiagnostics,
  IntegrationDeviceSummary,
  IntegrationLogEntry,
  IntegrationJournalMaintenanceResult,
  IntegrationPairInput,
  IntegrationDeviceRenameInput,
  IntegrationSettingsInput,
  IntegrationStatus,
  IntegrationReconciliationPreview,
  PaymentOperationSummary,
  SbpGatewayPayment,
  SbpProviderHealth,
  SubscriptionFreezeInput,
  WebActionSummary,
} from '@arava/shared';
import type { Gender, SyncOperation } from '@prisma/client';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';

import type { DatabaseClient } from './index';
import { DomainError } from './security';
import type { ApplicationService } from './services';
import { FinanceService } from './finance-service';
import { accessibleBranchIds, assertBranchAccess, assertPermission } from './permissions';
import { StudioService } from './studio-service';

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
  reconciliationApproved: 'integration.reconciliationApproved',
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

interface RemoteWebAction {
  actionType: string;
  externalActionId: string;
  crmTrainerId?: string;
  crmLessonId?: string;
  crmStudentId?: string;
  crmSubscriptionId?: string;
  marks?: { crmStudentId: string; status: string }[];
  profileChanges?: { firstName?: string; lastName?: string; phone?: string };
  profilePayloadValid?: boolean;
  reason?: string;
  receivedAt: string;
}

type WebActionCompletionStatus = 'SUCCEEDED' | 'REJECTED' | 'FAILED';

interface IntegrationHealthDetails {
  apiVersion: string;
  deviceStatus?: string;
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

function diagnosticFailure(error: unknown): { action: string; detail: string } {
  const code = error instanceof IntegrationApiError ? error.errorCode : 'UNKNOWN';
  if (code === 'TIMEOUT') {
    return {
      action: 'Проверьте интернет и повторите диагностику.',
      detail: 'Сервер не ответил за отведённое время.',
    };
  }
  if (code === 'NETWORK_UNAVAILABLE') {
    return {
      action: 'Проверьте интернет и адрес API сайта.',
      detail: 'Не удалось установить соединение с сервером.',
    };
  }
  if (code === 'DEVICE_REVOKED') {
    return {
      action: 'Подключите устройство заново.',
      detail: 'Сервер отозвал это устройство.',
    };
  }
  if (code === 'AUTH_REQUIRED' || code === 'ACCESS_DENIED' || code === 'HTTP_401') {
    return {
      action: 'Подключите устройство заново.',
      detail: 'Сервер не принял авторизацию устройства.',
    };
  }
  if (code === 'ENDPOINT_NOT_FOUND') {
    return {
      action: 'Проверьте совместимость версии ARAVA-WEB.',
      detail: 'Сервис отсутствует на текущей версии сайта.',
    };
  }
  return {
    action: 'Повторите проверку позже или обратитесь к администратору сайта.',
    detail: 'Сервис сайта не прошёл проверку.',
  };
}

function diagnosticCheck(
  id: string,
  label: string,
  status: IntegrationDiagnosticCheck['status'],
  detail: string,
  action?: string,
): IntegrationDiagnosticCheck {
  return { ...(action ? { action } : {}), detail, id, label, status };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseAqsiGatewayPayment(
  payload: unknown,
  expected: PaymentOperationSummary,
): AqsiGatewayPayment {
  if (!isRecord(payload))
    throw new IntegrationApiError(
      'INVALID_RESPONSE',
      false,
      'Сервер вернул неверную операцию СБП.',
    );
  const statuses = new Set([
    'CREATED',
    'WAITING',
    'PROCESSING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'EXPIRED',
  ]);
  if (
    payload.provider !== (expected.providerType === 'ACQUIRING' ? 'AQSI_CARD' : 'AQSI_SBP') ||
    payload.aravaOperationId !== expected.id ||
    payload.currency !== 'RUB' ||
    payload.amountKopecks !== expected.amount ||
    typeof payload.status !== 'string' ||
    !statuses.has(payload.status) ||
    (payload.status === 'SUCCEEDED' &&
      (!Number.isSafeInteger(payload.deviceId) ||
        typeof payload.providerOperationId !== 'string' ||
        payload.providerOperationId.length === 0 ||
        typeof payload.providerResultId !== 'string' ||
        payload.providerResultId.length === 0)) ||
    typeof payload.updatedAt !== 'string'
  ) {
    throw new IntegrationApiError(
      'INVALID_RESPONSE',
      false,
      'Данные операции СБП не совпадают с оплатой.',
    );
  }
  const error =
    isRecord(payload.error) && typeof payload.error.message === 'string'
      ? {
          ...(typeof payload.error.code === 'string' ? { code: payload.error.code } : {}),
          message: payload.error.message,
        }
      : null;
  return {
    amountKopecks: payload.amountKopecks,
    aravaOperationId: expected.id,
    currency: 'RUB',
    error,
    ...(typeof payload.expiresAt === 'string' ? { expiresAt: payload.expiresAt } : {}),
    ...(Number.isSafeInteger(payload.deviceId) ? { deviceId: payload.deviceId as number } : {}),
    provider: payload.provider as AqsiGatewayPayment['provider'],
    ...(typeof payload.providerOperationId === 'string'
      ? { providerOperationId: payload.providerOperationId }
      : {}),
    ...(typeof payload.providerResultId === 'string'
      ? { providerResultId: payload.providerResultId }
      : {}),
    ...(typeof payload.providerStatus === 'string'
      ? { providerStatus: payload.providerStatus }
      : {}),
    ...(typeof payload.qrPayload === 'string' ? { qrPayload: payload.qrPayload } : {}),
    status: payload.status as AqsiGatewayPayment['status'],
    updatedAt: payload.updatedAt,
  };
}

function parseAqsiDevice(payload: unknown): AqsiDeviceSummary {
  if (
    !isRecord(payload) ||
    !Number.isSafeInteger(payload.deviceId) ||
    typeof payload.name !== 'string' ||
    typeof payload.selected !== 'boolean'
  ) {
    throw new IntegrationApiError(
      'INVALID_RESPONSE',
      false,
      'Сервер вернул неверные данные кассы aQsi.',
    );
  }
  return {
    deviceId: payload.deviceId as number,
    ...(typeof payload.imei === 'string' ? { imei: payload.imei } : {}),
    ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
    name: payload.name,
    selected: payload.selected,
    ...(typeof payload.serialNumber === 'string' ? { serialNumber: payload.serialNumber } : {}),
  };
}

function parseAqsiDevices(payload: unknown): AqsiDeviceList {
  if (!isRecord(payload) || !Array.isArray(payload.devices)) {
    throw new IntegrationApiError(
      'INVALID_RESPONSE',
      false,
      'Сервер вернул неверный список касс aQsi.',
    );
  }
  return {
    devices: payload.devices.map(parseAqsiDevice),
    ...(Number.isSafeInteger(payload.selectedDeviceId)
      ? { selectedDeviceId: payload.selectedDeviceId as number }
      : {}),
  };
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

function parseManagedConflict(value: unknown): IntegrationConflictSummary {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.entityType !== 'string' ||
    typeof value.entityId !== 'string' ||
    typeof value.baseRevision !== 'number' ||
    typeof value.canonicalRevision !== 'number' ||
    !isRecord(value.canonical) ||
    !isRecord(value.candidate) ||
    !Array.isArray(value.differences) ||
    typeof value.sourceDeviceId !== 'string' ||
    typeof value.createdAt !== 'string' ||
    (value.canonicalOperation !== 'UPSERT' && value.canonicalOperation !== 'ARCHIVE') ||
    (value.candidateOperation !== 'UPSERT' && value.candidateOperation !== 'ARCHIVE') ||
    (value.status !== 'OPEN' && value.status !== 'RESOLVED')
  )
    throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер вернул неверный конфликт.');
  const differences = value.differences.map((item) => {
    if (!isRecord(item) || typeof item.field !== 'string')
      throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер вернул неверные различия.');
    return { candidate: item.candidate, canonical: item.canonical, field: item.field };
  });
  return {
    baseRevision: value.baseRevision,
    candidate: value.candidate,
    candidateOperation: value.candidateOperation,
    canonical: value.canonical,
    canonicalOperation: value.canonicalOperation,
    canonicalRevision: value.canonicalRevision,
    createdAt: value.createdAt,
    differences,
    entityId: value.entityId,
    entityType: value.entityType,
    id: value.id,
    sourceDeviceId: value.sourceDeviceId,
    ...(typeof value.sourceDeviceName === 'string'
      ? { sourceDeviceName: value.sourceDeviceName }
      : {}),
    status: value.status,
  };
}

function parseReconciliationPreview(value: unknown): IntegrationReconciliationPreview {
  if (!isRecord(value) || typeof value.serverCursor !== 'number')
    throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер вернул неверную сверку.');
  const parseItems = (items: unknown) => {
    if (!Array.isArray(items))
      throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер вернул неверную сверку.');
    return items.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.entityId !== 'string' ||
        typeof item.entityType !== 'string' ||
        typeof item.reason !== 'string'
      )
        throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер вернул неверную сверку.');
      return { entityId: item.entityId, entityType: item.entityType, reason: item.reason };
    });
  };
  return {
    ambiguous: parseItems(value.ambiguous),
    divergent: parseItems(value.divergent),
    identical: parseItems(value.identical),
    localOnly: parseItems(value.localOnly),
    serverOnly: parseItems(value.serverOnly),
    serverCursor: value.serverCursor,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  if (value === undefined) return 'null';
  return JSON.stringify(value);
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
    method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
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

  async inspectHealth(
    baseUrl: string,
    deviceId: string,
    token: string,
  ): Promise<IntegrationHealthDetails> {
    const payload = await this.request(baseUrl, 'health', deviceId, token, 'GET');
    if (!isRecord(payload) || !optionalString(payload.apiVersion)) {
      throw new IntegrationApiError('INVALID_RESPONSE', false, 'Сервер вернул неверный ответ.');
    }
    return {
      apiVersion: String(payload.apiVersion),
      ...(typeof payload.deviceStatus === 'string' ? { deviceStatus: payload.deviceStatus } : {}),
    };
  }

  async paymentProviderHealth(
    baseUrl: string,
    deviceId: string,
    token: string,
    context: CrmChatRequestContext,
  ): Promise<SbpProviderHealth> {
    const payload = await this.request(
      baseUrl,
      'payments/provider-health',
      deviceId,
      token,
      'GET',
      undefined,
      context,
    );
    if (
      !isRecord(payload) ||
      typeof payload.configured !== 'boolean' ||
      typeof payload.apiReachable !== 'boolean' ||
      payload.provider !== 'AQSI_SBP' ||
      typeof payload.deviceConfigured !== 'boolean'
    )
      throw new IntegrationApiError(
        'INVALID_RESPONSE',
        false,
        'Сервер вернул неверный статус СБП.',
      );
    return {
      apiReachable: payload.apiReachable,
      configured: payload.configured,
      deviceConfigured: payload.deviceConfigured,
      provider: 'AQSI_SBP',
      ...(Number.isSafeInteger(payload.selectedDeviceId)
        ? { selectedDeviceId: payload.selectedDeviceId as number }
        : {}),
      ...(typeof payload.selectedDeviceName === 'string'
        ? { selectedDeviceName: payload.selectedDeviceName }
        : {}),
    };
  }

  async listAqsiDevices(
    baseUrl: string,
    deviceId: string,
    token: string,
    context: CrmChatRequestContext,
  ): Promise<AqsiDeviceList> {
    const payload = await this.request(
      baseUrl,
      'payments/aqsi/devices',
      deviceId,
      token,
      'GET',
      undefined,
      context,
    );
    return parseAqsiDevices(payload);
  }

  async selectAqsiDevice(
    baseUrl: string,
    sourceDeviceId: string,
    token: string,
    aqsiDeviceId: number,
    context: CrmChatRequestContext,
  ): Promise<AqsiDeviceSummary> {
    const payload = await this.request(
      baseUrl,
      'payments/aqsi/devices',
      sourceDeviceId,
      token,
      'PUT',
      { deviceId: aqsiDeviceId },
      context,
    );
    return parseAqsiDevice(payload);
  }

  async createSbpPayment(
    baseUrl: string,
    deviceId: string,
    token: string,
    operation: PaymentOperationSummary,
    context: CrmChatRequestContext,
  ): Promise<SbpGatewayPayment> {
    const payload = await this.request(
      baseUrl,
      'payments/sbp',
      deviceId,
      token,
      'POST',
      {
        amountKopecks: operation.amount,
        aravaOperationId: operation.id,
        branchId: operation.branchId,
        currency: operation.currency,
        idempotencyKey: operation.idempotencyKey,
        purpose: operation.purpose,
      },
      context,
    );
    return parseAqsiGatewayPayment(payload, operation);
  }

  async createAqsiPayment(
    baseUrl: string,
    deviceId: string,
    token: string,
    operation: PaymentOperationSummary,
    context: CrmChatRequestContext,
  ): Promise<AqsiGatewayPayment> {
    const payload = await this.request(
      baseUrl,
      'payments/aqsi',
      deviceId,
      token,
      'POST',
      {
        amountKopecks: operation.amount,
        aravaOperationId: operation.id,
        branchId: operation.branchId,
        currency: operation.currency,
        idempotencyKey: operation.idempotencyKey,
        paymentMethod: operation.providerType === 'ACQUIRING' ? 'CARD' : 'SBP',
        purpose: operation.purpose,
      },
      context,
    );
    return parseAqsiGatewayPayment(payload, operation);
  }

  async getSbpPayment(
    baseUrl: string,
    deviceId: string,
    token: string,
    operation: PaymentOperationSummary,
    context: CrmChatRequestContext,
  ): Promise<SbpGatewayPayment> {
    const payload = await this.request(
      baseUrl,
      `payments/${encodeURIComponent(operation.id)}`,
      deviceId,
      token,
      'GET',
      undefined,
      context,
    );
    return parseAqsiGatewayPayment(payload, operation);
  }

  async cancelSbpPayment(
    baseUrl: string,
    deviceId: string,
    token: string,
    operation: PaymentOperationSummary,
    context: CrmChatRequestContext,
  ): Promise<SbpGatewayPayment> {
    const payload = await this.request(
      baseUrl,
      `payments/${encodeURIComponent(operation.id)}/cancel`,
      deviceId,
      token,
      'POST',
      undefined,
      context,
    );
    return parseAqsiGatewayPayment(payload, operation);
  }

  async probeChat(
    baseUrl: string,
    deviceId: string,
    token: string,
    context: CrmChatRequestContext,
  ): Promise<void> {
    await this.probeEndpoint(baseUrl, 'chats?limit=1', deviceId, token, 'GET', context);
  }

  async probePublications(baseUrl: string, deviceId: string, token: string): Promise<void> {
    await this.probeEndpoint(baseUrl, 'publications/media', deviceId, token, 'OPTIONS');
  }

  private async probeEndpoint(
    baseUrl: string,
    path: string,
    deviceId: string,
    token: string,
    method: 'GET' | 'OPTIONS',
    context?: CrmChatRequestContext,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-ARAVA-API-Version': INTEGRATION_API_VERSION,
      'X-ARAVA-Device-ID': deviceId,
    };
    if (context) {
      headers['X-ARAVA-CRM-Context'] = Buffer.from(JSON.stringify(context), 'utf8').toString(
        'base64url',
      );
    }
    try {
      const response = await this.fetchImplementation(this.endpoint(baseUrl, path), {
        headers,
        method,
        signal: controller.signal,
      });
      if (response.ok || (method === 'OPTIONS' && response.status === 405)) return;
      const code =
        response.status === 401
          ? 'AUTH_REQUIRED'
          : response.status === 403
            ? 'ACCESS_DENIED'
            : response.status === 404
              ? 'ENDPOINT_NOT_FOUND'
              : `HTTP_${String(response.status)}`;
      throw new IntegrationApiError(
        code,
        response.status === 429 || response.status >= 500,
        'Сервис сайта недоступен.',
      );
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
          errorCount: typeof entry.errorCount === 'number' ? entry.errorCount : 0,
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
    currentDeviceId: string,
    token: string,
    targetDeviceId: string,
    input: Pick<IntegrationDeviceRenameInput, 'displayName'>,
    context: CrmChatRequestContext,
  ): Promise<void> {
    await this.request(
      baseUrl,
      `devices/${encodeURIComponent(targetDeviceId)}`,
      currentDeviceId,
      token,
      'PATCH',
      input,
      context,
    );
  }

  async revokeDevice(
    baseUrl: string,
    currentDeviceId: string,
    token: string,
    targetDeviceId: string,
    context: CrmChatRequestContext,
  ): Promise<void> {
    await this.request(
      baseUrl,
      `devices/${encodeURIComponent(targetDeviceId)}`,
      currentDeviceId,
      token,
      'DELETE',
      undefined,
      context,
    );
  }

  async listConflicts(
    baseUrl: string,
    deviceId: string,
    token: string,
    context: CrmChatRequestContext,
  ): Promise<IntegrationConflictSummary[]> {
    const payload = await this.request(
      baseUrl,
      'conflicts',
      deviceId,
      token,
      'GET',
      undefined,
      context,
    );
    if (!isRecord(payload) || !Array.isArray(payload.conflicts))
      throw new IntegrationApiError(
        'INVALID_RESPONSE',
        false,
        'Сервер вернул неверный список конфликтов.',
      );
    return payload.conflicts.map(parseManagedConflict);
  }

  async resolveConflict(
    baseUrl: string,
    deviceId: string,
    token: string,
    conflictId: string,
    input: IntegrationConflictResolutionInput,
    context: CrmChatRequestContext,
  ): Promise<IntegrationConflictSummary> {
    const payload = await this.request(
      baseUrl,
      `conflicts/${encodeURIComponent(conflictId)}/resolve`,
      deviceId,
      token,
      'POST',
      input,
      context,
    );
    if (!isRecord(payload))
      throw new IntegrationApiError(
        'INVALID_RESPONSE',
        false,
        'Сервер не подтвердил решение конфликта.',
      );
    return parseManagedConflict(payload.conflict);
  }

  async reconciliationPreview(
    baseUrl: string,
    deviceId: string,
    token: string,
    entities: { entityId: string; entityType: string; payloadHash: string }[],
    context: CrmChatRequestContext,
  ): Promise<IntegrationReconciliationPreview> {
    const payload = await this.request(
      baseUrl,
      'reconciliation/preview',
      deviceId,
      token,
      'POST',
      { entities },
      context,
    );
    return parseReconciliationPreview(payload);
  }

  async pruneJournal(
    baseUrl: string,
    deviceId: string,
    token: string,
    context: CrmChatRequestContext,
  ): Promise<IntegrationJournalMaintenanceResult> {
    const payload = await this.request(
      baseUrl,
      'maintenance/journal',
      deviceId,
      token,
      'POST',
      {},
      context,
    );
    if (
      !isRecord(payload) ||
      ![
        'activeDeviceCount',
        'deleted',
        'maximumCursor',
        'minimumAcknowledgedCursor',
        'safeThrough',
      ].every((key) => typeof payload[key] === 'number')
    )
      throw new IntegrationApiError(
        'INVALID_RESPONSE',
        false,
        'Сервер вернул неверный результат обслуживания журнала.',
      );
    return {
      activeDeviceCount: Number(payload.activeDeviceCount),
      deleted: Number(payload.deleted),
      maximumCursor: Number(payload.maximumCursor),
      minimumAcknowledgedCursor: Number(payload.minimumAcknowledgedCursor),
      safeThrough: Number(payload.safeThrough),
    };
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

  async listActions(baseUrl: string, deviceId: string, token: string): Promise<RemoteWebAction[]> {
    const payload = await this.request(baseUrl, 'actions', deviceId, token, 'GET');
    const entries = Array.isArray(payload)
      ? payload
      : isRecord(payload) && Array.isArray(payload.actions)
        ? payload.actions
        : [];
    return entries.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const actionPayload = isRecord(entry.payload) ? entry.payload : entry;
      const externalActionId = optionalString(entry.id) ?? optionalString(entry.externalActionId);
      if (!externalActionId) return [];
      const actionType =
        optionalString(entry.type) ?? optionalString(entry.actionType) ?? 'UNKNOWN';
      const receivedAt =
        optionalString(entry.createdAt) ??
        optionalString(entry.receivedAt) ??
        new Date(0).toISOString();
      const crmStudentId =
        optionalString(actionPayload.crmStudentId) ?? optionalString(actionPayload.studentId);
      const crmSubscriptionId =
        optionalString(actionPayload.crmSubscriptionId) ??
        optionalString(actionPayload.subscriptionId);
      const crmTrainerId = optionalString(actionPayload.crmTrainerId);
      const crmLessonId = optionalString(actionPayload.crmLessonId);
      const marks = Array.isArray(actionPayload.marks)
        ? actionPayload.marks.map((mark) => ({
            crmStudentId: isRecord(mark) ? (optionalString(mark.crmStudentId) ?? '') : '',
            status: isRecord(mark) ? (optionalString(mark.status) ?? '') : '',
          }))
        : undefined;
      const reason = optionalString(actionPayload.reason) ?? optionalString(entry.reason);
      const profilePayload = isRecord(entry.payload) ? entry.payload : entry;
      const profileAllowedKeys = new Set([
        'crmStudentId',
        'studentId',
        'firstName',
        'lastName',
        'phone',
        ...(isRecord(entry.payload)
          ? []
          : ['id', 'externalActionId', 'type', 'actionType', 'createdAt', 'receivedAt', 'reason']),
      ]);
      const profileFieldNames = ['firstName', 'lastName', 'phone'] as const;
      const profileChanges: { firstName?: string; lastName?: string; phone?: string } = {};
      let profilePayloadValid = Object.keys(profilePayload).every((key) =>
        profileAllowedKeys.has(key),
      );
      let profileFieldCount = 0;
      for (const field of profileFieldNames) {
        if (!Object.hasOwn(profilePayload, field)) continue;
        profileFieldCount += 1;
        const value = profilePayload[field];
        if (typeof value !== 'string') profilePayloadValid = false;
        else profileChanges[field] = value;
      }
      profilePayloadValid &&= profileFieldCount > 0;
      return [
        {
          actionType,
          externalActionId,
          ...(crmStudentId ? { crmStudentId } : {}),
          ...(crmSubscriptionId ? { crmSubscriptionId } : {}),
          ...(crmTrainerId ? { crmTrainerId } : {}),
          ...(crmLessonId ? { crmLessonId } : {}),
          ...(marks ? { marks } : {}),
          ...(actionType === 'CLIENT_PROFILE_UPDATE_REQUEST'
            ? { profileChanges, profilePayloadValid }
            : {}),
          ...(reason ? { reason: reason.slice(0, 500) } : {}),
          receivedAt,
        },
      ];
    });
  }

  async claimAction(baseUrl: string, deviceId: string, token: string, id: string): Promise<void> {
    await this.request(
      baseUrl,
      `actions/${encodeURIComponent(id)}/claim`,
      deviceId,
      token,
      'POST',
      {
        apiVersion: INTEGRATION_API_VERSION,
        deviceId,
      },
    );
  }

  async completeAction(
    baseUrl: string,
    deviceId: string,
    token: string,
    id: string,
    status: WebActionCompletionStatus,
    detail?: string,
  ): Promise<void> {
    await this.request(
      baseUrl,
      `actions/${encodeURIComponent(id)}/complete`,
      deviceId,
      token,
      'POST',
      {
        apiVersion: INTEGRATION_API_VERSION,
        ...(detail ? { result: { message: detail.slice(0, 300) } } : {}),
        status,
      },
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
  private readonly finance: FinanceService;
  private readonly studio: StudioService;

  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
    private readonly credentials: IntegrationCredentialStore,
    private readonly api = new IntegrationApiClient(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.finance = new FinanceService(database, application);
    this.studio = new StudioService(database, application);
  }

  private async assertOwner(token: string): Promise<AuthenticatedUser> {
    const actor = await this.application.authenticate(token);
    if (actor.role !== 'OWNER') {
      throw new DomainError('AUTHORIZATION', 'Настраивать интеграцию может только владелец.');
    }
    return actor;
  }

  private ownerContext(actor: AuthenticatedUser): CrmChatRequestContext {
    return {
      branchIds: actor.branchIds,
      name: actor.fullName,
      role: 'OWNER',
      userId: actor.id,
    };
  }

  private actorContext(actor: AuthenticatedUser): CrmChatRequestContext {
    return {
      branchIds: actor.branchIds,
      name: actor.fullName,
      role: actor.role,
      userId: actor.id,
    };
  }

  async sbpProviderHealth(token: string): Promise<SbpProviderHealth> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payments:manage');
    const connection = await this.integrationConnection();
    return this.api.paymentProviderHealth(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      this.actorContext(actor),
    );
  }

  async listAqsiDevices(token: string): Promise<AqsiDeviceList> {
    const actor = await this.assertOwner(token);
    const connection = await this.integrationConnection();
    const context = this.actorContext(actor);
    const [, devices] = await Promise.all([
      this.api.paymentProviderHealth(
        connection.baseUrl,
        connection.deviceId,
        connection.token,
        context,
      ),
      this.api.listAqsiDevices(connection.baseUrl, connection.deviceId, connection.token, context),
    ]);
    return devices;
  }

  async selectAqsiDevice(token: string, aqsiDeviceId: number): Promise<AqsiDeviceSummary> {
    const actor = await this.assertOwner(token);
    const connection = await this.integrationConnection();
    return this.api.selectAqsiDevice(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      aqsiDeviceId,
      this.actorContext(actor),
    );
  }

  async startSbpPayment(
    token: string,
    operation: PaymentOperationSummary,
  ): Promise<SbpGatewayPayment> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payments:manage');
    assertBranchAccess(actor, operation.branchId);
    const connection = await this.integrationConnection();
    return this.api.createSbpPayment(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      operation,
      this.actorContext(actor),
    );
  }

  async startAqsiPayment(
    token: string,
    operation: PaymentOperationSummary,
  ): Promise<AqsiGatewayPayment> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payments:manage');
    assertBranchAccess(actor, operation.branchId);
    const connection = await this.integrationConnection();
    return this.api.createAqsiPayment(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      operation,
      this.actorContext(actor),
    );
  }

  async refreshSbpPayment(
    token: string,
    operation: PaymentOperationSummary,
  ): Promise<SbpGatewayPayment> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payments:manage');
    assertBranchAccess(actor, operation.branchId);
    const connection = await this.integrationConnection();
    return this.api.getSbpPayment(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      operation,
      this.actorContext(actor),
    );
  }

  async refreshAqsiPayment(
    token: string,
    operation: PaymentOperationSummary,
  ): Promise<AqsiGatewayPayment> {
    return this.refreshSbpPayment(token, operation);
  }

  async cancelSbpPayment(
    token: string,
    operation: PaymentOperationSummary,
  ): Promise<SbpGatewayPayment> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payments:manage');
    assertBranchAccess(actor, operation.branchId);
    const connection = await this.integrationConnection();
    return this.api.cancelSbpPayment(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      operation,
      this.actorContext(actor),
    );
  }

  async cancelAqsiPayment(
    token: string,
    operation: PaymentOperationSummary,
  ): Promise<AqsiGatewayPayment> {
    return this.cancelSbpPayment(token, operation);
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
    await this.database.webAction.updateMany({
      data: { status: 'PENDING' },
      where: { status: 'CLAIMING' },
    });
  }

  private async integrationConnection(): Promise<{
    baseUrl: string;
    deviceId: string;
    token: string;
  }> {
    return this.chatConnection();
  }

  private async actionSummary(id: string, actor: AuthenticatedUser): Promise<WebActionSummary> {
    const action = await this.database.webAction.findUnique({ where: { id } });
    if (!action?.crmStudentId) throw new DomainError('NOT_FOUND', 'Заявка с сайта не найдена.');
    if (action.actionType === 'CLIENT_PROFILE_UPDATE_REQUEST') {
      const student = await this.database.student.findUnique({
        where: { id: action.crmStudentId },
      });
      const branchIds = accessibleBranchIds(actor);
      if (student && branchIds && !branchIds.includes(student.branchId))
        throw new DomainError('AUTHORIZATION', 'Нет доступа к филиалу этой заявки.');
      if (!student && branchIds)
        throw new DomainError('AUTHORIZATION', 'Нет доступа к этой заявке.');
      let requestedFields: ('firstName' | 'lastName' | 'phone')[] = [];
      try {
        const payload = action.payloadJson
          ? (JSON.parse(action.payloadJson) as unknown)
          : undefined;
        if (isRecord(payload) && isRecord(payload.changes)) {
          const changes = payload.changes;
          requestedFields = (['firstName', 'lastName', 'phone'] as const).filter((field) =>
            Object.hasOwn(changes, field),
          );
        }
      } catch {
        // A damaged payload is displayed without fields and rejected by the processor.
      }
      return {
        actionType: 'CLIENT_PROFILE_UPDATE_REQUEST',
        externalActionId: action.externalActionId,
        id: action.id,
        receivedAt: action.receivedAt.toISOString(),
        requestedFields,
        status: action.status as WebActionSummary['status'],
        studentId: action.crmStudentId,
        studentName: student ? `${student.lastName} ${student.firstName}` : 'Клиент не найден',
      };
    }
    if (action.actionType !== 'CLIENT_SUBSCRIPTION_FREEZE_REQUEST' || !action.crmSubscriptionId)
      throw new DomainError('NOT_FOUND', 'Заявка с сайта не найдена.');
    const subscription = await this.database.subscription.findUnique({
      include: { student: true, tariff: true },
      where: { id: action.crmSubscriptionId },
    });
    if (subscription?.studentId !== action.crmStudentId)
      throw new DomainError('VALIDATION', 'Абонемент не принадлежит указанному ученику.');
    const branchIds = accessibleBranchIds(actor);
    if (branchIds && !branchIds.includes(subscription.branchId))
      throw new DomainError('AUTHORIZATION', 'Нет доступа к филиалу этой заявки.');
    return {
      actionType: 'CLIENT_SUBSCRIPTION_FREEZE_REQUEST',
      externalActionId: action.externalActionId,
      id: action.id,
      ...(action.reason ? { reason: action.reason } : {}),
      receivedAt: action.receivedAt.toISOString(),
      status: action.status as WebActionSummary['status'],
      studentId: subscription.studentId,
      studentName: `${subscription.student.lastName} ${subscription.student.firstName}`,
      subscriptionId: subscription.id,
      subscriptionName: subscription.tariff.name,
    };
  }

  private async assertActionActor(token: string): Promise<AuthenticatedUser> {
    const actor = await this.application.authenticate(token);
    if (actor.role === 'COACH')
      throw new DomainError('AUTHORIZATION', 'Тренеру недоступны заявки с сайта.');
    return actor;
  }

  async listWebActions(token: string): Promise<WebActionSummary[]> {
    const actor = await this.assertActionActor(token);
    try {
      const connection = await this.integrationConnection();
      await this.pullWebActions(connection.baseUrl, connection.deviceId, connection.token);
    } catch {
      // Locally persisted actions remain available while the website is offline.
    }
    const branchIds = accessibleBranchIds(actor);
    const accessibleStudentIds = branchIds
      ? (
          await this.database.student.findMany({
            select: { id: true },
            where: { branchId: { in: branchIds } },
          })
        ).map(({ id }) => id)
      : [];
    const rows = await this.database.webAction.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 100,
      where: {
        actionType: {
          in: ['CLIENT_SUBSCRIPTION_FREEZE_REQUEST', 'CLIENT_PROFILE_UPDATE_REQUEST'],
        },
        crmStudentId: { not: null },
        ...(branchIds ? { crmStudentId: { in: accessibleStudentIds } } : {}),
      },
    });
    const summaries = await Promise.all(rows.map(({ id }) => this.actionSummary(id, actor)));
    return summaries;
  }

  private async claimLocalAction(id: string): Promise<void> {
    const action = await this.database.webAction.findUnique({ where: { id } });
    if (!action) throw new DomainError('NOT_FOUND', 'Заявка с сайта не найдена.');
    if (action.status === 'CLAIMED') return;
    if (action.status !== 'PENDING') throw new DomainError('CONFLICT', 'Заявка уже обработана.');
    const claimed = await this.database.webAction.updateMany({
      data: { status: 'CLAIMING' },
      where: { id, status: 'PENDING' },
    });
    if (claimed.count !== 1) throw new DomainError('CONFLICT', 'Заявка уже обрабатывается.');
    try {
      const connection = await this.integrationConnection();
      await this.api.claimAction(
        connection.baseUrl,
        connection.deviceId,
        connection.token,
        action.externalActionId,
      );
      await this.database.webAction.update({
        data: { claimedAt: this.now(), status: 'CLAIMED' },
        where: { id },
      });
    } catch (error) {
      await this.database.webAction.updateMany({
        data: { status: 'PENDING' },
        where: { id, status: 'CLAIMING' },
      });
      throw error;
    }
  }

  private async acknowledgeWebAction(id: string): Promise<void> {
    const action = await this.database.webAction.findUnique({ where: { id } });
    if (
      !action ||
      !['SUCCEEDED_ACK_PENDING', 'REJECTED_ACK_PENDING', 'FAILED_ACK_PENDING'].includes(
        action.status,
      )
    )
      return;
    const remoteStatus: WebActionCompletionStatus = action.status.startsWith('SUCCEEDED')
      ? 'SUCCEEDED'
      : action.status.startsWith('FAILED')
        ? 'FAILED'
        : 'REJECTED';
    try {
      const connection = await this.integrationConnection();
      await this.api.completeAction(
        connection.baseUrl,
        connection.deviceId,
        connection.token,
        action.externalActionId,
        remoteStatus,
        remoteStatus === 'SUCCEEDED' ? undefined : (action.safeError ?? undefined),
      );
      await this.database.webAction.update({
        data: {
          completionAttemptCount: { increment: 1 },
          nextCompletionAttemptAt: null,
          safeError: remoteStatus === 'SUCCEEDED' ? null : action.safeError,
          status: remoteStatus,
        },
        where: { id },
      });
    } catch {
      await this.database.webAction.update({
        data: {
          completionAttemptCount: { increment: 1 },
          nextCompletionAttemptAt: new Date(this.now().getTime() + 60_000),
        },
        where: { id },
      });
    }
  }

  async approveWebAction(
    token: string,
    id: string,
    input: SubscriptionFreezeInput,
  ): Promise<WebActionSummary> {
    const actor = await this.assertActionActor(token);
    const summary = await this.actionSummary(id, actor);
    if (summary.actionType !== 'CLIENT_SUBSCRIPTION_FREEZE_REQUEST')
      throw new DomainError('CONFLICT', 'Изменение данных клиента обрабатывается автоматически.');
    const action = await this.database.webAction.findUniqueOrThrow({ where: { id } });
    if (action.status === 'SUCCEEDED_ACK_PENDING') {
      await this.acknowledgeWebAction(id);
      return this.actionSummary(id, actor);
    }
    await this.claimLocalAction(id);
    await this.finance.freezeSubscription(token, summary.subscriptionId, input, {
      id,
      processedByUserId: actor.id,
    });
    await this.acknowledgeWebAction(id);
    return this.actionSummary(id, actor);
  }

  async rejectWebAction(token: string, id: string, reason?: string): Promise<WebActionSummary> {
    const actor = await this.assertActionActor(token);
    const summary = await this.actionSummary(id, actor);
    if (summary.actionType !== 'CLIENT_SUBSCRIPTION_FREEZE_REQUEST')
      throw new DomainError('CONFLICT', 'Изменение данных клиента обрабатывается автоматически.');
    const current = await this.database.webAction.findUniqueOrThrow({ where: { id } });
    if (current.status !== 'REJECTED_ACK_PENDING') {
      await this.claimLocalAction(id);
      const rejectedReason = reason?.trim().slice(0, 300);
      await this.database.webAction.update({
        data: {
          nextCompletionAttemptAt: this.now(),
          processedAt: this.now(),
          processedByUserId: actor.id,
          safeError: rejectedReason?.length ? rejectedReason : 'Отклонено администратором.',
          safeResultJson: JSON.stringify({ status: 'REJECTED' }),
          status: 'REJECTED_ACK_PENDING',
        },
        where: { id, status: 'CLAIMED' },
      });
    }
    await this.acknowledgeWebAction(id);
    return this.actionSummary(id, actor);
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

  async diagnose(token: string): Promise<IntegrationDiagnostics> {
    const actor = await this.assertOwner(token);
    const checkedAt = this.now().toISOString();
    const [deviceId, deviceToken, settings, outboxCounts, conflictCount] = await Promise.all([
      this.credentials.getDeviceId(),
      this.credentials.getToken(),
      this.database.appSetting.findMany({ where: { key: { startsWith: 'integration.' } } }),
      this.database.syncOutbox.groupBy({
        _count: true,
        by: ['status'],
        where: { status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
      }),
      this.database.syncConflict.count({ where: { status: 'OPEN' } }),
    ]);
    const values = new Map(settings.map(({ key, value }) => [key, value]));
    const count = (status: 'PENDING' | 'PROCESSING' | 'FAILED') =>
      outboxCounts.find((entry) => entry.status === status)?._count ?? 0;
    const pendingCount = count('PENDING') + count('PROCESSING');
    const failedCount = count('FAILED');
    const inboundCursor = Number(values.get(SETTINGS.inboundCursor) ?? 0);
    const lastInboundSync = values.get(SETTINGS.lastInboundSync);
    const lastOutboundSync = values.get(SETTINGS.lastOutboundSync);
    const enabled = values.get(SETTINGS.enabled) === 'true';
    const baseUrl = values.get(SETTINGS.baseUrl);
    const checks: IntegrationDiagnosticCheck[] = [
      diagnosticCheck(
        'device-identity',
        'Идентификатор устройства доступен',
        'WORKING',
        `Устройство ${deviceId.slice(0, 8)}… готово к проверке.`,
      ),
      diagnosticCheck(
        'outbox-access',
        'Исходящая очередь доступна',
        'WORKING',
        'Локальная очередь синхронизации читается без ошибок.',
      ),
      pendingCount > 0
        ? diagnosticCheck(
            'outbox-pending',
            'Изменения ожидают отправки',
            'WARNING',
            `${String(pendingCount)} изменений ещё не отправлено.`,
            'Запустите синхронизацию сейчас.',
          )
        : diagnosticCheck(
            'outbox-pending',
            'Очередь отправки обработана',
            'WORKING',
            'Ожидающих изменений нет.',
          ),
      failedCount > 0
        ? diagnosticCheck(
            'outbox-failed',
            'Есть ошибки отправки',
            'ERROR',
            `${String(failedCount)} изменений завершились ошибкой.`,
            'Запустите синхронизацию сейчас и проверьте результат.',
          )
        : diagnosticCheck(
            'outbox-failed',
            'Ошибок отправки нет',
            'WORKING',
            'В исходящей очереди нет ошибочных операций.',
          ),
      diagnosticCheck(
        'outbound-last-success',
        'Последняя исходящая синхронизация',
        lastOutboundSync ? 'WORKING' : 'WARNING',
        lastOutboundSync
          ? `Успешно: ${new Date(lastOutboundSync).toLocaleString('ru-RU')}.`
          : 'Исходящая синхронизация ещё не выполнялась.',
        lastOutboundSync ? undefined : 'Запустите синхронизацию сейчас.',
      ),
      diagnosticCheck(
        'inbound-cursor',
        'Состояние входящей синхронизации доступно',
        'WORKING',
        `Текущая позиция входящего журнала: ${String(inboundCursor)}.`,
      ),
      diagnosticCheck(
        'inbound-last-success',
        'Последняя входящая синхронизация',
        lastInboundSync ? 'WORKING' : 'WARNING',
        lastInboundSync
          ? `Успешно: ${new Date(lastInboundSync).toLocaleString('ru-RU')}.`
          : 'Входящая синхронизация ещё не выполнялась.',
        lastInboundSync ? undefined : 'Запустите синхронизацию сейчас.',
      ),
      conflictCount > 0
        ? diagnosticCheck(
            'conflicts',
            'Есть неразрешённые конфликты',
            'WARNING',
            `Открытых конфликтов: ${String(conflictCount)}.`,
            'Разрешите конфликты перед дальнейшей работой.',
          )
        : diagnosticCheck(
            'conflicts',
            'Неразрешённых конфликтов нет',
            'WORKING',
            'Открытые конфликты не обнаружены.',
          ),
      values.get(SETTINGS.lastState) === 'RECONCILIATION_REQUIRED'
        ? diagnosticCheck(
            'reconciliation',
            'Требуется безопасная сверка данных',
            'WARNING',
            'На устройстве и сервере есть независимо заполненные данные.',
            'Откройте сверку данных и подтвердите безопасное согласование.',
          )
        : diagnosticCheck(
            'reconciliation',
            'Первичное состояние согласовано',
            'WORKING',
            'Опасная несогласованная инициализация не обнаружена.',
          ),
    ];
    let displayName: string | undefined;
    const unavailableRemoteChecks = (detail: string, action: string) => {
      for (const [id, label] of [
        ['server', 'Сервер доступен'],
        ['integration-health', 'Сервис синхронизации отвечает'],
        ['api-version', 'Версия API совместима'],
        ['device-auth', 'Устройство авторизовано'],
        ['device-status', 'Устройство не отозвано'],
        ['device-recognized', 'Сервер распознаёт это устройство'],
        ['chat-api', 'Сервис чатов доступен'],
        ['publication-api', 'Сервис публикаций доступен'],
        ['aqsi-configured', 'API aQsi настроен'],
        ['aqsi-reachable', 'API aQsi доступен'],
        ['aqsi-device', 'Касса aQsi выбрана'],
      ] as const) {
        checks.push(diagnosticCheck(id, label, 'WARNING', detail, action));
      }
    };

    if (!enabled) {
      unavailableRemoteChecks(
        'Интеграция выключена, удалённые проверки не выполнялись.',
        'Включите интеграцию в настройках.',
      );
    } else if (!baseUrl || !deviceToken) {
      unavailableRemoteChecks(
        'Устройство ещё не подключено к сайту.',
        'Подключите устройство с помощью кода подключения.',
      );
    } else {
      let remoteReady = false;
      try {
        const health = await this.api.inspectHealth(baseUrl, deviceId, deviceToken);
        checks.push(
          diagnosticCheck('server', 'Сервер доступен', 'WORKING', 'Сервер ARAVA-WEB ответил.'),
          diagnosticCheck(
            'integration-health',
            'Сервис синхронизации отвечает',
            'WORKING',
            'Проверка состояния интеграции выполнена.',
          ),
          health.apiVersion === INTEGRATION_API_VERSION
            ? diagnosticCheck(
                'api-version',
                'Версия API совместима',
                'WORKING',
                `Используется API ${INTEGRATION_API_VERSION}.`,
              )
            : diagnosticCheck(
                'api-version',
                'Версия API несовместима',
                'ERROR',
                `CRM ожидает ${INTEGRATION_API_VERSION}, сервер сообщил ${health.apiVersion}.`,
                'Обновите CRM или ARAVA-WEB до совместимых версий.',
              ),
          diagnosticCheck(
            'device-auth',
            'Устройство авторизовано',
            'WORKING',
            'Сервер принял текущую авторизацию устройства.',
          ),
        );
        if (health.deviceStatus === 'ACTIVE') {
          checks.push(
            diagnosticCheck(
              'device-status',
              'Устройство не отозвано',
              'WORKING',
              'Статус устройства на сервере: активно.',
            ),
          );
        } else if (health.deviceStatus === 'REVOKED') {
          checks.push(
            diagnosticCheck(
              'device-status',
              'Устройство отозвано',
              'ERROR',
              'Сервер запретил синхронизацию этого устройства.',
              'Подключите устройство заново.',
            ),
          );
        } else {
          checks.push(
            diagnosticCheck(
              'device-status',
              'Статус устройства требует проверки',
              'WARNING',
              'Сервер не подтвердил активный статус устройства.',
              'Проверьте устройство на сервере или подключите его заново.',
            ),
          );
        }
        remoteReady = health.apiVersion === INTEGRATION_API_VERSION;
      } catch (error) {
        const failure = diagnosticFailure(error);
        const serverReached =
          error instanceof IntegrationApiError &&
          error.errorCode !== 'NETWORK_UNAVAILABLE' &&
          error.errorCode !== 'TIMEOUT';
        checks.push(
          diagnosticCheck(
            'server',
            'Сервер доступен',
            serverReached ? 'WORKING' : 'ERROR',
            serverReached ? 'Сервер ответил, но отклонил запрос.' : failure.detail,
            serverReached ? undefined : failure.action,
          ),
          diagnosticCheck(
            'integration-health',
            'Сервис синхронизации отвечает',
            'ERROR',
            failure.detail,
            failure.action,
          ),
          diagnosticCheck(
            'api-version',
            'Версия API совместима',
            'WARNING',
            'Версию API не удалось проверить.',
            failure.action,
          ),
          diagnosticCheck(
            'device-auth',
            'Устройство авторизовано',
            'ERROR',
            failure.detail,
            failure.action,
          ),
          diagnosticCheck(
            'device-status',
            'Устройство не отозвано',
            'WARNING',
            'Статус устройства не удалось проверить.',
            failure.action,
          ),
        );
      }

      if (remoteReady) {
        try {
          const devices = await this.api.listDevices(baseUrl, deviceId, deviceToken);
          const currentDevice = devices.find((device) => device.deviceId === deviceId);
          displayName = currentDevice?.displayName ?? currentDevice?.name;
          if (!currentDevice) {
            checks.push(
              diagnosticCheck(
                'device-recognized',
                'Сервер не распознаёт это устройство',
                'ERROR',
                'Текущий идентификатор отсутствует в списке устройств сервера.',
                'Подключите устройство заново.',
              ),
            );
          } else if (currentDevice.status === 'REVOKED') {
            checks.push(
              diagnosticCheck(
                'device-recognized',
                'Устройство отозвано',
                'ERROR',
                'Сервер распознал устройство, но его доступ отозван.',
                'Подключите устройство заново.',
              ),
            );
          } else {
            checks.push(
              diagnosticCheck(
                'device-recognized',
                'Сервер распознаёт это устройство',
                'WORKING',
                'Идентификатор устройства найден среди активных подключений.',
              ),
            );
          }
        } catch (error) {
          const failure = diagnosticFailure(error);
          checks.push(
            diagnosticCheck(
              'device-recognized',
              'Сервер распознаёт это устройство',
              'ERROR',
              failure.detail,
              failure.action,
            ),
          );
        }

        const context: CrmChatRequestContext = {
          branchIds: actor.branchIds,
          name: actor.fullName,
          role: actor.role,
          userId: actor.id,
        };
        const [chatProbe, publicationProbe, paymentProbe] = await Promise.allSettled([
          this.api.probeChat(baseUrl, deviceId, deviceToken, context),
          this.api.probePublications(baseUrl, deviceId, deviceToken),
          this.api.paymentProviderHealth(baseUrl, deviceId, deviceToken, context),
        ]);
        for (const [id, label, result] of [
          ['chat-api', 'Сервис чатов доступен', chatProbe],
          ['publication-api', 'Сервис публикаций доступен', publicationProbe],
        ] as const) {
          if (result.status === 'fulfilled') {
            checks.push(
              diagnosticCheck(
                id,
                label,
                'WORKING',
                'Защищённый endpoint ответил без записи данных.',
              ),
            );
          } else {
            const failure = diagnosticFailure(result.reason);
            checks.push(diagnosticCheck(id, label, 'ERROR', failure.detail, failure.action));
          }
        }
        if (paymentProbe.status === 'fulfilled') {
          const health = paymentProbe.value;
          checks.push(
            health.configured
              ? diagnosticCheck(
                  'aqsi-configured',
                  'API aQsi настроен',
                  'WORKING',
                  'API-ключ aQsi задан на сервере.',
                )
              : diagnosticCheck(
                  'aqsi-configured',
                  'API aQsi не настроен',
                  'WARNING',
                  'На сервере не задан AQSI_API_KEY.',
                  'Настройте API-ключ aQsi на ARAVA-WEB.',
                ),
            health.apiReachable
              ? diagnosticCheck(
                  'aqsi-reachable',
                  'API aQsi доступен',
                  'WORKING',
                  'aQsi ответил на безопасный запрос списка касс.',
                )
              : diagnosticCheck(
                  'aqsi-reachable',
                  'API aQsi недоступен',
                  'WARNING',
                  'Не удалось связаться с aQsi.',
                  'Проверьте интернет и настройки aQsi на сервере.',
                ),
            health.deviceConfigured
              ? diagnosticCheck(
                  'aqsi-device',
                  'Касса aQsi выбрана',
                  'WORKING',
                  health.selectedDeviceName ??
                    `Выбрана касса #${String(health.selectedDeviceId ?? '')}.`,
                )
              : diagnosticCheck(
                  'aqsi-device',
                  'Касса aQsi не выбрана',
                  'WARNING',
                  'Оплата не начнётся без выбранной физической кассы.',
                  'Выберите кассу aQsi в настройках интеграции.',
                ),
          );
        } else {
          const failure = diagnosticFailure(paymentProbe.reason);
          for (const [id, label] of [
            ['aqsi-configured', 'API aQsi настроен'],
            ['aqsi-reachable', 'API aQsi доступен'],
            ['aqsi-device', 'Касса aQsi выбрана'],
          ] as const)
            checks.push(diagnosticCheck(id, label, 'WARNING', failure.detail, failure.action));
        }
      } else {
        for (const [id, label] of [
          ['device-recognized', 'Сервер распознаёт это устройство'],
          ['chat-api', 'Сервис чатов доступен'],
          ['publication-api', 'Сервис публикаций доступен'],
          ['aqsi-configured', 'API aQsi настроен'],
          ['aqsi-reachable', 'API aQsi доступен'],
          ['aqsi-device', 'Касса aQsi выбрана'],
        ] as const) {
          if (checks.some((check) => check.id === id)) continue;
          checks.push(
            diagnosticCheck(
              id,
              label,
              'WARNING',
              'Проверка пропущена из-за недоступной или несовместимой интеграции.',
              'Исправьте основное подключение и повторите диагностику.',
            ),
          );
        }
      }
    }

    const overall = checks.some(({ status }) => status === 'ERROR')
      ? 'ERROR'
      : checks.some(({ status }) => status === 'WARNING')
        ? 'WARNING'
        : 'HEALTHY';
    return {
      checkedAt,
      checks,
      device: { deviceId, ...(displayName ? { displayName } : {}) },
      overall,
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
    const actor = await this.assertOwner(token);
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
    const currentDeviceId = await this.credentials.getDeviceId();
    await this.api.renameDevice(
      baseUrl,
      currentDeviceId,
      tokenValue,
      input.deviceId,
      { displayName },
      this.ownerContext(actor),
    );
    return this.systemStatus();
  }

  async revokeDevice(token: string, targetDeviceId: string): Promise<IntegrationStatus> {
    const actor = await this.assertOwner(token);
    const connection = await this.integrationConnection();
    if (connection.deviceId === targetDeviceId)
      throw new DomainError('CONFLICT', 'Текущее устройство нельзя отозвать из этого окна.');
    await this.api.revokeDevice(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      targetDeviceId,
      this.ownerContext(actor),
    );
    return this.systemStatus();
  }

  async listConflicts(token: string): Promise<IntegrationConflictSummary[]> {
    const actor = await this.assertOwner(token);
    const connection = await this.integrationConnection();
    return this.api.listConflicts(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      this.ownerContext(actor),
    );
  }

  async resolveConflict(
    token: string,
    conflictId: string,
    input: IntegrationConflictResolutionInput,
  ): Promise<IntegrationConflictSummary> {
    const actor = await this.assertOwner(token);
    const connection = await this.integrationConnection();
    const resolved = await this.api.resolveConflict(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      conflictId,
      input,
      this.ownerContext(actor),
    );
    await this.database.syncConflict.updateMany({
      data: { resolvedAt: this.now(), status: 'RESOLVED' },
      where: { serverConflictId: conflictId },
    });
    await this.processPending();
    return resolved;
  }

  async pruneJournal(token: string): Promise<IntegrationJournalMaintenanceResult> {
    const actor = await this.assertOwner(token);
    const connection = await this.integrationConnection();
    return this.api.pruneJournal(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      this.ownerContext(actor),
    );
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

  async reconciliationPreview(token: string): Promise<IntegrationReconciliationPreview> {
    const actor = await this.assertOwner(token);
    const connection = await this.integrationConnection();
    const rows = await this.reconciliationRows();
    const entities = [] as { entityId: string; entityType: string; payloadHash: string }[];
    for (const row of rows) {
      const envelope = await this.buildEnvelope(
        row.entityType,
        row.entityId,
        'UPSERT',
        `reconciliation-preview:${row.entityType}:${row.entityId}`,
        0,
      );
      entities.push({
        entityId: row.entityId,
        entityType: row.entityType,
        payloadHash: createHash('sha256')
          .update(stableJson({ operation: envelope.operation, payload: envelope.payload }))
          .digest('hex'),
      });
    }
    return this.api.reconciliationPreview(
      connection.baseUrl,
      connection.deviceId,
      connection.token,
      entities,
      this.ownerContext(actor),
    );
  }

  async confirmReconciliation(token: string): Promise<IntegrationStatus> {
    await this.assertOwner(token);
    const preview = await this.reconciliationPreview(token);
    if (preview.ambiguous.length > 0)
      throw new DomainError(
        'CONFLICT',
        'Сверка содержит неоднозначные записи. Автоматическое объединение запрещено.',
      );
    await this.setSetting(SETTINGS.reconciliationApproved, 'true');
    await this.queueInitialSync();
    await this.processPending();
    return this.systemStatus();
  }

  private async reconciliationRows(): Promise<{ entityId: string; entityType: SyncEntityType }[]> {
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
      publications,
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
      this.database.publication.findMany({ select: { id: true } }),
    ]);
    const map = (rows: { id: string }[], entityType: SyncEntityType) =>
      rows.map(({ id }) => ({ entityId: id, entityType }));
    return [
      ...map(branches, 'BRANCH'),
      ...map(rooms, 'ROOM'),
      ...map(trainers, 'TRAINER'),
      ...map(groups, 'GROUP'),
      ...map(students, 'STUDENT_IDENTITY'),
      ...map(contacts, 'STUDENT_CONTACT'),
      ...map(memberships, 'GROUP_MEMBERSHIP'),
      ...map(schedules, 'SCHEDULE'),
      ...map(lessons, 'LESSON'),
      ...map(substitutions, 'SUBSTITUTION'),
      ...map(cards, 'CARD'),
      ...map(tariffs, 'TARIFF'),
      ...map(subscriptions, 'SUBSCRIPTION'),
      ...map(ledgers, 'SUBSCRIPTION_LEDGER'),
      ...attendance.map(({ lessonId, studentId }) => ({
        entityId: `${lessonId}:${studentId}`,
        entityType: 'ATTENDANCE' as const,
      })),
      ...map(notes, 'STUDENT_NOTE'),
      ...map(publications, 'PUBLICATION'),
    ];
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
      await this.pullWebActions(baseUrl, deviceId, token);
      await this.processTrainerAttendanceActions();
      await this.processClientProfileUpdateActions();
      const acknowledgements = await this.database.webAction.findMany({
        select: { id: true },
        where: {
          nextCompletionAttemptAt: { lte: this.now() },
          status: {
            in: ['SUCCEEDED_ACK_PENDING', 'REJECTED_ACK_PENDING', 'FAILED_ACK_PENDING'],
          },
        },
      });
      for (const acknowledgement of acknowledgements) {
        await this.acknowledgeWebAction(acknowledgement.id);
      }
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

  private async pullWebActions(baseUrl: string, deviceId: string, token: string): Promise<void> {
    let actions: RemoteWebAction[];
    try {
      actions = await this.api.listActions(baseUrl, deviceId, token);
    } catch {
      return;
    }
    for (const action of actions) {
      const validFreeze =
        action.actionType === 'CLIENT_SUBSCRIPTION_FREEZE_REQUEST' &&
        Boolean(action.crmStudentId) &&
        Boolean(action.crmSubscriptionId) &&
        !Number.isNaN(Date.parse(action.receivedAt));
      const validAttendance =
        action.actionType === 'TRAINER_ATTENDANCE_SUBMIT' &&
        Boolean(action.crmTrainerId) &&
        Boolean(action.crmLessonId) &&
        Array.isArray(action.marks) &&
        action.marks.length > 0 &&
        !Number.isNaN(Date.parse(action.receivedAt));
      const recognizedProfileUpdate =
        action.actionType === 'CLIENT_PROFILE_UPDATE_REQUEST' &&
        Boolean(action.crmStudentId) &&
        !Number.isNaN(Date.parse(action.receivedAt));
      if (!validFreeze && !validAttendance && !recognizedProfileUpdate) {
        try {
          await this.api.claimAction(baseUrl, deviceId, token, action.externalActionId);
          await this.api.completeAction(
            baseUrl,
            deviceId,
            token,
            action.externalActionId,
            'REJECTED',
            'Тип или данные заявки не поддерживаются CRM.',
          );
        } catch {
          // The next polling cycle will receive and safely retry this remote action.
        }
        continue;
      }
      if (recognizedProfileUpdate) {
        const crmStudentId = action.crmStudentId;
        if (!crmStudentId) continue;
        await this.database.webAction.upsert({
          create: {
            actionType: action.actionType,
            crmStudentId,
            externalActionId: action.externalActionId,
            payloadJson: JSON.stringify({
              changes: action.profileChanges ?? {},
              valid: action.profilePayloadValid === true,
            }),
            receivedAt: new Date(action.receivedAt),
          },
          update: {},
          where: { externalActionId: action.externalActionId },
        });
        continue;
      }
      if (validAttendance) {
        const crmTrainerId = action.crmTrainerId;
        const crmLessonId = action.crmLessonId;
        if (!crmTrainerId || !crmLessonId) continue;
        await this.database.webAction.upsert({
          create: {
            actionType: action.actionType,
            crmLessonId,
            crmTrainerId,
            externalActionId: action.externalActionId,
            payloadJson: JSON.stringify({ marks: action.marks }),
            receivedAt: new Date(action.receivedAt),
          },
          update: {},
          where: { externalActionId: action.externalActionId },
        });
        continue;
      }
      const crmStudentId = action.crmStudentId;
      const crmSubscriptionId = action.crmSubscriptionId;
      if (!crmStudentId || !crmSubscriptionId) continue;
      await this.database.webAction.upsert({
        create: {
          actionType: action.actionType,
          crmStudentId,
          crmSubscriptionId,
          externalActionId: action.externalActionId,
          ...(action.reason ? { reason: action.reason } : {}),
          receivedAt: new Date(action.receivedAt),
        },
        update: {},
        where: { externalActionId: action.externalActionId },
      });
    }
  }

  private async processTrainerAttendanceActions(): Promise<void> {
    const actions = await this.database.webAction.findMany({
      orderBy: { receivedAt: 'asc' },
      where: {
        actionType: 'TRAINER_ATTENDANCE_SUBMIT',
        status: { in: ['PENDING', 'CLAIMED'] },
      },
    });
    for (const action of actions) {
      try {
        if (action.status === 'PENDING') await this.claimLocalAction(action.id);
        const payload = action.payloadJson
          ? (JSON.parse(action.payloadJson) as unknown)
          : undefined;
        if (
          !action.crmTrainerId ||
          !action.crmLessonId ||
          !isRecord(payload) ||
          !Array.isArray(payload.marks)
        )
          throw new DomainError('VALIDATION', 'Данные посещаемости повреждены.');
        const marks = payload.marks.map((mark) => {
          if (!isRecord(mark))
            throw new DomainError('VALIDATION', 'Данные отметки посещаемости повреждены.');
          const studentId = optionalString(mark.crmStudentId);
          const remoteStatus = optionalString(mark.status);
          if (!studentId || !remoteStatus || !['PRESENT', 'ABSENT', 'ILL'].includes(remoteStatus))
            throw new DomainError('VALIDATION', 'Статус посещаемости не поддерживается.');
          if (remoteStatus === 'PRESENT') return { status: 'PRESENT' as const, studentId };
          if (remoteStatus === 'ABSENT') return { status: 'ABSENT' as const, studentId };
          return { status: 'EXCUSED' as const, studentId };
        });
        if (new Set(marks.map(({ studentId }) => studentId)).size !== marks.length)
          throw new DomainError('VALIDATION', 'Один ученик указан в заявке несколько раз.');
        await this.studio.processTrainerWebAttendance(
          action.crmTrainerId,
          action.crmLessonId,
          marks,
          action.id,
        );
        await this.acknowledgeWebAction(action.id);
      } catch (error) {
        const current = await this.database.webAction.findUnique({ where: { id: action.id } });
        if (current?.status !== 'CLAIMED') continue;
        const authoritativeRejection = error instanceof DomainError;
        await this.database.webAction.update({
          data: {
            nextCompletionAttemptAt: this.now(),
            processedAt: this.now(),
            processedByUserId: action.crmTrainerId,
            safeError: authoritativeRejection
              ? error.message.slice(0, 300)
              : 'Не удалось безопасно применить посещаемость.',
            safeResultJson: JSON.stringify({
              status: authoritativeRejection ? 'REJECTED' : 'FAILED',
            }),
            status: authoritativeRejection ? 'REJECTED_ACK_PENDING' : 'FAILED_ACK_PENDING',
          },
          where: { id: action.id, status: 'CLAIMED' },
        });
        await this.acknowledgeWebAction(action.id);
      }
    }
  }

  private async processClientProfileUpdateActions(): Promise<void> {
    const actions = await this.database.webAction.findMany({
      orderBy: { receivedAt: 'asc' },
      where: {
        actionType: 'CLIENT_PROFILE_UPDATE_REQUEST',
        status: { in: ['PENDING', 'CLAIMED'] },
      },
    });
    for (const action of actions) {
      try {
        if (action.status === 'PENDING') await this.claimLocalAction(action.id);
        const payload = action.payloadJson
          ? (JSON.parse(action.payloadJson) as unknown)
          : undefined;
        if (
          !action.crmStudentId ||
          !isRecord(payload) ||
          payload.valid !== true ||
          !isRecord(payload.changes)
        )
          throw new DomainError('VALIDATION', 'Данные изменения профиля не поддерживаются.');
        const allowed = new Set(['firstName', 'lastName', 'phone']);
        const entries = Object.entries(payload.changes);
        if (
          entries.length === 0 ||
          entries.some(([key, value]) => !allowed.has(key) || typeof value !== 'string')
        )
          throw new DomainError('VALIDATION', 'Данные изменения профиля не поддерживаются.');
        const changes: { firstName?: string; lastName?: string; phone?: string } = {};
        for (const [key, value] of entries) {
          if (key === 'firstName') changes.firstName = value as string;
          if (key === 'lastName') changes.lastName = value as string;
          if (key === 'phone') changes.phone = value as string;
        }
        await this.application.processClientProfileWebAction(
          action.id,
          action.crmStudentId,
          changes,
        );
        await this.acknowledgeWebAction(action.id);
      } catch (error) {
        const current = await this.database.webAction.findUnique({ where: { id: action.id } });
        if (current?.status !== 'CLAIMED') continue;
        const authoritativeRejection = error instanceof DomainError;
        await this.database.webAction.update({
          data: {
            nextCompletionAttemptAt: this.now(),
            processedAt: this.now(),
            processedByUserId: 'WEB_INTEGRATION',
            safeError: authoritativeRejection
              ? error.message.slice(0, 300)
              : 'Не удалось безопасно изменить данные клиента.',
            safeResultJson: JSON.stringify({
              status: authoritativeRejection ? 'REJECTED' : 'FAILED',
            }),
            status: authoritativeRejection ? 'REJECTED_ACK_PENDING' : 'FAILED_ACK_PENDING',
          },
          where: { id: action.id, status: 'CLAIMED' },
        });
        await this.acknowledgeWebAction(action.id);
      }
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
        const [knownEntities, localEntities, reconciliationApproved] = await Promise.all([
          this.database.syncEntityState.count(),
          this.countLocalOperationalEntities(),
          this.setting(SETTINGS.reconciliationApproved),
        ]);
        if (knownEntities === 0 && localEntities > 0 && reconciliationApproved !== 'true') {
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
        ...(cursor > 0
          ? [
              this.database.appSetting.deleteMany({
                where: { key: SETTINGS.reconciliationApproved },
              }),
            ]
          : []),
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
            phone: nullableString(payload.phone),
            trainerDescription: nullableString(payload.description),
          },
          update: {
            fullName,
            isActive: booleanValue(payload.isActive),
            phone: nullableString(payload.phone),
            trainerDescription: nullableString(payload.description),
          },
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
            coachedGroups: {
              select: { direction: true, id: true },
              where: { archivedAt: null, status: { not: 'ARCHIVED' } },
            },
          },
          where: { id: entityId },
        });
        return row
          ? {
              activeGroupIds: row.coachedGroups.map(({ id }) => id),
              branchIds: row.branchAssignments.map(({ branchId }) => branchId),
              directions: [...new Set(row.coachedGroups.map(({ direction }) => direction))],
              displayName: row.fullName,
              description: row.trainerDescription,
              id: row.id,
              isActive: row.isActive && row.role === 'COACH',
              phone: row.phone,
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
