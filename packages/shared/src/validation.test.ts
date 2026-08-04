import { describe, expect, it } from 'vitest';

import { loginCredentialsSchema, weeklyScheduleInputSchema } from './validation';

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
