import type { AttentionItem, ChatSummary, DashboardStats, LeadSummary } from '@arava/shared';
import { expect, it } from 'vitest';

import { buildDashboardWorkspace } from './dashboard-workspace';

const NOW = new Date('2026-08-24T09:00:00.000Z');
const stats: DashboardStats = {
  activeGroups: 2,
  attendanceMarked: 0,
  attendanceUnmarked: 4,
  branches: 1,
  expectedToday: 4,
  expensesToday: 0,
  groupsLowOccupancy: 0,
  groupsWithPlaces: 1,
  lessonsToday: 1,
  lowLessonBalance: 1,
  netCashFlow: 0,
  outstandingDebt: 0,
  payrollPendingApproval: 0,
  problematicPayments: 1,
  revenueThisMonth: 0,
  revenueToday: 0,
  students: 4,
  subscriptionsExpiringSoon: 1,
  trialStudents: 1,
  trialsToday: 1,
  users: 2,
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
    stats,
  });

  expect(result.attention.map(({ id }) => id)).toEqual(['payment:failed', 'subscription:low']);
  expect(result.today.map(({ id }) => id)).toContain('lesson:today');
  expect(result.today.map(({ id }) => id)).toContain('today:trials');
  expect(result.upcoming.map(({ id }) => id)).toEqual(['subscription:soon']);
});

it('creates direct actions for new leads and unread chats and removes them after resolution', () => {
  const lead = {
    childName: 'Анна',
    createdAt: NOW.toISOString(),
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
    stats: { ...stats, trialsToday: 0 },
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
    stats: { ...stats, trialsToday: 0 },
  });
  expect(resolved.today).toEqual([]);
});
