import { describe, expect, it } from 'vitest';
import { buildRecoverySnapshotExport } from './recovery-snapshot-export';

const secret = 'PRIVATE_PERSON_EMAIL_PASSWORD_TOKEN_PAYLOAD';
const reason = 'Ledger-эффект отсутствует на сервере и имеет безопасную identity.';
const fingerprint = 'a'.repeat(64);
function row(failedRowId = 'failed-1') {
  return {
    failedRowId,
    entityType: 'SUBSCRIPTION_LEDGER',
    entityId: 'ledger-1',
    classification: 'B',
    reason,
    errorCode: 'VALIDATION_ERROR',
    checkedAt: '2026-09-28T10:00:00.000Z',
    baseRevision: 0,
    payloadHash: fingerprint,
    payloadJson: secret,
    email: secret,
    token: secret,
    serverState: JSON.stringify({ operation: 'MISSING', payload: secret, email: secret }),
    dependencyState: JSON.stringify([
      { key: 'SUBSCRIPTION:subscription-1', operation: 'UPSERT', revision: 2, token: secret },
    ]),
    ledgerComparison: {
      version: 1,
      identityKind: 'WRITE_OFF',
      localIdentityHash: fingerprint,
      serverIdentityHash: null,
      identityMatches: null,
      localEffectHash: fingerprint,
      serverEffectHash: null,
      effectMatches: null,
      payload: secret,
      payment: secret,
    },
  };
}
function snapshot(rows = [row()]) {
  return JSON.stringify({
    id: 'snapshot-1',
    version: 2,
    preview: { checkedAt: '2026-09-28T10:00:00.000Z', failedRows: rows.length, token: secret },
    rows,
    auth: secret,
  });
}
describe('recovery snapshot safe export', () => {
  it('exports exact persisted classification/evidence through a closed field allowlist', () => {
    const report = buildRecoverySnapshotExport(snapshot(), ['failed-1']);
    expect(report.rows[0]).toMatchObject({
      failedRowId: 'failed-1',
      entityId: 'ledger-1',
      classification: 'B',
      reason,
      ledgerComparison: {
        availability: 'RECORDED',
        localIdentityHash: fingerprint,
        localEffectHash: fingerprint,
      },
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(secret);
    for (const field of [
      'payloadJson',
      'payload',
      'email',
      'password',
      'recoveryCode',
      'token',
      'auth',
      'payment',
      'card',
    ])
      expect(serialized).not.toContain(`"${field}"`);
    expect(report.integrity).toMatchObject({
      totalSnapshotRows: 1,
      uniqueFailedRowIds: 1,
      duplicateIds: [],
      missingIds: [],
    });
  });
  it('reports duplicate, missing and no-longer-failed IDs without correcting the snapshot', () => {
    const report = buildRecoverySnapshotExport(snapshot([row('old-1'), row('old-1')]), ['new-1']);
    expect(report.integrity).toMatchObject({
      totalSnapshotRows: 2,
      uniqueFailedRowIds: 1,
      duplicateIds: [{ failedRowId: 'old-1', count: 2 }],
      missingIds: ['new-1'],
      noLongerPermanentFailedIds: ['old-1'],
    });
    expect(report.countsByClassEntityReason[0]?.count).toBe(2);
  });
  it('does not invent missing ledger evidence or export arbitrary free-text secrets', () => {
    const value = row();
    const { ledgerComparison: _ledgerComparison, ...legacy } = value;
    const raw = JSON.parse(snapshot()) as { rows: unknown[]; version?: number };
    raw.rows = [{ ...legacy, reason: secret, errorCode: 'secret@example.com' }];
    delete raw.version;
    const report = buildRecoverySnapshotExport(JSON.stringify(raw), ['failed-1']);
    expect(report.snapshotVersion).toBe(1);
    expect(report.rows[0]).toMatchObject({
      reason: 'UNRECOGNIZED_REASON_REDACTED',
      errorCode: null,
      ledgerComparison: { availability: 'NOT_RECORDED' },
    });
    expect(JSON.stringify(report)).not.toContain(secret);
  });
  it('fails closed on malformed classifications or server states', () => {
    const raw = JSON.parse(snapshot()) as { rows: Record<string, unknown>[] };
    const first = raw.rows[0];
    if (!first) throw new Error('Missing test fixture');
    first.classification = 'UNCLASSIFIED';
    expect(() => buildRecoverySnapshotExport(JSON.stringify(raw), [])).toThrow();
  });
});
