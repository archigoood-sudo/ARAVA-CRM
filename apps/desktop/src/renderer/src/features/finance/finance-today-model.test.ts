import type { FinanceTodayOverview } from '@arava/shared';
import { expect, it } from 'vitest';

import {
  financeTodayOperationTone,
  financeTodayProblemCount,
  hasFinanceTodayActivity,
} from './finance-today-model';

const overview: FinanceTodayOverview = {
  byMethod: [{ amount: 2_000, count: 1, method: 'CASH' }],
  date: '2026-08-27',
  debt: {
    studentCount: 1,
    subscriptionAmount: 1_000,
    totalAmount: 1_500,
    uncoveredAmount: 500,
    unpricedAttendanceCount: 0,
  },
  directAttendance: { amount: 500, count: 1 },
  failed: [],
  failedCount: 1,
  net: 1_500,
  pending: [],
  pendingCount: 0,
  received: 2_000,
  recentOperations: [
    {
      amount: 500,
      branchName: 'Центр',
      id: 'refund:1',
      kind: 'REFUND',
      method: 'CASH',
      occurredAt: '2026-08-27T12:00:00.000Z',
      paymentId: 'payment-1',
      purpose: 'Возврат · Разовое посещение',
      status: 'PARTIALLY_REFUNDED',
      studentId: 'student-1',
      studentName: 'Петрова Анна',
    },
  ],
  refunds: 500,
  recovery: [],
  recoveryCount: 2,
  subscriptionSales: { count: 1, value: 3_300 },
  successfulCount: 2,
};

it('keeps refunds visually distinct and exposes activity instead of an empty state', () => {
  expect(hasFinanceTodayActivity(overview)).toBe(true);
  const refund = overview.recentOperations[0];
  expect(refund).toBeDefined();
  if (refund) expect(financeTodayOperationTone(refund)).toBe('refund');
  expect(hasFinanceTodayActivity({ ...overview, recentOperations: [] })).toBe(false);
});

it('combines failed and recovery counts without treating pending payments as problems', () => {
  expect(financeTodayProblemCount(overview)).toBe(3);
  expect(overview.pendingCount).toBe(0);
});
