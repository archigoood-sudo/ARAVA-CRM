import type { LeadSummary } from './channels';

export const RETENTION_RULES = {
  consecutiveAbsenceCount: 3,
  leadResponseHours: 24,
  lowSubscriptionRemainingLessons: 1,
  thinkingFollowUpHours: 24,
  trialOutcomeGraceHours: 2,
} as const;

const HOUR_MS = 60 * 60 * 1000;

export function isLeadResponseOverdue(lead: LeadSummary, now = new Date()): boolean {
  return (
    lead.status === 'NEW' &&
    now.getTime() - new Date(lead.createdAt).getTime() >=
      RETENTION_RULES.leadResponseHours * HOUR_MS
  );
}
