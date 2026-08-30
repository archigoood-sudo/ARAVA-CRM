import type { DashboardTodayLesson } from '@arava/shared';
import { describe, expect, it } from 'vitest';

import { classifyTodayLessons, todayAttendanceRoute } from './dashboard-today';

function lesson(id: string, startsAt: string, endsAt: string): DashboardTodayLesson {
  return {
    attendanceMarked: 0,
    attendancePresent: 0,
    branchId: 'branch-1',
    branchName: 'Центр',
    endsAt,
    expectedStudents: 10,
    groupId: 'group-1',
    groupName: id,
    id,
    startsAt,
    trialStudents: 0,
  };
}

describe('рабочий день администратора', () => {
  const now = new Date('2026-08-25T15:30:00+03:00');

  it('показывает несколько параллельных занятий как текущие', () => {
    const result = classifyTodayLessons(
      [
        lesson('Зал 1', '2026-08-25T15:00:00+03:00', '2026-08-25T16:00:00+03:00'),
        lesson('Зал 2', '2026-08-25T15:15:00+03:00', '2026-08-25T16:15:00+03:00'),
      ],
      now,
    );
    expect(result.current.map(({ id }) => id)).toEqual(['Зал 1', 'Зал 2']);
    expect(result.upcoming).toEqual([]);
  });

  it('исключает завершённые занятия и сортирует следующие', () => {
    const result = classifyTodayLessons(
      [
        lesson('Позже', '2026-08-25T19:00:00+03:00', '2026-08-25T20:00:00+03:00'),
        lesson('Завершено', '2026-08-25T13:00:00+03:00', '2026-08-25T14:00:00+03:00'),
        lesson('Скоро', '2026-08-25T17:00:00+03:00', '2026-08-25T18:00:00+03:00'),
      ],
      now,
    );
    expect(result.current).toEqual([]);
    expect(result.upcoming.map(({ id }) => id)).toEqual(['Скоро', 'Позже']);
  });

  it('возвращает корректное пустое состояние', () => {
    expect(classifyTodayLessons([], now)).toEqual({ current: [], upcoming: [] });
  });

  it('открывает из Today конкретное занятие с локальной датой', () => {
    expect(
      todayAttendanceRoute(
        lesson(
          'weekly:group-1:2026-08-25T18:30:00+03:00',
          '2026-08-25T18:30:00+03:00',
          '2026-08-25T19:30:00+03:00',
        ),
      ),
    ).toBe(
      '/attendance?date=2026-08-25&occurrence=weekly%3Agroup-1%3A2026-08-25T18%3A30%3A00%2B03%3A00',
    );
  });
});
