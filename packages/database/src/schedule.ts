export interface ScheduleWindow {
  endTime: string;
  startTime: string;
  validFrom: Date;
  validTo: Date | null;
  weekday: number;
}

export interface ScheduleOccurrence {
  endsAt: Date;
  startsAt: Date;
}

export function timeRangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string,
): boolean {
  return firstStart < secondEnd && secondStart < firstEnd;
}

export function dateRangesOverlap(
  firstStart: Date,
  firstEnd: Date | null,
  secondStart: Date,
  secondEnd: Date | null,
): boolean {
  const maximum = new Date('9999-12-31T23:59:59.999Z');
  return firstStart <= (secondEnd ?? maximum) && secondStart <= (firstEnd ?? maximum);
}

export function scheduleWindowsOverlap(first: ScheduleWindow, second: ScheduleWindow): boolean {
  return (
    first.weekday === second.weekday &&
    timeRangesOverlap(first.startTime, first.endTime, second.startTime, second.endTime) &&
    dateRangesOverlap(first.validFrom, first.validTo, second.validFrom, second.validTo)
  );
}

export function combineLocalDateAndTime(date: Date, time: string): Date {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function startOfLocalDay(value: Date | string): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfLocalDay(value: Date | string): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function isoWeekday(date: Date): number {
  const weekday = date.getDay();
  return weekday === 0 ? 7 : weekday;
}

export function scheduleOccurrenceForLocalDate(
  schedule: ScheduleWindow,
  date: Date,
): ScheduleOccurrence | undefined {
  if (isoWeekday(date) !== schedule.weekday) return undefined;
  const startsAt = combineLocalDateAndTime(date, schedule.startTime);
  if (
    startsAt < schedule.validFrom ||
    (schedule.validTo && startsAt > endOfLocalDay(schedule.validTo))
  )
    return undefined;
  return {
    endsAt: combineLocalDateAndTime(date, schedule.endTime),
    startsAt,
  };
}
