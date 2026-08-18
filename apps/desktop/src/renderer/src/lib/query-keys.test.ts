import { describe, expect, it } from 'vitest';

import { queryKeys } from './query-keys';

describe('trainer profile query isolation', () => {
  it('separates cached profiles by session role and branch scope', () => {
    const owner = queryKeys.trainerProfile('trainer-a', '2026-08', 'owner:OWNER:');
    const trainer = queryKeys.trainerProfile('trainer-a', '2026-08', 'trainer-a:COACH:branch-a');
    const restrictedAdmin = queryKeys.trainerProfile(
      'trainer-a',
      '2026-08',
      'admin:ADMIN:branch-a',
    );
    expect(owner).not.toEqual(trainer);
    expect(owner).not.toEqual(restrictedAdmin);
    expect(trainer).not.toEqual(restrictedAdmin);
  });
});
