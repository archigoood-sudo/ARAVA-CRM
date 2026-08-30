import type { AttentionItem, LeadSummary, TrialAppointmentSummary } from '@arava/shared';
import { expect, it } from 'vitest';

import { buildDashboardWorkspace, countTrialsOnDay } from './dashboard-workspace';

const NOW = new Date('2026-08-24T09:00:00.000Z');
const trial: TrialAppointmentSummary = {
  branchId: 'branch-1',
  branchName: 'Центр',
  endsAt: '2026-08-24T11:00:00.000Z',
  groupId: 'group-1',
  groupName: 'Старт',
  id: 'trial-1',
  leadId: 'lead-trial',
  leadName: 'Мария',
  lessonId: 'lesson-trial',
  lessonStatus: 'PLANNED',
  startsAt: '2026-08-24T10:00:00.000Z',
  state: 'TODAY',
};

function attention(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    actionLabel: 'Продлить абонемент',
    actionRoute: '/students/student-1?action=subscription',
    category: 'SUBSCRIPTIONS',
    description: 'Требуется действие.',
    entityId: 'student-1',
    entityType: 'Student',
    id: 'subscription:low:1',
    severity: 'WARNING',
    title: 'Осталось одно занятие',
    ...overrides,
  };
}

function lead(overrides: Partial<LeadSummary> = {}): LeadSummary {
  return {
    childName: 'Анна',
    createdAt: '2026-08-23T08:00:00.000Z',
    id: 'lead-1',
    originalPhone: '+79990000000',
    phone: '+79990000000',
    source: 'WEBSITE',
    status: 'NEW',
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

it('ставит критичную оплату выше обычного долга и важных действий', () => {
  const result = buildDashboardWorkspace({
    attention: [
      attention({
        category: 'PAYMENTS',
        id: 'student:debt:1',
        severity: 'WARNING',
        title: 'Есть задолженность',
      }),
      attention({
        category: 'PAYMENTS',
        id: 'subscription:payment-integrity:1',
        severity: 'CRITICAL',
        title: 'Активный абонемент без полной оплаты',
      }),
    ],
    leads: [lead()],
    trials: [trial],
  });

  expect(result.attention[0]).toMatchObject({
    id: 'subscription:payment-integrity:1',
    priority: 'RED',
  });
  expect(result.attention.find(({ id }) => id === 'student:debt:1')?.priority).toBe('YELLOW');
});

it('удаляет обработанную заявку и завершённое пробное из очереди', () => {
  const pending = buildDashboardWorkspace({
    attention: [],
    leads: [lead()],
    trials: [trial],
  });
  expect(pending.attention.map(({ id }) => id)).toEqual(['trial:today:trial-1', 'lead:lead-1']);

  const resolved = buildDashboardWorkspace({
    attention: [],
    leads: [lead({ status: 'CONTACTED' })],
    trials: [{ ...trial, state: 'SUBSCRIPTION_PURCHASED' }],
  });
  expect(resolved.attention).toEqual([]);
});

it('ведёт завершённое пробное в существующий сценарий продажи без дубля', () => {
  const result = buildDashboardWorkspace({
    attention: [
      attention({
        category: 'TRIALS',
        entityId: trial.id,
        id: `trial:outcome:${trial.id}`,
        title: 'Пробное прошло — укажите результат',
      }),
    ],
    leads: [],
    trials: [{ ...trial, state: 'FOLLOW_UP', studentId: 'student-1' }],
  });
  expect(result.attention).toEqual([
    expect.objectContaining({
      actionLabel: 'Оформить абонемент',
      actionRoute: '/students/student-1?action=subscription',
      title: 'Связаться после пробного: Мария',
    }),
  ]);
});

it('не превращает существующий статус «думает» в срочную продажу', () => {
  const result = buildDashboardWorkspace({
    attention: [],
    leads: [],
    trials: [{ ...trial, outcome: 'THINKING', state: 'FOLLOW_UP', studentId: 'student-1' }],
  });
  expect(result.attention).toEqual([]);
});

it('ограничивает Today восемью действиями и сохраняет полный счётчик', () => {
  const result = buildDashboardWorkspace({
    attention: Array.from({ length: 12 }, (_, index) =>
      attention({ id: `attention:${String(index)}`, title: `Действие ${String(index)}` }),
    ),
    attentionTotal: 12,
    leads: [lead()],
    leadsTotal: 3,
    trials: [trial],
  });
  expect(result.attention).toHaveLength(8);
  expect(result.total).toBe(16);
});

it('не считает отменённое пробное в показателе дня', () => {
  const cancelled = { ...trial, lessonStatus: 'CANCELLED', state: 'CANCELLED' } as const;
  expect(countTrialsOnDay([trial, cancelled], NOW)).toBe(1);
  expect(
    buildDashboardWorkspace({ attention: [], leads: [], trials: [cancelled] }).attention,
  ).toEqual([]);
});
