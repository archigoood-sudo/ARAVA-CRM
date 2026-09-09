import type { IntegrationDiagnostics, IntegrationStatus } from '@arava/shared';

function value(input?: string | number): string {
  return input === undefined || input === '' ? 'нет данных' : String(input);
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
