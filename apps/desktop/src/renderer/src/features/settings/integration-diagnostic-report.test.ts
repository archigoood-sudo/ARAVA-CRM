import type { IntegrationDiagnostics, IntegrationStatus } from '@arava/shared';
import { describe, expect, it } from 'vitest';

import { buildIntegrationDiagnosticSummary } from './integration-diagnostic-report';

describe('buildIntegrationDiagnosticSummary', () => {
  it('keeps a large permanent-failure report compact and omits entity UUIDs', () => {
    const status = {
      canonicalSyncHealth: 'HEALTHY',
      connectionState: 'CONNECTED',
      currentDeviceName: 'DESKTOP-V3HT10D',
      deviceId: 'current-device-id',
      failedCount: 2056,
      lastCanonicalSyncSuccess: '2026-09-08T15:48:30.000Z',
      lastSuccessfulHealthCheck: '2026-09-08T15:48:30.000Z',
      pendingCount: 0,
      processingCount: 0,
      retryableFailedCount: 0,
      websiteAuthority: {
        isCurrentDeviceAuthoritative: true,
        state: 'AUTHORITATIVE',
      },
      websiteFailedCount: 461,
      websitePendingCount: 0,
      websitePublicationHealth: 'HEALTHY',
    } as unknown as IntegrationStatus;
    const items = Array.from({ length: 2056 }, (_, index) => ({
      attemptCount: 1,
      baseRevision: 0,
      classification: 'UNCLASSIFIED' as const,
      createdAt: '2026-09-08T14:45:00.728Z',
      entityId: `entity-${String(index)}`,
      entityType: ['ATTENDANCE', 'SUBSCRIPTION', 'SUBSCRIPTION_LEDGER'][index % 3],
      failureCode: `PERMANENT_${String(index % 40)}`,
      failureDetail: `Persisted failure reason ${String(index % 40)}`,
      id: `outbox-${String(index)}`,
      lastAttemptAt: '2026-09-08T14:45:01.000Z',
      latestFailureLogAt: '2026-09-08T14:45:01.000Z',
      localDeviceId: 'current-device-id',
      nextAttemptAt: '2026-09-08T14:45:01.000Z',
      operation: 'UPSERT',
      origin: 'INITIAL_SYNC' as const,
      originKey: 'initial:2026-09-08T14:45:00.728Z',
      payloadBytes: 100,
      payloadHash: `hash-${String(index).padStart(12, '0')}`,
      payloadKeys: ['id'],
      payloadState: 'MATERIALIZED' as const,
      payloadVersion: 1,
      updatedAt: '2026-09-08T14:45:01.000Z',
    }));
    const diagnostics = {
      checkedAt: '2026-09-09T10:00:00.000Z',
      checks: [],
      device: { deviceId: 'current-device-id', displayName: 'DESKTOP-V3HT10D' },
      overall: 'WARNING',
      permanentFailures: { groups: [], items, total: items.length },
    } as IntegrationDiagnostics;

    const summary = buildIntegrationDiagnosticSummary(status, diagnostics);

    expect(summary.split('\n').length - 1).toBeLessThanOrEqual(100);
    expect(summary).toContain('UNCLASSIFIED: 2056');
    expect(summary).toContain('Текущие website pending/processing=0');
    expect(summary).not.toContain('outbox-');
    expect(summary).not.toContain('entity-');
  });
});
