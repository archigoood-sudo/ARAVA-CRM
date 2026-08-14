import { describe, expect, it } from 'vitest';

import {
  barcodeSchema,
  attentionFiltersSchema,
  cardAssignInputSchema,
  cashTransferInputSchema,
  expenseInputSchema,
  globalSearchQuerySchema,
  loginCredentialsSchema,
  payrollRuleInputSchema,
  studentNoteInputSchema,
  tariffInputSchema,
  weeklyScheduleInputSchema,
} from './validation';

describe('Sprint 4.1C card validation', () => {
  it('preserves leading zeroes and trims only surrounding whitespace', () => {
    expect(barcodeSchema.parse('  0000001001  ')).toBe('0000001001');
    expect(
      cardAssignInputSchema.parse({
        barcode: '0000001001',
        registerIfUnknown: true,
        studentId: 'student',
      }).barcode,
    ).toBe('0000001001');
  });

  it('rejects empty, short and malformed barcodes', () => {
    expect(barcodeSchema.safeParse('').success).toBe(false);
    expect(barcodeSchema.safeParse('001').success).toBe(false);
    expect(barcodeSchema.safeParse('0000 001').success).toBe(false);
  });
});

describe('Sprint 4.1D global search validation', () => {
  it('trims a useful query and rejects empty or oversized input', () => {
    expect(globalSearchQuerySchema.parse('  Иванов  ')).toBe('Иванов');
    expect(globalSearchQuerySchema.safeParse(' ').success).toBe(false);
    expect(globalSearchQuerySchema.safeParse('а'.repeat(121)).success).toBe(false);
  });
});

describe('Sprint 4.2A student note validation', () => {
  it('trims useful notes and rejects empty or oversized content', () => {
    expect(studentNoteInputSchema.parse({ text: '  Важная заметка  ' })).toEqual({
      text: 'Важная заметка',
    });
    expect(studentNoteInputSchema.safeParse({ text: ' ' }).success).toBe(false);
    expect(studentNoteInputSchema.safeParse({ text: 'а'.repeat(4001) }).success).toBe(false);
  });
});

describe('Sprint 4.2B attention filters', () => {
  it('accepts supported filters and rejects unknown categories', () => {
    expect(
      attentionFiltersSchema.parse({
        category: 'PAYMENTS',
        relevance: 'TODAY',
        severity: 'WARNING',
      }),
    ).toEqual({ category: 'PAYMENTS', relevance: 'TODAY', severity: 'WARNING' });
    expect(attentionFiltersSchema.safeParse({ category: 'LEADS' }).success).toBe(false);
  });
});

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
