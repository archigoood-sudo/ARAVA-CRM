import { formatDate, type AttendanceWorkspaceLesson } from '@arava/shared';
import { Badge, Card, EmptyState, ErrorState, LoadingState, cn } from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, CheckCircle2, Clock3, UsersRound } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
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

function LessonCard({ lesson }: { lesson: AttendanceWorkspaceLesson }) {
  const navigate = useNavigate();
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
      onClick={() => navigate(`/attendance/${lesson.id}?from=workspace`)}
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
    </button>
  );
}

export function AttendanceWorkspacePage() {
  const role = useAuthStore(({ user }) => user?.role);
  const date = localDateKey();
  const attendance = useQuery({
    enabled: role !== 'COACH',
    queryFn: () => getDesktopApi().attendance.today(getSessionToken(), date),
    queryKey: queryKeys.attendanceToday(date),
    refetchInterval: 30_000,
  });
  if (role === 'COACH') return <Navigate replace to="/schedule" />;
  if (attendance.isLoading) return <LoadingState label="Загружаем занятия на сегодня…" />;
  if (!attendance.data || attendance.isError)
    return (
      <ErrorState
        message="Не удалось загрузить занятия на сегодня."
        onRetry={() => void attendance.refetch()}
        retryLabel="Повторить"
        title="Что-то пошло не так"
      />
    );
  const groups = groupAttendanceLessons(attendance.data.lessons);
  return (
    <main className="mx-auto w-full max-w-[1320px] animate-fade-in p-7 pb-14 min-[1500px]:p-9">
      <header className="mb-6 flex items-end justify-between gap-6">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <CalendarCheck2 className="size-4" /> Ежедневное рабочее место
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.045em]">Посещения</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Сегодня, {formatDate(`${date}T12:00:00`, { dateStyle: 'long' })}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface px-4 py-3 text-right">
          <p className="text-2xl font-semibold">{attendance.data.lessons.length}</p>
          <p className="text-xs text-muted-foreground">занятий сегодня</p>
        </div>
      </header>

      {attendance.data.lessons.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            description="Здесь появятся созданные занятия текущего дня."
            icon={Clock3}
            title="Сегодня занятий нет"
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
                    {groupLabels[group]}
                  </h2>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  {groups[group].map((lesson) => (
                    <LessonCard key={lesson.id} lesson={lesson} />
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
