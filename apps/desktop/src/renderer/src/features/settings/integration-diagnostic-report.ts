import type { IntegrationDiagnostics, IntegrationStatus } from '@arava/shared';

function value(input?: string | number): string {
  return input === undefined || input === '' ? 'нет данных' : String(input);
}

const SUMMARY_MAX_LINES = 100;

function compact(input: string, maxLength = 240): string {
  const normalized = input.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

export function buildIntegrationDiagnosticSummary(
  status: IntegrationStatus,
  diagnostics: IntegrationDiagnostics,
): string {
  const items = diagnostics.permanentFailures.items;
  const originCounts = new Map<string, number>();
  const timestampCounts = new Map<string, number>();
  const groups = new Map<
    string,
    {
      count: number;
      entities: Map<string, number>;
      examples: typeof items;
      failureCode: string;
      failureDetail: string;
      operation: string;
      origin: string;
      payloadVersion: number;
    }
  >();

  for (const item of items) {
    originCounts.set(item.origin, (originCounts.get(item.origin) ?? 0) + 1);
    timestampCounts.set(item.createdAt, (timestampCounts.get(item.createdAt) ?? 0) + 1);
    const key = [
      item.origin,
      item.operation,
      String(item.payloadVersion),
      item.failureCode,
      item.failureDetail,
    ].join('\u0000');
    const group = groups.get(key) ?? {
      count: 0,
      entities: new Map<string, number>(),
      examples: [],
      failureCode: item.failureCode,
      failureDetail: item.failureDetail,
      operation: item.operation,
      origin: item.origin,
      payloadVersion: item.payloadVersion,
    };
    group.count += 1;
    group.entities.set(item.entityType, (group.entities.get(item.entityType) ?? 0) + 1);
    if (group.examples.length < 3) group.examples.push(item);
    groups.set(key, group);
  }

  const sortedOrigins = [...originCounts.entries()].sort((a, b) => b[1] - a[1]);
  const sortedTimestamps = [...timestampCounts.entries()].sort((a, b) => b[1] - a[1]);
  const sortedGroups = [...groups.values()].sort((a, b) => b.count - a.count);
  const authority = status.websiteAuthority;
  const lines = [
    'ARAVA CRM — краткая forensic-диагностика SyncOutbox',
    `Сформировано: ${diagnostics.checkedAt}`,
    `Устройство: ${value(status.currentDeviceName ?? diagnostics.device.displayName)} (${status.deviceId})`,
    '',
    '[Текущее состояние]',
    `Canonical: ${status.connectionState} / ${status.canonicalSyncHealth}`,
    `Последняя canonical sync: ${value(status.lastCanonicalSyncSuccess)}`,
    `Последний health-check: ${value(status.lastSuccessfulHealthCheck)}`,
    `Pending=${String(status.pendingCount)}; processing=${String(status.processingCount)}; retryable=${String(status.retryableFailedCount)}; permanent FAILED=${String(status.failedCount)}`,
    `Текущая transport-ошибка: ${value(status.lastErrorCode)} | ${compact(value(status.lastError))}`,
    '',
    '[Website publication, отдельно от canonical]',
    `Health=${status.websitePublicationHealth}; authority=${authority.state}; thisDevice=${authority.isCurrentDeviceAuthoritative ? 'authoritative' : 'non-authoritative'}`,
    `Текущие website pending/processing=${String(status.websitePendingCount)}`,
    `Исторические website-related permanent FAILED=${String(status.websiteFailedCount ?? 0)}`,
    `Последняя успешная публикация=${value(authority.lastSuccessfulWebsiteSync)}`,
    'Примечание: website pending больше не включает permanent FAILED; эти показатели нельзя складывать как одну активную очередь.',
    '',
    '[Root cause evidence]',
    `Всего permanent FAILED: ${String(diagnostics.permanentFailures.total)}`,
    `Origin: ${sortedOrigins.map(([origin, count]) => `${origin}=${String(count)}`).join(', ') || 'нет'}`,
    `Общий timestamp: ${sortedTimestamps[0] ? `${sortedTimestamps[0][0]} (${String(sortedTimestamps[0][1])})` : 'нет'}`,
    `Persisted failure groups: ${String(sortedGroups.length)}`,
    items.length === 0
      ? 'Вывод: permanent FAILED отсутствуют.'
      : 'Вывод: точная причина приведена ниже из persisted SyncLog. Origin показывает операцию, создавшую mutation; это не сетевой диагноз.',
    '',
    '[Классификация и безопасное действие]',
    'A already represented server-side: 0 подтверждено',
    'B replayable local mutation: 0 подтверждено',
    'C invalid historical mutation: 0 подтверждено',
    'D incompatible/corrupt mutation: 0 подтверждено',
    `UNCLASSIFIED: ${String(diagnostics.permanentFailures.total)}`,
    'Разрешённое действие сейчас: HOLD. До сравнения с canonical server journal/read model не RESOLVE, не REPLAY, не QUARANTINE.',
    'Наличие отсутствующих server-side данных: НЕ УСТАНОВЛЕНО.',
    '',
    '[Группы по persisted причине]',
  ];

  let omittedGroups = 0;
  for (const [index, group] of sortedGroups.entries()) {
    const entityCounts = [...group.entities.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([entityType, count]) => `${entityType}=${String(count)}`)
      .join(', ');
    const groupLines = [
      `#${String(index + 1)} count=${String(group.count)} | code=${compact(group.failureCode, 80)} | origin=${group.origin} | operation=${group.operation} | payloadVersion=${String(group.payloadVersion)} | classification=UNCLASSIFIED`,
      `entities: ${entityCounts}`,
      `persisted reason: ${compact(group.failureDetail)}`,
      ...group.examples.map(
        (item, exampleIndex) =>
          `example ${String(exampleIndex + 1)}: ${item.entityType} | created=${item.createdAt} | attempts=${String(item.attemptCount)} | payload=${item.payloadState}/v${String(item.payloadVersion)} | hash=${item.payloadHash.slice(0, 12)}`,
      ),
    ];
    if (lines.length + groupLines.length + 3 > SUMMARY_MAX_LINES) {
      omittedGroups = sortedGroups.length - index;
      break;
    }
    lines.push(...groupLines);
  }
  if (omittedGroups > 0) {
    lines.push(
      `Ещё групп не помещено в лимит 100 строк: ${String(omittedGroups)}. Они остаются UNCLASSIFIED; payload и UUID намеренно не выводятся.`,
    );
  }
  const output = lines.slice(0, SUMMARY_MAX_LINES - 2);
  const outputLineCount = output.length + 2;
  return `${output.join('\n')}\n\nСтрок в отчёте: ${String(outputLineCount)}/${String(SUMMARY_MAX_LINES)}\n`;
}

export function buildIntegrationDiagnosticReport(
  status: IntegrationStatus,
  diagnostics: IntegrationDiagnostics,
): string {
  const authority = status.websiteAuthority;
  const lines = [
    'ARAVA CRM — диагностика синхронизации',
    `Сформировано: ${diagnostics.checkedAt}`,
    '',
    '[Устройство]',
    `Имя: ${value(status.currentDeviceName ?? diagnostics.device.displayName)}`,
    `Device ID: ${status.deviceId}`,
    `API: ${value(status.baseUrl)}`,
    `Интеграция включена: ${status.enabled ? 'да' : 'нет'}`,
    `Устройство подключено: ${status.isPaired ? 'да' : 'нет'}`,
    '',
    '[Canonical CRM sync]',
    `Текущее состояние: ${status.connectionState}`,
    `Health: ${status.canonicalSyncHealth}`,
    `Последняя попытка: ${value(status.lastAttemptedSync)}`,
    `Последний успешный health-check: ${value(status.lastSuccessfulHealthCheck)}`,
    `Последняя успешная canonical sync: ${value(status.lastCanonicalSyncSuccess)}`,
    `Последняя исходящая sync: ${value(status.lastOutboundSync)}`,
    `Последняя входящая sync: ${value(status.lastInboundSync)}`,
    `Текущая ошибка: ${value(status.lastError)}`,
    `Код ошибки: ${value(status.lastErrorCode)}`,
    `Endpoint: ${value(status.lastErrorEndpoint)}`,
    `HTTP status: ${value(status.lastErrorHttpStatus)}`,
    `Время ошибки: ${value(status.lastErrorAt)}`,
    '',
    '[Очередь]',
    `Ожидают: ${String(status.pendingCount)}`,
    `Обрабатываются: ${String(status.processingCount)}`,
    `Failed: ${String(status.failedCount)}`,
    `Retryable failed: ${String(status.retryableFailedCount)}`,
    `Конфликты: ${String(status.conflictCount)}`,
    `Самая старая ожидающая запись: ${value(status.oldestPendingAt)}`,
    `Следующая попытка: ${value(status.nextRetryAt)}`,
    '',
    '[Website publication]',
    `Health: ${status.websitePublicationHealth}`,
    `Authority state: ${authority.state}`,
    `Этот компьютер authoritative: ${authority.isCurrentDeviceAuthoritative ? 'да' : 'нет'}`,
    `Authoritative device: ${value(authority.authoritativeDeviceName)}`,
    `Authoritative device ID: ${value(authority.authoritativeDeviceId)}`,
    `Последняя успешная публикация: ${value(authority.lastSuccessfulWebsiteSync)}`,
    `Последняя полная синхронизация: ${value(authority.lastFullReconciliation)}`,
    `Текущая ошибка публикации: ${value(authority.lastError)}`,
    `Ожидающие website-операции: ${String(status.websitePendingCount)}`,
    `Permanent FAILED website-related: ${String(status.websiteFailedCount ?? 0)}`,
  ];
  if (status.websitePublicationProbeError) {
    lines.push(
      `Ошибка проверки authority: ${status.websitePublicationProbeError.message}`,
      `Код проверки authority: ${status.websitePublicationProbeError.code}`,
      `Endpoint проверки authority: ${value(status.websitePublicationProbeError.endpoint)}`,
      `HTTP проверки authority: ${value(status.websitePublicationProbeError.httpStatus)}`,
    );
  }
  lines.push('', '[Проверки]');
  for (const check of diagnostics.checks) {
    lines.push(
      `${check.status} | ${check.id} | ${check.label} | ${check.detail}${check.action ? ` | Что делать: ${check.action}` : ''}`,
    );
  }
  lines.push(
    '',
    '[Permanent FAILED classification]',
    `Всего: ${String(diagnostics.permanentFailures.total)}`,
    'A already represented: НЕ КЛАССИФИЦИРОВАНО',
    'B replayable local mutation: НЕ КЛАССИФИЦИРОВАНО',
    'C invalid historical mutation: НЕ КЛАССИФИЦИРОВАНО',
    'D incompatible/corrupt payload: НЕ КЛАССИФИЦИРОВАНО',
    'Причина: требуется сравнение с canonical server journal/read model.',
    '',
    '[Permanent FAILED groups]',
  );
  if (diagnostics.permanentFailures.groups.length === 0) lines.push('нет');
  for (const group of diagnostics.permanentFailures.groups) {
    lines.push(
      [
        `count=${String(group.count)}`,
        `origin=${group.origin}`,
        `originKey=${group.originKey}`,
        `createdAt=${group.createdAt}`,
        `entityType=${group.entityType}`,
        `operation=${group.operation}`,
        `payloadVersion=${String(group.payloadVersion)}`,
        `errorCode=${group.failureCode}`,
        `persistedReason=${group.failureDetail}`,
      ].join(' | '),
    );
  }
  lines.push('', '[Permanent FAILED rows]');
  if (diagnostics.permanentFailures.items.length === 0) lines.push('нет');
  for (const item of diagnostics.permanentFailures.items) {
    lines.push(
      [
        `outboxId=${item.id}`,
        `entityType=${item.entityType}`,
        `entityId=${item.entityId}`,
        `operation=${item.operation}`,
        `payloadVersion=${String(item.payloadVersion)}`,
        `payloadState=${item.payloadState}`,
        `payloadBytes=${String(item.payloadBytes)}`,
        `payloadKeys=${item.payloadKeys.join(',') || 'none'}`,
        `payloadHash=${item.payloadHash}`,
        `baseRevision=${String(item.baseRevision)}`,
        `attemptCount=${String(item.attemptCount)}`,
        `createdAt=${item.createdAt}`,
        `updatedAt=${item.updatedAt}`,
        `lastAttemptAt=${value(item.lastAttemptAt)}`,
        `nextAttemptAt=${item.nextAttemptAt}`,
        `latestFailureLogAt=${value(item.latestFailureLogAt)}`,
        `errorCode=${item.failureCode}`,
        `persistedReason=${item.failureDetail}`,
        `origin=${item.origin}`,
        `originKey=${item.originKey}`,
        `localDeviceId=${item.localDeviceId}`,
        `classification=${item.classification}`,
      ].join(' | '),
    );
  }
  return `${lines.join('\n')}\n`;
}
