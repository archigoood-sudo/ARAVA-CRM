import type { DashboardTodayLesson } from '@arava/shared';
import { describe, expect, it } from 'vitest';

import { classifyTodayLessons } from './dashboard-today';

function lesson(id: string, startsAt: string, endsAt: string): DashboardTodayLesson {
  return {
    attendanceMarked: 0,
    branchName: 'Центр',
    endsAt,
    expectedStudents: 10,
    groupName: id,
    id,
    startsAt,
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
});
