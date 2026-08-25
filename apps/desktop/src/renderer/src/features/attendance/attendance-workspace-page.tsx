import { formatDate, type AttendanceWorkspaceLesson } from '@arava/shared';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, cn } from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarCheck2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  UsersRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { invalidateLessonCaches } from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import {
  attendanceProgress,
  groupAttendanceLessons,
  localDateKey,
  type AttendanceTimeGroup,
} from './attendance-workspace';

const groupLabels: Record<AttendanceTimeGroup, string> = {
  COMPLETED: 'Завершённые',
  CURRENT: 'Идут сейчас',
  LATER: 'Позже сегодня',
  UPCOMING: 'Ближайшие',
};

function timeRange(lesson: AttendanceWorkspaceLesson): string {
  const time = (value: string) =>
    new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(
      new Date(value),
    );
  return `${time(lesson.startsAt)}–${time(lesson.endsAt)}`;
}

function LessonCard({
  isOpening,
  lesson,
  onOpen,
}: {
  isOpening: boolean;
  lesson: AttendanceWorkspaceLesson;
  onOpen: (lesson: AttendanceWorkspaceLesson) => void;
}) {
  const cancelled = lesson.status === 'CANCELLED';
  const progress = attendanceProgress(lesson);
  return (
    <button
      className={cn(
        'w-full rounded-2xl border border-border bg-surface p-4 text-left transition',
        cancelled
          ? 'cursor-default opacity-65'
          : 'hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-soft',
      )}
      disabled={cancelled}
      onClick={() => onOpen(lesson)}
      type="button"
    >
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <p className="text-lg font-semibold tabular-nums">{timeRange(lesson)}</p>
          <h3 className="mt-1 truncate text-lg font-semibold tracking-[-0.02em]">
            {lesson.groupName}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {[lesson.direction, lesson.effectiveTrainerName, lesson.roomName]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="mt-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <UsersRound className="size-4" />
            Отмечено {lesson.attendanceMarked} из {lesson.attendanceExpected}
          </p>
        </div>
        <Badge
          className={cn(
            cancelled
              ? 'bg-red-50 text-red-700'
              : progress === 'Посещаемость заполнена'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-lime-50 text-neutral-800',
          )}
        >
          {progress}
        </Badge>
      </div>
      {isOpening ? <p className="mt-3 text-sm text-muted-foreground">Открываем занятие…</p> : null}
    </button>
  );
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDateKey(value);
}

export function AttendanceWorkspacePage() {
  const role = useAuthStore(({ user }) => user?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDate = searchParams.get('date');
  const requestedOccurrenceId = searchParams.get('occurrence');
  const openedOccurrenceId = useRef<string>();
  const [date, setDate] = useState(() =>
    initialDate && /^\d{4}-\d{2}-\d{2}$/u.test(initialDate) ? initialDate : localDateKey(),
  );
  const today = localDateKey();
  const navigate = useNavigate();
  const client = useQueryClient();
  const attendance = useQuery({
    enabled: role !== 'COACH',
    queryFn: () => getDesktopApi().attendance.today(getSessionToken(), date),
    queryKey: queryKeys.attendanceToday(date),
    refetchInterval: 30_000,
  });
  const openOccurrence = useMutation({
    mutationFn: (lesson: AttendanceWorkspaceLesson) =>
      lesson.lessonId
        ? Promise.resolve({ id: lesson.lessonId })
        : getDesktopApi().attendance.openOccurrence(getSessionToken(), {
            groupId: lesson.groupId,
            startsAt: lesson.startsAt,
          }),
    onSuccess: async ({ id }) => {
      await invalidateLessonCaches(client);
      void navigate(`/attendance/${id}?from=workspace&date=${date}`);
    },
  });
  useEffect(() => {
    if (!requestedOccurrenceId || openedOccurrenceId.current === requestedOccurrenceId) return;
    const occurrence = attendance.data?.lessons.find(({ id }) => id === requestedOccurrenceId);
    if (!occurrence || occurrence.status === 'CANCELLED') return;
    openedOccurrenceId.current = requestedOccurrenceId;
    openOccurrence.mutate(occurrence);
  }, [attendance.data?.lessons, openOccurrence, requestedOccurrenceId]);
  const selectDate = (nextDate: string) => {
    setDate(nextDate);
    setSearchParams(nextDate === today ? {} : { date: nextDate }, { replace: true });
  };
  if (role === 'COACH') return <Navigate replace to="/schedule" />;
  if (attendance.isLoading) return <LoadingState label="Загружаем занятия…" />;
  if (!attendance.data || attendance.isError)
    return (
      <ErrorState
        message="Не удалось загрузить занятия на выбранную дату."
        onRetry={() => void attendance.refetch()}
        retryLabel="Повторить"
        title="Что-то пошло не так"
      />
    );
  const groups = groupAttendanceLessons(attendance.data.lessons);
  const isToday = date === today;
  const dateTitle = isToday
    ? `Сегодня, ${formatDate(`${date}T12:00:00`, { dateStyle: 'long' })}`
    : formatDate(`${date}T12:00:00`, { dateStyle: 'full' });
  return (
    <main className="mx-auto w-full max-w-[1320px] animate-fade-in p-7 pb-14 min-[1500px]:p-9">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <CalendarCheck2 className="size-4" /> Ежедневное рабочее место
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.045em]">Посещения</h1>
          <p className="mt-2 text-lg text-muted-foreground">{dateTitle}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface px-4 py-3 text-right">
          <p className="text-2xl font-semibold">{attendance.data.lessons.length}</p>
          <p className="text-xs text-muted-foreground">занятий</p>
        </div>
      </header>

      <Card className="mb-6 flex flex-wrap items-center gap-2 p-3">
        <Button
          aria-label="Предыдущий день"
          onClick={() => selectDate(shiftDate(date, -1))}
          size="icon"
          type="button"
          variant="secondary"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button onClick={() => selectDate(today)} type="button" variant="secondary">
          Сегодня
        </Button>
        <Button
          aria-label="Следующий день"
          onClick={() => selectDate(shiftDate(date, 1))}
          size="icon"
          type="button"
          variant="secondary"
        >
          <ChevronRight className="size-4" />
        </Button>
        <label className="ml-auto flex min-w-[220px] items-center gap-2 text-sm font-medium">
          <CalendarCheck2 className="size-4 text-muted-foreground" />
          <span>Дата</span>
          <Input
            aria-label="Дата посещений"
            className="min-w-0"
            onChange={(event) => {
              if (event.target.value) selectDate(event.target.value);
            }}
            type="date"
            value={date}
          />
        </label>
      </Card>

      {openOccurrence.isError ? (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          Не удалось открыть занятие. Обновите список и попробуйте снова.
        </p>
      ) : null}

      {attendance.data.lessons.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            description="Здесь появятся занятия из расписания на выбранную дату."
            icon={Clock3}
            title={isToday ? 'Сегодня занятий нет' : 'На эту дату занятий нет'}
          />
        </Card>
      ) : (
        <div className="space-y-7">
          {(['CURRENT', 'UPCOMING', 'LATER', 'COMPLETED'] as const).map((group) =>
            groups[group].length ? (
              <section key={group}>
                <div className="mb-3 flex items-center gap-2">
                  {group === 'CURRENT' ? (
                    <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
                  ) : group === 'COMPLETED' ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : (
                    <Clock3 className="size-4 text-muted-foreground" />
                  )}
                  <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {!isToday && group === 'COMPLETED'
                      ? 'Занятия'
                      : date > today && group === 'LATER'
                        ? 'Запланированные'
                        : groupLabels[group]}
                  </h2>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  {groups[group].map((lesson) => (
                    <LessonCard
                      isOpening={
                        openOccurrence.isPending && openOccurrence.variables.id === lesson.id
                      }
                      key={lesson.id}
                      lesson={lesson}
                      onOpen={(selected) => openOccurrence.mutate(selected)}
                    />
                  ))}
                </div>
              </section>
            ) : null,
          )}
        </div>
      )}
    </main>
  );
}
