import type {
  AttentionItem,
  ChatSummary,
  LeadSummary,
  TrialAppointmentSummary,
} from '@arava/shared';
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
    actionLabel: 'Открыть ученика',
    actionRoute: '/students/student-1',
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

it('prioritizes urgent problems and separates today from the next seven days', () => {
  const result = buildDashboardWorkspace({
    attention: [
      attention({
        category: 'PAYMENTS',
        id: 'payment:failed',
        severity: 'CRITICAL',
        title: 'Ошибка чека',
      }),
      attention({ id: 'subscription:low' }),
      attention({
        dueAt: '2026-08-24T15:00:00.000Z',
        id: 'lesson:today',
        severity: 'INFO',
        title: 'Замена сегодня',
      }),
      attention({
        dueAt: '2026-08-27T15:00:00.000Z',
        id: 'subscription:soon',
        title: 'Абонемент заканчивается',
      }),
    ],
    chats: [],
    leads: [],
    now: NOW,
    trials: [trial],
  });

  expect(result.attention.map(({ id }) => id)).toEqual(['payment:failed', 'subscription:low']);
  expect(result.today.map(({ id }) => id)).toContain('lesson:today');
  expect(result.today.map(({ id }) => id)).toContain('trial:today:trial-1');
  expect(result.upcoming.map(({ id }) => id)).toEqual(['subscription:soon']);
});

it('creates direct actions for new leads and unread chats and removes them after resolution', () => {
  const lead = {
    childName: 'Анна',
    createdAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString(),
    id: 'lead-1',
    originalPhone: '+79990000000',
    phone: '+79990000000',
    source: 'WEBSITE',
    status: 'NEW',
    updatedAt: NOW.toISOString(),
  } satisfies LeadSummary;
  const chat = {
    branchId: 'branch-1',
    crmGroupId: null,
    id: 'chat-1',
    lastMessage: 'Подскажите время занятия',
    lastMessageAt: NOW.toISOString(),
    linkedStudents: [],
    subtitle: 'Личный чат',
    title: 'Андрей',
    type: 'PRIVATE_ADMIN',
    unreadCount: 2,
    updatedAt: NOW.toISOString(),
  } satisfies ChatSummary;
  const pending = buildDashboardWorkspace({
    attention: [],
    chats: [chat],
    leads: [lead],
    now: NOW,
    trials: [],
  });
  expect(pending.today).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ actionRoute: '/leads?leadId=lead-1', id: 'lead:lead-1' }),
      expect.objectContaining({
        actionRoute: '/chats?conversationId=chat-1',
        id: 'chat:chat-1',
      }),
    ]),
  );

  const resolved = buildDashboardWorkspace({
    attention: [],
    chats: [{ ...chat, unreadCount: 0 }],
    leads: [{ ...lead, status: 'CONTACTED' }],
    now: NOW,
    trials: [],
  });
  expect(resolved.today).toEqual([]);
});

it('shows a delayed trial follow-up from canonical attention and removes it after resolution', () => {
  const pending = buildDashboardWorkspace({
    attention: [
      attention({
        actionRoute: '/students/student-1',
        category: 'TRIALS',
        id: 'trial:thinking:trial-1',
        severity: 'INFO',
        title: 'Клиент думает после пробного',
      }),
    ],
    chats: [],
    leads: [],
    now: NOW,
    trials: [],
  });
  expect(pending.attention).toContainEqual(
    expect.objectContaining({
      actionRoute: '/students/student-1',
      id: 'trial:thinking:trial-1',
      title: 'Клиент думает после пробного',
    }),
  );

  const resolved = buildDashboardWorkspace({
    attention: [],
    chats: [],
    leads: [],
    now: NOW,
    trials: [],
  });
  expect(resolved.today).toEqual([]);
});

it('excludes a cancelled trial from today counters and actions', () => {
  const cancelled = { ...trial, lessonStatus: 'CANCELLED', state: 'CANCELLED' } as const;
  const result = buildDashboardWorkspace({
    attention: [],
    chats: [],
    leads: [],
    now: NOW,
    trials: [cancelled],
  });

  expect(countTrialsOnDay([cancelled], NOW)).toBe(0);
  expect(result.today).toEqual([]);
});
