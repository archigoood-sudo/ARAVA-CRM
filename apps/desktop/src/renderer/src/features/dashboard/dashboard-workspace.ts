import type { AttentionItem, LeadSummary, TrialAppointmentSummary } from '@arava/shared';

export interface DashboardActionItem {
  actionLabel: string;
  actionRoute: string;
  description: string;
  id: string;
  meta?: string | undefined;
  priority: 'RED' | 'YELLOW' | 'BLUE';
  title: string;
}

export interface DashboardWorkspace {
  attention: DashboardActionItem[];
  total: number;
}

const priorityOrder = { BLUE: 2, RED: 0, YELLOW: 1 } as const;
const categoryOrder: Record<AttentionItem['category'], number> = {
  PAYMENTS: 0,
  ATTENDANCE: 1,
  TRIALS: 2,
  LEADS: 3,
  SUBSCRIPTIONS: 4,
  STUDENTS: 5,
  CARDS: 6,
  SCHEDULE: 7,
  ROOMS: 8,
  SUBSTITUTIONS: 9,
  INTEGRATION: 10,
  BACKUPS: 11,
  PAYROLL: 12,
};

interface RankedAction extends DashboardActionItem {
  occurredAt?: string;
  order: number;
}

function fromAttention(item: AttentionItem): RankedAction {
  return {
    actionLabel: item.actionLabel,
    actionRoute: item.actionRoute,
    description: item.description,
    id: item.id,
    meta: item.branchName,
    order: item.id.startsWith('student:debt:') ? 6 : categoryOrder[item.category],
    priority:
      item.severity === 'CRITICAL' ? 'RED' : item.severity === 'WARNING' ? 'YELLOW' : 'BLUE',
    title: item.title,
  };
}

export function countTrialsOnDay(trials: TrialAppointmentSummary[], day: Date): number {
  return trials.filter((trial) => {
    if (trial.state === 'CANCELLED' || trial.lessonStatus === 'CANCELLED') return false;
    const startsAt = new Date(trial.startsAt);
    return (
      startsAt.getFullYear() === day.getFullYear() &&
      startsAt.getMonth() === day.getMonth() &&
      startsAt.getDate() === day.getDate()
    );
  }).length;
}

export function buildDashboardWorkspace({
  attention,
  attentionTotal,
  leads,
  leadsTotal,
  trials,
}: {
  attention: AttentionItem[];
  attentionTotal?: number;
  leads: LeadSummary[];
  leadsTotal?: number;
  trials: TrialAppointmentSummary[];
}): DashboardWorkspace {
  const followUpTrialIds = new Set(
    trials
      .filter(({ outcome, state }) => state === 'FOLLOW_UP' && outcome !== 'THINKING')
      .map(({ id }) => id),
  );
  const canonical = attention
    .filter(({ category, entityId }) => category !== 'TRIALS' || !followUpTrialIds.has(entityId))
    .map(fromAttention);
  const leadItems = leads
    .filter(({ status }) => status === 'NEW')
    .map((lead): RankedAction => ({
      actionLabel: 'Открыть заявку',
      actionRoute: `/leads?leadId=${encodeURIComponent(lead.id)}`,
      description: [lead.parentName, lead.phone, lead.direction].filter(Boolean).join(' · '),
      id: `lead:${lead.id}`,
      occurredAt: lead.createdAt,
      order: categoryOrder.LEADS,
      priority: 'YELLOW',
      title: `Новая заявка: ${lead.childName}`,
    }));
  const canonicalTrialIds = new Set(
    attention.filter(({ category }) => category === 'TRIALS').map(({ entityId }) => entityId),
  );
  const trialItems = trials
    .filter(
      ({ id, lessonStatus, outcome, state }) =>
        (state === 'FOLLOW_UP' || !canonicalTrialIds.has(id)) &&
        lessonStatus !== 'CANCELLED' &&
        state !== 'CANCELLED' &&
        state !== 'CLOSED' &&
        (state !== 'FOLLOW_UP' || outcome !== 'THINKING') &&
        state !== 'SUBSCRIPTION_PURCHASED',
    )
    .map((trial): RankedAction => ({
      actionLabel:
        trial.state === 'FOLLOW_UP'
          ? 'Оформить абонемент'
          : trial.studentId
            ? 'Посещаемость'
            : 'Открыть заявку',
      actionRoute: trial.studentId
        ? trial.state === 'FOLLOW_UP'
          ? `/students/${trial.studentId}?action=subscription`
          : `/attendance/${trial.lessonId}`
        : `/leads?leadId=${encodeURIComponent(trial.leadId ?? '')}`,
      description: `${trial.groupName} · ${new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(trial.startsAt))}`,
      id: `trial:today:${trial.id}`,
      meta: trial.branchName,
      occurredAt: trial.startsAt,
      order: categoryOrder.TRIALS,
      priority: trial.state === 'MISSED' ? 'RED' : 'YELLOW',
      title:
        trial.state === 'FOLLOW_UP'
          ? `Связаться после пробного: ${trial.leadName}`
          : `${trial.leadName} · пробное сегодня`,
    }));
  const seen = new Set<string>();
  const candidates = [...canonical, ...trialItems, ...leadItems]
    .sort(
      (left, right) =>
        priorityOrder[left.priority] - priorityOrder[right.priority] ||
        left.order - right.order ||
        (left.occurredAt ?? '').localeCompare(right.occurredAt ?? '') ||
        left.title.localeCompare(right.title, 'ru'),
    )
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  return {
    attention: candidates.slice(0, 8),
    total:
      (attentionTotal ?? attention.length) + (leadsTotal ?? leadItems.length) + trialItems.length,
  };
}
