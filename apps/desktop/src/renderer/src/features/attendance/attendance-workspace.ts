import type { AttendanceWorkspaceLesson } from '@arava/shared';

export { localDateInputValue as localDateKey } from '../../lib/local-date';

export type AttendanceTimeGroup = 'CURRENT' | 'UPCOMING' | 'LATER' | 'COMPLETED';

export function groupAttendanceLessons(
  lessons: AttendanceWorkspaceLesson[],
  now = new Date(),
): Record<AttendanceTimeGroup, AttendanceWorkspaceLesson[]> {
  const result: Record<AttendanceTimeGroup, AttendanceWorkspaceLesson[]> = {
    COMPLETED: [],
    CURRENT: [],
    LATER: [],
    UPCOMING: [],
  };
  const current = now.getTime();
  const upcomingBoundary = current + 90 * 60_000;
  for (const lesson of lessons) {
    const start = new Date(lesson.startsAt).getTime();
    const end = new Date(lesson.endsAt).getTime();
    if (lesson.status !== 'CANCELLED' && start <= current && current < end) {
      result.CURRENT.push(lesson);
    } else if (end <= current) {
      result.COMPLETED.push(lesson);
    } else if (start <= upcomingBoundary) {
      result.UPCOMING.push(lesson);
    } else {
      result.LATER.push(lesson);
    }
  }
  return result;
}

export function attendanceProgress(lesson: AttendanceWorkspaceLesson): string {
  if (lesson.status === 'CANCELLED') return 'Отменено';
  if (lesson.attendanceMarked === 0) return 'Не заполняли';
  const remaining = Math.max(0, lesson.attendanceExpected - lesson.attendanceMarked);
  return remaining > 0 ? `Осталось отметить ${String(remaining)}` : 'Посещаемость заполнена';
}
