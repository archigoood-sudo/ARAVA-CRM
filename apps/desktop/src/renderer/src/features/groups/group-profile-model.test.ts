import type { GroupRosterMember, TrialAppointmentSummary } from '@arava/shared';
import { describe, expect, it } from 'vitest';

import { activeTrialGuests } from './group-profile-model';

const trial = (input: Partial<TrialAppointmentSummary>): TrialAppointmentSummary => ({
  branchId: 'branch-1',
  branchName: 'Центр',
  endsAt: '2026-08-27T11:00:00.000Z',
  groupId: 'group-1',
  groupName: 'Старт',
  id: 'trial-1',
  leadName: 'Мария',
  lessonId: 'lesson-1',
  lessonStatus: 'PLANNED',
  startsAt: '2026-08-27T10:00:00.000Z',
  state: 'SCHEDULED',
  ...input,
});

describe('group profile trial guests', () => {
  it('counts each current guest once and excludes cancelled, purchased, and roster members', () => {
    const members = [{ segment: 'CURRENT', studentId: 'student-member' }] as GroupRosterMember[];
    const result = activeTrialGuests(
      [
        trial({ id: 'a', leadId: 'lead-a' }),
        trial({ id: 'b', leadId: 'lead-a', lessonId: 'lesson-2' }),
        trial({ id: 'c', state: 'CANCELLED' }),
        trial({ id: 'd', state: 'SUBSCRIPTION_PURCHASED' }),
        trial({ id: 'e', studentId: 'student-member' }),
      ],
      members,
    );

    expect(result.map(({ id }) => id)).toEqual(['a']);
  });
});
