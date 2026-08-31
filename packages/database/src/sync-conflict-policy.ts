export const AUTO_RESOLVE_LWW_ENTITY_TYPES = [
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
] as const;

export const IMMUTABLE_SYNC_EVENT_ENTITY_TYPES = [
  'PAYMENT',
  'REFUND',
  'SUBSCRIPTION_LEDGER',
  'CHAT_MESSAGE',
  'ATTENDANCE_CHECKIN',
] as const;

const AUTO_RESOLVE_LWW_ENTITY_TYPE_SET = new Set<string>(AUTO_RESOLVE_LWW_ENTITY_TYPES);

export function isAutoResolvableLwwEntityType(entityType: string): boolean {
  return AUTO_RESOLVE_LWW_ENTITY_TYPE_SET.has(entityType);
}

const IMMUTABLE_SYNC_EVENT_ENTITY_TYPE_SET = new Set<string>(IMMUTABLE_SYNC_EVENT_ENTITY_TYPES);

export function isImmutableSyncEventEntityType(entityType: string): boolean {
  return IMMUTABLE_SYNC_EVENT_ENTITY_TYPE_SET.has(entityType);
}
