import type { AttendanceWorkspaceLesson, LessonSummary } from '@arava/shared';

/** Select existing records only; never infer that two occurrences are the same lesson. */
export function attendanceConflicts(
  occurrence: AttendanceWorkspaceLesson,
  lessons: LessonSummary[],
): LessonSummary[] {
  const start = Date.parse(occurrence.startsAt);
  const end = Date.parse(occurrence.endsAt);
  return lessons
    .filter(
      (lesson) =>
        lesson.groupId === occurrence.groupId &&
        lesson.branchId === occurrence.branchId &&
        lesson.status !== 'CANCELLED' &&
        Date.parse(lesson.startsAt) < end &&
        Date.parse(lesson.endsAt) > start,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
}
