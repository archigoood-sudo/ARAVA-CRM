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

  it('separates chat lists and messages by user, role, and branch scope', () => {
    const owner = 'owner:OWNER:';
    const coach = 'coach-a:COACH:branch-a';
    const admin = 'admin-a:ADMIN:branch-a';
    expect(queryKeys.chats(owner, { filter: 'ALL' })).not.toEqual(
      queryKeys.chats(coach, { filter: 'ALL' }),
    );
    expect(queryKeys.chatMessages(owner, 'private-a')).not.toEqual(
      queryKeys.chatMessages(admin, 'private-a'),
    );
    expect(queryKeys.studentCommunication(owner, 'student-a')).not.toEqual(
      queryKeys.studentCommunication(coach, 'student-a'),
    );
  });
});
