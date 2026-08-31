import { describe, expect, it } from 'vitest';

import {
  AUTO_RESOLVE_LWW_ENTITY_TYPES,
  IMMUTABLE_SYNC_EVENT_ENTITY_TYPES,
  isAutoResolvableLwwEntityType,
  isImmutableSyncEventEntityType,
} from './sync-conflict-policy';

describe('sync conflict policy', () => {
  it('auto-resolves only ordinary mutable entity snapshots', () => {
    expect(AUTO_RESOLVE_LWW_ENTITY_TYPES).toEqual(
      expect.arrayContaining([
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
        'ATTENDANCE',
        'TRIAL_APPOINTMENT',
        'STUDENT_NOTE',
        'PUBLICATION',
      ]),
    );
    expect(isAutoResolvableLwwEntityType('STUDENT_IDENTITY')).toBe(true);
  });

  it.each(IMMUTABLE_SYNC_EVENT_ENTITY_TYPES)('keeps %s outside canonical LWW', (entityType) => {
    expect(isAutoResolvableLwwEntityType(entityType)).toBe(false);
    expect(isImmutableSyncEventEntityType(entityType)).toBe(true);
  });

  it('does not infer LWW eligibility for unknown records', () => {
    expect(isAutoResolvableLwwEntityType('FUTURE_ENTITY')).toBe(false);
    expect(isImmutableSyncEventEntityType('FUTURE_ENTITY')).toBe(false);
  });
});
