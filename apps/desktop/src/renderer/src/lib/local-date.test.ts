import { describe, expect, it } from 'vitest';

import { localDateInputValue } from './local-date';

describe('localDateInputValue', () => {
  it('uses local calendar fields instead of the UTC calendar date', () => {
    const localJustAfterMidnight = new Date(2026, 7, 24, 0, 5);

    expect(localDateInputValue(localJustAfterMidnight)).toBe('2026-08-24');
  });
});
