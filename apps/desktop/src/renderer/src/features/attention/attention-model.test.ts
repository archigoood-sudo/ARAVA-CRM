import { describe, expect, it } from 'vitest';

import { combinedAttentionCount } from './attention-model';

describe('attention counter', () => {
  it('includes locally derived tasks and overdue website leads', () => {
    expect(combinedAttentionCount(4, 1)).toBe(5);
  });
});
