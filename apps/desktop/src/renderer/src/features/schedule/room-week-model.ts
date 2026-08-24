import type { LessonSummary, RoomSummary, WeeklyScheduleSummary } from '@arava/shared';

export interface RoomWeekSection {
  room: RoomSummary;
  schedules: WeeklyScheduleSummary[];
}

export interface PrintLesson {
  cancelled: boolean;
  groupName: string;
  id: string;
  replacement: boolean;
  time: string;
  trainerName: string;
}

export interface PrintDay {
  date: string;
  label: string;
  lessons: PrintLesson[];
}

export interface RoomWeekPrintModel {
  days: PrintDay[];
  roomId: string;
  roomName: string;
  weekRange: string;
}

const russianDayNames = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
] as const;

export function buildRoomWeekSections(
  rooms: readonly RoomSummary[],
  schedules: readonly WeeklyScheduleSummary[],
): RoomWeekSection[] {
  return rooms
    .filter((room) => room.isActive && !room.archivedAt)
    .sort(
      (left, right) =>
        left.branchName.localeCompare(right.branchName, 'ru') ||
        left.sortOrder - right.sortOrder ||
        left.name.localeCompare(right.name, 'ru'),
    )
    .map((room) => ({
      room,
      schedules: schedules.filter((schedule) => schedule.roomId === room.id),
    }));
}

export function buildRoomWeekPrintModel(
  room: RoomSummary,
  lessons: readonly LessonSummary[],
  selectedDate: string,
): RoomWeekPrintModel {
  const weekStart = startOfLocalWeek(selectedDate);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    const dateKey = localDateKey(date);
    return {
      date: dateKey,
      label: `${russianDayNames[index] ?? ''}, ${new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
      }).format(date)}`,
      lessons: lessons
        .filter(
          (lesson) =>
            lesson.roomId === room.id && localDateKey(new Date(lesson.startsAt)) === dateKey,
        )
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
        .map((lesson) => ({
          cancelled: lesson.status === 'CANCELLED',
          groupName: lesson.groupName,
          id: lesson.id,
          replacement: Boolean(lesson.substituteCoachId),
          time: `${formatTime(lesson.startsAt)}–${formatTime(lesson.endsAt)}`,
          trainerName: lesson.substituteCoachName ?? lesson.coachName ?? 'Тренер не назначен',
        })),
    };
  });
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return {
    days,
    roomId: room.id,
    roomName: room.name,
    weekRange: formatWeekRange(weekStart, weekEnd),
  };
}

export function startOfLocalWeek(selectedDate: string): Date {
  const date = new Date(`${selectedDate}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() || 7) - 1));
  date.setHours(0, 0, 0, 0);
  return date;
}

function localDateKey(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatWeekRange(start: Date, end: Date): string {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${formatter.format(start)} — ${formatter.format(end)}`;
}
