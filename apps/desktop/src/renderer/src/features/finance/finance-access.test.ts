import { describe, expect, it } from 'vitest';

import { canManagePaymentRefunds } from './finance-access';

describe('finance action visibility', () => {
  it('shows refund and cancellation actions only to OWNER', () => {
    expect(canManagePaymentRefunds('OWNER')).toBe(true);
    expect(canManagePaymentRefunds('ADMIN')).toBe(false);
    expect(canManagePaymentRefunds('COACH')).toBe(false);
    expect(canManagePaymentRefunds(undefined)).toBe(false);
  });
});
