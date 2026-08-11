import { describe, expect, it } from 'vitest';

import { runtimeMigrations } from './runtime-migrations';

describe('runtime migrations', () => {
  it('keeps stable unique migration identifiers', () => {
    const identifiers = runtimeMigrations.map(({ id }) => id);
    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(identifiers).toEqual([
      '20260803000000_initial',
      '20260804000000_sprint_1',
      '20260805000000_sprint_2',
      '20260806000000_sprint_3',
      '20260807000000_sprint_4',
      '20260809000000_sprint_4_1a',
      '20260809010000_sprint_4_1b',
      '20260809020000_sprint_4_1c',
      '20260811000000_sprint_4_1d',
      '20260811010000_sprint_4_2a',
    ]);
  });
});
