import { describe, expect, it } from 'vitest';

import type { AttendanceWorkspaceLesson } from '@arava/shared';

import { attendanceProgress, groupAttendanceLessons, localDateKey } from './attendance-workspace';

function lesson(
  id: string,
  startsAt: string,
  endsAt: string,
  overrides: Partial<AttendanceWorkspaceLesson> = {},
): AttendanceWorkspaceLesson {
  return {
    attendanceExpected: 10,
    attendanceMarked: 0,
    branchId: 'branch',
    branchName: 'Центр',
    direction: 'Хип-хоп',
    endsAt,
    groupId: 'group',
    groupName: id,
    id,
    startsAt,
    status: 'PLANNED',
    ...overrides,
  };
}

describe('attendance workspace presentation', () => {
  it('groups lessons into current, nearest, later and completed sections', () => {
    const groups = groupAttendanceLessons(
      [
        lesson('completed', '2026-08-23T08:00:00', '2026-08-23T09:00:00'),
        lesson('current', '2026-08-23T10:00:00', '2026-08-23T11:00:00'),
        lesson('upcoming', '2026-08-23T11:30:00', '2026-08-23T12:30:00'),
        lesson('later', '2026-08-23T15:00:00', '2026-08-23T16:00:00'),
      ],
      new Date('2026-08-23T10:30:00'),
    );
    expect(groups.CURRENT.map(({ id }) => id)).toEqual(['current']);
    expect(groups.UPCOMING.map(({ id }) => id)).toEqual(['upcoming']);
    expect(groups.LATER.map(({ id }) => id)).toEqual(['later']);
    expect(groups.COMPLETED.map(({ id }) => id)).toEqual(['completed']);
  });

  it('shows operational progress without raw enum values', () => {
    expect(attendanceProgress(lesson('empty', '', ''))).toBe('Не заполняли');
    expect(attendanceProgress(lesson('partial', '', '', { attendanceMarked: 4 }))).toBe(
      'Осталось отметить 6',
    );
    expect(
      attendanceProgress(
        lesson('done', '', '', {
          attendanceCompletedAt: '2026-08-23T12:00:00',
          attendanceMarked: 10,
        }),
      ),
    ).toBe('Посещаемость заполнена');
    expect(attendanceProgress(lesson('cancelled', '', '', { status: 'CANCELLED' }))).toBe(
      'Отменено',
    );
  });

  it('uses a local calendar date instead of a UTC date', () => {
    expect(localDateKey(new Date(2026, 7, 23, 0, 5))).toBe('2026-08-23');
  });
});
