import { describe, expect, it } from 'vitest';

import {
  cashTransferInputSchema,
  expenseInputSchema,
  loginCredentialsSchema,
  payrollRuleInputSchema,
  tariffInputSchema,
  weeklyScheduleInputSchema,
} from './validation';

describe('loginCredentialsSchema', () => {
  it('normalizes and validates valid credentials', () => {
    expect(
      loginCredentialsSchema.parse({ email: '  owner@arava.app ', password: 'secure-pass' }),
    ).toEqual({ email: 'owner@arava.app', password: 'secure-pass' });
  });

  it('accepts any non-empty password for a constant login response', () => {
    expect(
      loginCredentialsSchema.safeParse({ email: 'owner@arava.app', password: 'short' }).success,
    ).toBe(true);
  });
});

describe('weeklyScheduleInputSchema', () => {
  it('normalizes an empty optional end date for desktop date inputs', () => {
    expect(
      weeklyScheduleInputSchema.parse({
        branchId: 'branch',
        endTime: '19:00',
        groupId: 'group',
        isActive: true,
        startTime: '18:00',
        validFrom: '2026-08-04',
        validTo: '',
        weekday: 2,
      }).validTo,
    ).toBeUndefined();
  });
});

describe('tariffInputSchema', () => {
  const base = {
    currency: 'RUB',
    isActive: true,
    name: 'Основной тариф',
    price: 12_000,
  } as const;

  it('requires a lesson count for a lesson pack', () => {
    expect(tariffInputSchema.safeParse({ ...base, type: 'LESSON_PACK' }).success).toBe(false);
    expect(
      tariffInputSchema.safeParse({ ...base, lessonCount: 8, type: 'LESSON_PACK' }).success,
    ).toBe(true);
  });

  it('enforces one visit for single and trial tariffs and none for unlimited', () => {
    expect(
      tariffInputSchema.safeParse({ ...base, lessonCount: 2, type: 'SINGLE_LESSON' }).success,
    ).toBe(false);
    expect(tariffInputSchema.safeParse({ ...base, lessonCount: 1, type: 'TRIAL' }).success).toBe(
      true,
    );
    expect(
      tariffInputSchema.safeParse({ ...base, lessonCount: 1, type: 'UNLIMITED' }).success,
    ).toBe(false);
    expect(tariffInputSchema.safeParse({ ...base, type: 'UNLIMITED' }).success).toBe(true);
  });
});

describe('Sprint 4 validation', () => {
  it('rejects zero expenses and transfers to the same register', () => {
    expect(
      expenseInputSchema.safeParse({
        amount: 0,
        branchId: 'branch',
        categoryId: 'category',
        description: 'Аренда',
        paymentMethod: 'CASH',
        spentAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
    expect(
      cashTransferInputSchema.safeParse({
        amount: 100,
        fromCashRegisterId: 'cash',
        occurredAt: new Date().toISOString(),
        reason: 'Перевод',
        toCashRegisterId: 'cash',
      }).success,
    ).toBe(false);
  });

  it('validates required payroll model parameters', () => {
    const base = {
      branchId: 'branch',
      coachId: 'coach',
      isActive: true,
      validFrom: '2026-08-05',
    } as const;
    expect(payrollRuleInputSchema.safeParse({ ...base, type: 'PER_ATTENDEE' }).success).toBe(false);
    expect(
      payrollRuleInputSchema.safeParse({
        ...base,
        amountPerAttendee: 500,
        type: 'PER_ATTENDEE',
      }).success,
    ).toBe(true);
  });
});
