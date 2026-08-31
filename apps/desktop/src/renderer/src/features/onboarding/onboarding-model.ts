import type { StudentFinanceSummary, StudentProfileOverview, UserRole } from '@arava/shared';

export const ONBOARDING_STEPS = ['CLIENT', 'GROUP', 'DOCUMENTS', 'PAYMENT', 'CARD'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

function isOnboardingStep(value: unknown): value is OnboardingStep {
  return ONBOARDING_STEPS.some((step) => step === value);
}

export function canManageOnboarding(role: UserRole | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export interface OnboardingDraft {
  actorId: string;
  cardSkipped: boolean;
  documentsReviewed: boolean;
  leadId?: string | undefined;
  startedAt: string;
  step: OnboardingStep;
  studentId?: string | undefined;
  targetGroupId?: string | undefined;
}

export function onboardingStorageKey(actorId: string): string {
  return `arava-client-onboarding:${actorId}`;
}

export function createOnboardingDraft(input: {
  actorId: string;
  leadId?: string | undefined;
  studentId?: string | undefined;
  targetGroupId?: string | undefined;
}): OnboardingDraft {
  return {
    actorId: input.actorId,
    cardSkipped: false,
    documentsReviewed: false,
    ...(input.leadId ? { leadId: input.leadId } : {}),
    startedAt: new Date().toISOString(),
    step: input.studentId ? 'GROUP' : 'CLIENT',
    ...(input.studentId ? { studentId: input.studentId } : {}),
    ...(input.targetGroupId ? { targetGroupId: input.targetGroupId } : {}),
  };
}

export function parseOnboardingDraft(
  value: string | null,
  actorId: string,
): OnboardingDraft | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as Partial<OnboardingDraft>;
    if (
      candidate.actorId !== actorId ||
      typeof candidate.startedAt !== 'string' ||
      !isOnboardingStep(candidate.step)
    )
      return null;
    return {
      actorId,
      cardSkipped: candidate.cardSkipped === true,
      documentsReviewed: candidate.documentsReviewed === true,
      ...(typeof candidate.leadId === 'string' ? { leadId: candidate.leadId } : {}),
      startedAt: candidate.startedAt,
      step: candidate.step,
      ...(typeof candidate.studentId === 'string' ? { studentId: candidate.studentId } : {}),
      ...(typeof candidate.targetGroupId === 'string'
        ? { targetGroupId: candidate.targetGroupId }
        : {}),
    };
  } catch {
    return null;
  }
}

export function hasOnboardingMembership(
  profile: StudentProfileOverview | undefined,
  targetGroupId?: string,
  localDateKey = (() => {
    const now = new Date();
    return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })(),
): boolean {
  if (!profile) return false;
  return profile.groups.some(
    (group) =>
      (group.segment === 'CURRENT' ||
        (group.segment === 'FUTURE' &&
          group.membershipStatus === 'ACTIVE' &&
          group.joinedAt.slice(0, 10) <= localDateKey)) &&
      (!targetGroupId || group.groupId === targetGroupId),
  );
}

export function hasCompletedOnboardingSale(finance: StudentFinanceSummary | undefined): boolean {
  if (!finance) return false;
  return finance.subscriptions.some(
    (subscription) =>
      subscription.paymentStatus === 'PAID' &&
      subscription.debt === 0 &&
      subscription.paidAmount === subscription.salePrice &&
      subscription.salePrice > 0,
  );
}

export function nextOnboardingStep(
  current: OnboardingStep,
  state: { hasMembership: boolean; hasPaidSubscription: boolean; hasStudent: boolean },
): OnboardingStep | 'DONE' {
  if (!state.hasStudent) return 'CLIENT';
  if (current === 'CLIENT') return 'GROUP';
  if (current === 'GROUP') return state.hasMembership ? 'DOCUMENTS' : 'GROUP';
  if (current === 'DOCUMENTS') return 'PAYMENT';
  if (current === 'PAYMENT') return state.hasPaidSubscription ? 'CARD' : 'PAYMENT';
  return 'DONE';
}
