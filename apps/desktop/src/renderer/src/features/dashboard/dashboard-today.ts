import type { DashboardTodayLesson } from '@arava/shared';

export function classifyTodayLessons(
  lessons: DashboardTodayLesson[],
  now: Date,
): { current: DashboardTodayLesson[]; upcoming: DashboardTodayLesson[] } {
  return {
    current: lessons.filter(
      ({ endsAt, startsAt }) => new Date(startsAt) <= now && now < new Date(endsAt),
    ),
    upcoming: lessons
      .filter(({ startsAt }) => new Date(startsAt) > now)
      .sort(
        (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
      ),
  };
}
