import type { LessonSummary, RoomSummary, WeeklyScheduleSummary } from '@arava/shared';
import { describe, expect, it } from 'vitest';

import { buildRoomWeekPrintModel, buildRoomWeekSections } from './room-week-model';

const room = (id: string, name: string, sortOrder: number): RoomSummary => ({
  branchId: 'branch-1',
  branchName: 'Центр',
  createdAt: '2026-08-01T00:00:00.000Z',
  id,
  isActive: true,
  name,
  sortOrder,
  updatedAt: '2026-08-01T00:00:00.000Z',
});

const schedule = (id: string, roomId: string): WeeklyScheduleSummary => ({
  branchId: 'branch-1',
  branchName: 'Центр',
  createdAt: '2026-08-01T00:00:00.000Z',
  endTime: '19:00',
  groupId: `group-${id}`,
  groupName: `Группа ${id}`,
  id,
  isActive: true,
  roomId,
  startTime: '18:00',
  updatedAt: '2026-08-01T00:00:00.000Z',
  validFrom: '2026-08-01',
  weekday: 1,
});

const lesson = (id: string, roomId: string, startsAt: string): LessonSummary => ({
  attendanceExpected: 0,
  attendanceMarked: 0,
  branchId: 'branch-1',
  branchName: 'Центр',
  coachId: 'coach-1',
  coachName: 'Анна Петрова',
  endsAt: startsAt.replace('18:00', '19:00'),
  groupId: `group-${id}`,
  groupName: `Группа ${id}`,
  id,
  roomId,
  roomName: roomId,
  startsAt,
  status: 'PLANNED',
});

describe('room week schedule model', () => {
  it('sorts active rooms and keeps only schedules assigned to each room', () => {
    const archived = { ...room('room-3', 'Архив', 0), archivedAt: '2026-08-10', isActive: false };
    const result = buildRoomWeekSections(
      [room('room-2', 'Зал 2', 2), archived, room('room-1', 'Зал 1', 1)],
      [schedule('one', 'room-1'), schedule('two', 'room-2')],
    );

    expect(result.map(({ room: item }) => item.name)).toEqual(['Зал 1', 'Зал 2']);
    expect(result[0]?.schedules.map(({ id }) => id)).toEqual(['one']);
    expect(result[1]?.schedules.map(({ id }) => id)).toEqual(['two']);
  });

  it('keeps an active room with no lessons as an empty section', () => {
    const result = buildRoomWeekSections([room('room-1', 'Зал 1', 1)], []);
    expect(result).toHaveLength(1);
    expect(result[0]?.schedules).toEqual([]);
  });

  it('prints only the selected room and selected week with replacement/cancellation state', () => {
    const first = {
      ...lesson('one', 'room-1', '2026-08-24T18:00:00+03:00'),
      originalCoachId: 'coach-old',
      originalCoachName: 'Ирина Орлова',
      substituteCoachId: 'coach-new',
      substituteCoachName: 'Мария Лебедева',
    };
    const cancelled = {
      ...lesson('cancelled', 'room-1', '2026-08-25T18:00:00+03:00'),
      status: 'CANCELLED' as const,
    };
    const model = buildRoomWeekPrintModel(
      room('room-1', 'Зал 1', 1),
      [
        first,
        cancelled,
        lesson('other-room', 'room-2', '2026-08-24T18:00:00+03:00'),
        lesson('other-week', 'room-1', '2026-08-31T18:00:00+03:00'),
      ],
      '2026-08-26',
    );

    expect(model.roomName).toBe('Зал 1');
    expect(model.weekRange).toContain('24 августа 2026');
    expect(model.weekRange).toContain('30 августа 2026');
    expect(model.days.flatMap(({ lessons }) => lessons).map(({ id }) => id)).toEqual([
      'one',
      'cancelled',
    ]);
    expect(model.days[0]?.lessons[0]).toMatchObject({
      replacement: true,
      trainerName: 'Мария Лебедева',
    });
    expect(model.days[1]?.lessons[0]?.cancelled).toBe(true);
  });
});
