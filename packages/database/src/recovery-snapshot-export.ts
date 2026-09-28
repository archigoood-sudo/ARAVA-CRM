const REASONS = new Set([
  'Тип сущности не поддерживает безопасную canonical-сверку.',
  'Текущую локальную сущность нельзя сериализовать безопасно.',
  'Сущность уже отсутствует локально и на сервере; ARCHIVE устарел.',
  'Удаление сущности уже отражено в canonical-состоянии сервера.',
  'ARCHIVE основан на текущей server revision и безопасен для повторной отправки.',
  'Серверная сущность изменилась после базы ARCHIVE; требуется ручная проверка.',
  'Тот же ledger-эффект уже существует на сервере.',
  'У ledger-записи нет безопасной canonical identity для idempotent replay.',
  'Эквивалентный ledger-эффект уже существует на сервере.',
  'Canonical identity ledger совпала, но финансовый эффект расходится.',
  'Сервер хранит другую запись с тем же ledger ID; автоматический replay запрещён.',
  'Ledger-эффект отсутствует на сервере и имеет безопасную identity.',
  'Текущая эквивалентная сущность уже существует на сервере.',
  'Серверная версия является базой локального изменения; current-schema UPSERT безопасен.',
  'Серверная revision новее базы локальной мутации; требуется ручная проверка.',
  'Серверная сущность архивирована, а локальная версия активна.',
  'Текущая локальная сущность отсутствует на сервере и пригодна к восстановлению.',
  'Обязательная родительская сущность доказанно отсутствует.',
  'Родительская сущность требует ручной проверки.',
  'Родительскую сущность нельзя проверить безопасно.',
  'Обязательная родительская сущность отсутствует локально и на сервере.',
  'Родительская сущность не синхронизирована и не входит в recovery.',
]);

export interface RecoveryLedgerComparison {
  version: 1;
  identityKind: 'WRITE_OFF' | 'REVERSAL' | 'UNPROVEN';
  localIdentityHash: string | null;
  serverIdentityHash: string | null;
  identityMatches: boolean | null;
  localEffectHash: string;
  serverEffectHash: string | null;
  effectMatches: boolean | null;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Сохранённый снимок повреждён. Экспорт остановлен.');
  }
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/u.test(value)) {
    throw new Error('В снимке недопустимый идентификатор. Экспорт остановлен.');
  }
  return value;
}

function hash(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}

function revision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function operation(value: unknown): 'UPSERT' | 'ARCHIVE' | 'MISSING' {
  if (value === 'UPSERT' || value === 'ARCHIVE' || value === 'MISSING') return value;
  throw new Error('В снимке недопустимое состояние сервера. Экспорт остановлен.');
}

function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error('В снимке отсутствует корректная дата проверки.');
  }
  return value;
}

// Never serialize the stored object directly: this is a deliberately closed allowlist.
export function buildRecoverySnapshotExport(raw: string, currentFailedIds: string[]) {
  const snapshot = record(JSON.parse(raw));
  const preview = record(snapshot.preview);
  if (!Array.isArray(snapshot.rows)) throw new Error('Сохранённый снимок не содержит строк.');
  const rows = snapshot.rows.map((value: unknown) => {
    const row = record(value);
    const classification = row.classification;
    if (
      classification !== 'A' &&
      classification !== 'B' &&
      classification !== 'C' &&
      classification !== 'D'
    ) {
      throw new Error('В снимке недопустимая классификация. Экспорт остановлен.');
    }
    const entityType = id(row.entityType);
    if (!/^[A-Z_]+$/u.test(entityType)) throw new Error('Недопустимый тип сущности.');
    const server = record(JSON.parse(String(row.serverState)));
    const dependencies: unknown = JSON.parse(String(row.dependencyState));
    if (!Array.isArray(dependencies)) throw new Error('Недопустимое состояние зависимостей.');
    let ledgerComparison;
    if (entityType === 'SUBSCRIPTION_LEDGER') {
      if (row.ledgerComparison) {
        const ledger = record(row.ledgerComparison);
        ledgerComparison = {
          availability: 'RECORDED' as const,
          version: 1,
          identityKind:
            ledger.identityKind === 'WRITE_OFF' || ledger.identityKind === 'REVERSAL'
              ? ledger.identityKind
              : 'UNPROVEN',
          localIdentityHash: hash(ledger.localIdentityHash),
          serverIdentityHash: hash(ledger.serverIdentityHash),
          identityMatches:
            typeof ledger.identityMatches === 'boolean' ? ledger.identityMatches : null,
          localEffectHash: hash(ledger.localEffectHash),
          serverEffectHash: hash(ledger.serverEffectHash),
          effectMatches: typeof ledger.effectMatches === 'boolean' ? ledger.effectMatches : null,
        };
      } else {
        ledgerComparison = { availability: 'NOT_RECORDED' as const };
      }
    }
    return {
      failedRowId: id(row.failedRowId),
      entityType,
      entityId: id(row.entityId),
      classification,
      reason:
        typeof row.reason === 'string' && REASONS.has(row.reason)
          ? row.reason
          : 'UNRECOGNIZED_REASON_REDACTED',
      errorCode:
        typeof row.errorCode === 'string' && /^[A-Z0-9_]{1,80}$/u.test(row.errorCode)
          ? row.errorCode
          : null,
      checkedAt: timestamp(row.checkedAt),
      baseRevision: revision(row.baseRevision),
      serverState: {
        operation: operation(server.operation),
        revision: revision(server.revision),
        entityId: server.entityId === undefined ? null : id(server.entityId),
        stateHash: hash(server.payloadHash),
      },
      dependencyState: dependencies.map((value: unknown) => {
        const dependency = record(value);
        return {
          key: id(dependency.key),
          operation: operation(dependency.operation),
          revision: revision(dependency.revision),
        };
      }),
      ...(ledgerComparison ? { ledgerComparison } : {}),
    };
  });
  const frequency = new Map<string, number>();
  const groups = new Map<
    string,
    { classification: string; entityType: string; reason: string; count: number }
  >();
  for (const row of rows) {
    frequency.set(row.failedRowId, (frequency.get(row.failedRowId) ?? 0) + 1);
    const key = `${row.classification}:${row.entityType}:${row.reason}`;
    const group = groups.get(key) ?? {
      classification: row.classification,
      entityType: row.entityType,
      reason: row.reason,
      count: 0,
    };
    group.count += 1;
    groups.set(key, group);
  }
  const current = new Set(currentFailedIds.map(id));
  return {
    snapshotId: id(snapshot.id),
    snapshotVersion: snapshot.version === 2 ? 2 : 1,
    snapshotTimestamp: timestamp(preview.checkedAt),
    rows,
    integrity: {
      totalSnapshotRows: rows.length,
      declaredSnapshotRows: revision(preview.failedRows),
      uniqueFailedRowIds: frequency.size,
      duplicateIds: [...frequency]
        .filter(([, count]) => count > 1)
        .map(([failedRowId, count]) => ({ failedRowId, count })),
      missingIds: [...current].filter((failedRowId) => !frequency.has(failedRowId)),
      noLongerPermanentFailedIds: [...frequency.keys()].filter(
        (failedRowId) => !current.has(failedRowId),
      ),
      currentPermanentFailedRows: current.size,
    },
    countsByClassEntityReason: [...groups.values()].sort((a, b) =>
      `${a.classification}:${a.entityType}:${a.reason}`.localeCompare(
        `${b.classification}:${b.entityType}:${b.reason}`,
      ),
    ),
  };
}
