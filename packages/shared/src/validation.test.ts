import { describe, expect, it } from 'vitest';

import { loginCredentialsSchema, tariffInputSchema, weeklyScheduleInputSchema } from './validation';

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
