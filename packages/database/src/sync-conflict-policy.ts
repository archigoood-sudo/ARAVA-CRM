export const AUTO_RESOLVE_LWW_ENTITY_TYPES = [
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
] as const;

const AUTO_RESOLVE_LWW_ENTITY_TYPE_SET = new Set<string>(AUTO_RESOLVE_LWW_ENTITY_TYPES);

export function isAutoResolvableLwwEntityType(entityType: string): boolean {
  return AUTO_RESOLVE_LWW_ENTITY_TYPE_SET.has(entityType);
}
