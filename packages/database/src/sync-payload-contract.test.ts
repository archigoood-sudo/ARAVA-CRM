import { describe, expect, it } from 'vitest';

import { materializeSyncMutation, SYNC_UPSERT_PAYLOAD_FIELDS } from './sync-payload-contract';

const REQUIRED_ENTITY_TYPES = [
  'ATTENDANCE',
  'SUBSCRIPTION',
  'SUBSCRIPTION_LEDGER',
  'LESSON',
  'CARD',
  'SCHEDULE',
  'GROUP_MEMBERSHIP',
  'TARIFF',
  'TRAINER',
  'GROUP',
  'ROOM',
  'STUDENT_CONTACT',
  'BRANCH',
  'STUDENT_IDENTITY',
] as const;

describe('canonical sync payload contract', () => {
  it('covers every required MATERIALIZED/v1 entity and rejects unknown UPSERT fields', () => {
    for (const entityType of REQUIRED_ENTITY_TYPES) {
      expect(SYNC_UPSERT_PAYLOAD_FIELDS[entityType]).toContain('id');
      expect(
        materializeSyncMutation(entityType, `${entityType.toLowerCase()}-1`, 'UPSERT', {
          id: `${entityType.toLowerCase()}-1`,
          unexpectedLegacyField: true,
        }).unknownFields,
      ).toEqual(['unexpectedLegacyField']);
    }
  });

  it('materializes every ARCHIVE as the strict id/missing envelope', () => {
    for (const entityType of REQUIRED_ENTITY_TYPES) {
      const entityId = `${entityType.toLowerCase()}-archive`;
      expect(
        materializeSyncMutation(entityType, entityId, 'ARCHIVE', {
          id: entityId,
          legacyUnknownField: true,
        }),
      ).toEqual({
        operation: 'ARCHIVE',
        payload: { id: entityId, missing: true },
        unknownFields: [],
      });
    }
  });

  it('keeps subscription sequencing on SUBSCRIPTION, never CARD', () => {
    expect(SYNC_UPSERT_PAYLOAD_FIELDS.SUBSCRIPTION).toContain('sequenceAfterSubscriptionId');
    expect(SYNC_UPSERT_PAYLOAD_FIELDS.CARD).not.toContain('sequenceAfterSubscriptionId');
  });
});
