export const ATTENTION_RULES = {
  attendanceGraceMinutes: 15,
  expirationDays: 5,
  recentlyExpiredDays: 30,
  lowLessonBalance: 2,
  operationalHistoryDays: 30,
  operationalHorizonDays: 30,
  substitutionHorizonDays: 7,
  backupWarningDays: 3,
  backupCriticalDays: 7,
  backupInitialGraceHours: 24,
  backupRepeatedFailures: 2,
} as const;

export const DAY_MS = 86_400_000;

export function isExpiringSoon(expiresAt: Date, now = new Date()): boolean {
  const remaining = expiresAt.getTime() - now.getTime();
  return remaining >= 0 && remaining <= ATTENTION_RULES.expirationDays * DAY_MS;
}

export function isLowLessonBalance(remainingLessons: number | undefined): boolean {
  return remainingLessons !== undefined && remainingLessons <= ATTENTION_RULES.lowLessonBalance;
}
