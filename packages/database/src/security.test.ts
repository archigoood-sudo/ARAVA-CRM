import { describe, expect, it } from 'vitest';

import { hashPassword, normalizePhone, verifyPassword } from './security';

describe('local credential security', () => {
  it('uses salted memory-hard password hashes', async () => {
    const first = await hashPassword('Strong!Password2026');
    const second = await hashPassword('Strong!Password2026');
    expect(first).toMatch(/^scrypt\$65536\$8\$1\$/u);
    expect(first).not.toBe(second);
    expect(first).not.toContain('Strong!Password2026');
    await expect(verifyPassword('Strong!Password2026', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', first)).resolves.toBe(false);
  });

  it('normalizes phone numbers to a stable international representation', () => {
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('+79991234567');
    expect(() => normalizePhone('123')).toThrow('valid phone');
  });
});
