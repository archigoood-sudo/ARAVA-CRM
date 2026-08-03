import { describe, expect, it } from 'vitest';

import { loginCredentialsSchema } from './validation';

describe('loginCredentialsSchema', () => {
  it('normalizes and validates valid credentials', () => {
    expect(
      loginCredentialsSchema.parse({ email: '  owner@arava.app ', password: 'secure-pass' }),
    ).toEqual({ email: 'owner@arava.app', password: 'secure-pass' });
  });

  it('rejects short passwords', () => {
    expect(
      loginCredentialsSchema.safeParse({ email: 'owner@arava.app', password: 'short' }).success,
    ).toBe(false);
  });
});
