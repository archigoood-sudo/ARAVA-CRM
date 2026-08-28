import { describe, expect, it } from 'vitest';

import {
  AUTO_RESOLVE_LWW_ENTITY_TYPES,
  isAutoResolvableLwwEntityType,
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
        'SCHEDULE',
        'TARIFF',
        'STUDENT_NOTE',
        'PUBLICATION',
      ]),
    );
    expect(isAutoResolvableLwwEntityType('STUDENT_IDENTITY')).toBe(true);
  });

  it.each([
    'PAYMENT',
    'REFUND',
    'SUBSCRIPTION',
    'SUBSCRIPTION_LEDGER',
    'ATTENDANCE',
    'GROUP_MEMBERSHIP',
    'LESSON',
    'SUBSTITUTION',
    'TRIAL_APPOINTMENT',
    'CARD',
    'CHAT_MESSAGE',
  ])('keeps %s outside scalar LWW', (entityType) => {
    expect(isAutoResolvableLwwEntityType(entityType)).toBe(false);
  });
});
