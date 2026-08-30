import { formatDate, type DashboardStats, type TrialAppointmentSummary } from '@arava/shared';
import { AttentionCard, Badge, Button, Card, ErrorState, Money } from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarCheck,
  CreditCard,
  RefreshCw,
  Sparkles,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { buildDashboardWorkspace } from './dashboard-workspace';
import { classifyTodayLessons, todayAttendanceRoute } from './dashboard-today';

const EMPTY_STATS: DashboardStats = {
  attentionItems: [],
  attentionTotal: 0,
  generatedAt: new Date(0).toISOString(),
  newLeads: [],
  newLeadsTotal: 0,
  receivedToday: 0,
  todayLessons: [],
  todayTrials: [],
};

const trialStateLabel: Record<TrialAppointmentSummary['state'], string> = {
  ATTENDED: 'Пришёл',
  CANCELLED: 'Отменено',
  CLOSED: 'Закрыто',
  FOLLOW_UP: 'Нужно решение',
  MISSED: 'Не пришёл',
  SCHEDULED: 'Запланировано',
  SUBSCRIPTION_PURCHASED: 'Купил абонемент',
  TODAY: 'Сегодня',
};

export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const manager = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const accessKey = `${user?.id ?? ''}:${user?.role ?? ''}:${[...(user?.branchIds ?? [])].sort().join(',')}`;
  const stats = useQuery({
    enabled: manager,
    queryFn: () => getDesktopApi().dashboard.stats(getSessionToken()),
    queryKey: [...queryKeys.dashboard, accessKey],
    refetchOnMount: 'always',
    staleTime: 20_000,
  });
  const currentStats = stats.data ?? EMPTY_STATS;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const now = useMemo(() => new Date(clock), [clock]);
  const lessons = useMemo(
    () => classifyTodayLessons(currentStats.todayLessons, now),
    [currentStats.todayLessons, now],
  );
  const workspace = useMemo(
    () =>
      buildDashboardWorkspace({
        attention: currentStats.attentionItems,
        attentionTotal: currentStats.attentionTotal,
        leads: currentStats.newLeads,
        leadsTotal: currentStats.newLeadsTotal,
        trials: currentStats.todayTrials,
      }),
    [currentStats],
  );
  const expected = currentStats.todayLessons.reduce(
    (sum, lesson) => sum + lesson.expectedStudents,
    0,
  );
  const present = currentStats.todayLessons.reduce(
    (sum, lesson) => sum + lesson.attendancePresent,
    0,
  );

  if (user?.role === 'COACH') return <Navigate replace to="/schedule" />;

  return (
    <main
      className="mx-auto w-full max-w-[1540px] animate-fade-in overflow-x-hidden p-4 pb-8 2xl:p-6"
      data-testid="today-workspace"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Рабочий день
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.035em]">
            Сегодня, {formatDate(now, { day: 'numeric', month: 'long' })}
          </h2>
        </div>
        <Button
          aria-label="Обновить рабочий день"
          onClick={() => void stats.refetch()}
          size="small"
          variant="ghost"
        >
          <RefreshCw className={`size-4 ${stats.isFetching ? 'animate-spin' : ''}`} />
          Обновить
        </Button>
      </header>

      {stats.isError ? (
        <Card className="mt-4">
          <ErrorState
            message="Не удалось загрузить рабочий день."
            onRetry={() => void stats.refetch()}
            retryLabel="Повторить"
            title="Сегодня недоступно"
          />
        </Card>
      ) : (
        <>
          <section
            aria-label="Показатели сегодня"
            className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            <SummaryCounter
              icon={CalendarCheck}
              label="Занятий"
              loading={stats.isLoading}
              onClick={() => navigate('/schedule')}
              value={currentStats.todayLessons.length}
            />
            <SummaryCounter
              icon={UsersRound}
              label="Ожидается"
              loading={stats.isLoading}
              onClick={() => navigate('/attendance')}
              value={expected}
            />
            <SummaryCounter
              icon={UserRoundCheck}
              label="Уже пришли"
              loading={stats.isLoading}
              onClick={() => navigate('/attendance')}
              value={present}
            />
            <SummaryCounter
              icon={Sparkles}
              label="Пробных"
              loading={stats.isLoading}
              onClick={() => navigate('/leads')}
              value={currentStats.todayTrials.length}
            />
          </section>

          <div className="mt-3 grid min-w-0 items-start gap-3 xl:grid-cols-[1.05fr_1fr_1.15fr]">
            <WorkspaceCard title="Сейчас в студии">
              {lessons.current.length ? (
                <div className="space-y-2" data-testid="current-lessons">
                  {lessons.current.map((lesson) => (
                    <CurrentLesson
                      key={lesson.id}
                      lesson={lesson}
                      onAttendance={() => navigate(todayAttendanceRoute(lesson))}
                      onGroup={() => navigate(`/groups/${lesson.groupId}`)}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border px-3 py-5 text-sm text-muted-foreground">
                  Сейчас занятий нет.
                  {lessons.upcoming[0]
                    ? ` Ближайшее — в ${time(lessons.upcoming[0].startsAt)}.`
                    : ' На сегодня занятий больше нет.'}
                </p>
              )}
            </WorkspaceCard>

            <WorkspaceCard title="Ближайшие">
              {lessons.upcoming.length ? (
                <div className="divide-y divide-border" data-testid="upcoming-lessons">
                  {lessons.upcoming.slice(0, 4).map((lesson) => (
                    <button
                      className="flex w-full items-start gap-3 py-2.5 text-left transition first:pt-0 last:pb-0 hover:text-accent-foreground"
                      key={lesson.id}
                      onClick={() => navigate(todayAttendanceRoute(lesson))}
                      type="button"
                    >
                      <span className="w-12 shrink-0 text-sm font-semibold">
                        {time(lesson.startsAt)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {lesson.groupName}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {[lesson.trainerName, lesson.roomName].filter(Boolean).join(' · ') ||
                            lesson.branchName}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                          <span>ожидается {lesson.expectedStudents}</span>
                          {lesson.trialStudents ? (
                            <Badge className="bg-amber-100 text-amber-900">
                              пробных {lesson.trialStudents}
                            </Badge>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-sm text-muted-foreground">На сегодня больше занятий нет.</p>
              )}
            </WorkspaceCard>

            <WorkspaceCard
              action={
                workspace.total > workspace.attention.length ? (
                  <Button onClick={() => navigate('/attention')} size="small" variant="ghost">
                    Показать все <ArrowRight className="size-3.5" />
                  </Button>
                ) : undefined
              }
              className="xl:row-span-2"
              title="Требуют внимания"
              titleBadge={workspace.total}
            >
              {workspace.attention.length ? (
                <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
                  {workspace.attention.map((item) => (
                    <AttentionCard
                      action={
                        <Button
                          onClick={() => navigate(item.actionRoute)}
                          size="small"
                          variant="ghost"
                        >
                          {item.actionLabel} <ArrowRight className="size-3.5" />
                        </Button>
                      }
                      description={item.description}
                      key={item.id}
                      meta={item.meta}
                      title={item.title}
                      tone={
                        item.priority === 'RED'
                          ? 'critical'
                          : item.priority === 'YELLOW'
                            ? 'warning'
                            : 'info'
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border px-3 py-5 text-sm text-muted-foreground">
                  Реальных действий на сейчас нет.
                </p>
              )}
            </WorkspaceCard>

            <WorkspaceCard title={`Пробные сегодня — ${String(currentStats.todayTrials.length)}`}>
              {currentStats.todayTrials.length ? (
                <div className="divide-y divide-border">
                  {currentStats.todayTrials.slice(0, 4).map((trial) => (
                    <button
                      className="grid w-full grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 py-2 text-left first:pt-0 last:pb-0"
                      key={trial.id}
                      onClick={() =>
                        navigate(
                          trial.studentId
                            ? `/attendance/${trial.lessonId}`
                            : `/leads?leadId=${encodeURIComponent(trial.leadId ?? '')}`,
                        )
                      }
                      type="button"
                    >
                      <span className="text-xs font-semibold">{time(trial.startsAt)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{trial.leadName}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {trial.groupName}
                        </span>
                      </span>
                      <Badge
                        className={
                          trial.state === 'MISSED'
                            ? 'bg-red-100 text-red-900'
                            : 'bg-amber-100 text-amber-900'
                        }
                      >
                        {trialStateLabel[trial.state]}
                      </Badge>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-3 text-sm text-muted-foreground">Пробных сегодня нет.</p>
              )}
            </WorkspaceCard>

            <WorkspaceCard title="Быстрые действия">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => navigate('/attendance')} size="small" variant="outline">
                  Посещаемость
                </Button>
                <Button onClick={() => navigate('/leads')} size="small" variant="outline">
                  Заявки
                </Button>
                <Button onClick={() => navigate('/students')} size="small" variant="outline">
                  Ученики
                </Button>
                <Button onClick={() => navigate('/schedule')} size="small" variant="outline">
                  Расписание
                </Button>
              </div>
              <button
                className="mt-3 flex w-full items-center justify-between rounded-xl bg-muted px-3 py-2 text-left text-sm"
                onClick={() => navigate('/finance')}
                type="button"
              >
                <span className="flex items-center gap-2 text-muted-foreground">
                  <CreditCard className="size-4" /> Получено сегодня
                </span>
                <strong>
                  <Money amount={currentStats.receivedToday} />
                </strong>
              </button>
            </WorkspaceCard>
          </div>
        </>
      )}
    </main>
  );
}

function CurrentLesson({
  lesson,
  onAttendance,
  onGroup,
}: {
  lesson: DashboardStats['todayLessons'][number];
  onAttendance: () => void;
  onGroup: () => void;
}) {
  const unmarked = Math.max(0, lesson.expectedStudents - lesson.attendanceMarked);
  const requiresAttention = Math.max(0, lesson.attendanceMarked - lesson.attendancePresent);
  return (
    <article className="rounded-xl border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {time(lesson.startsAt)}–{time(lesson.endsAt)}
          </p>
          <h4 className="truncate text-base font-semibold">{lesson.groupName}</h4>
          <p className="truncate text-xs text-muted-foreground">
            {[lesson.trainerName, lesson.roomName, lesson.branchName].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Badge className="bg-emerald-100 text-emerald-900">
          {lesson.attendancePresent} из {lesson.expectedStudents} пришли
        </Badge>
      </div>
      {unmarked || requiresAttention ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unmarked ? (
            <Badge className="bg-amber-100 text-amber-900">{unmarked} без отметки</Badge>
          ) : null}
          {requiresAttention ? (
            <Badge className="bg-red-100 text-red-900">{requiresAttention} требуют внимания</Badge>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 flex gap-2">
        <Button onClick={onAttendance} size="small" variant="outline">
          Посещаемость
        </Button>
        <Button onClick={onGroup} size="small" variant="ghost">
          Группа
        </Button>
      </div>
    </article>
  );
}

function SummaryCounter({
  icon: Icon,
  label,
  loading,
  onClick,
  value,
}: {
  icon: typeof CalendarCheck;
  label: string;
  loading: boolean;
  onClick: () => void;
  value: ReactNode;
}) {
  return (
    <button
      className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2 text-left shadow-card transition hover:bg-muted/40"
      onClick={onClick}
      type="button"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        {loading ? <RefreshCw className="size-3.5 animate-spin" /> : <Icon className="size-4" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] text-muted-foreground">{label}</span>
        <strong className="block text-lg leading-5">{loading ? '—' : value}</strong>
      </span>
    </button>
  );
}

function WorkspaceCard({
  action,
  children,
  className = '',
  title,
  titleBadge,
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  title: string;
  titleBadge?: number;
}) {
  return (
    <Card className={`min-w-0 overflow-hidden ${className}`}>
      <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          {titleBadge ? <Badge>{titleBadge}</Badge> : null}
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </Card>
  );
}

function time(value: string): string {
  return formatDate(value, { hour: '2-digit', minute: '2-digit' });
}
