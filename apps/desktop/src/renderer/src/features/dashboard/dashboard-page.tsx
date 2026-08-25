import { formatDate, t, type DashboardStats } from '@arava/shared';
import {
  AttentionCard,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Money,
  StatCard,
} from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BellRing,
  CalendarClock,
  CalendarDays,
  CircleAlert,
  CreditCard,
  Inbox,
  MessageCircle,
  Plus,
  RefreshCw,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { buildDashboardWorkspace, type DashboardActionItem } from './dashboard-workspace';
import { classifyTodayLessons } from './dashboard-today';

function greetingKey(hour: number) {
  if (hour < 5) return 'dashboard.greeting.night' as const;
  if (hour < 12) return 'dashboard.greeting.morning' as const;
  if (hour < 18) return 'dashboard.greeting.afternoon' as const;
  return 'dashboard.greeting.evening' as const;
}

const EMPTY_STATS: DashboardStats = {
  activeGroups: 0,
  attendanceMarked: 0,
  attendanceUnmarked: 0,
  branches: 0,
  expectedToday: 0,
  expensesToday: 0,
  groupsLowOccupancy: 0,
  groupsWithPlaces: 0,
  lessonsToday: 0,
  lowLessonBalance: 0,
  netCashFlow: 0,
  outstandingDebt: 0,
  payrollPendingApproval: 0,
  problematicPayments: 0,
  revenueThisMonth: 0,
  revenueToday: 0,
  students: 0,
  subscriptionsExpiringSoon: 0,
  trialStudents: 0,
  trialsToday: 0,
  users: 0,
  todayLessons: [],
};

export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const manager = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const accessKey = `${user?.id ?? ''}:${user?.role ?? ''}:${[...(user?.branchIds ?? [])].sort().join(',')}`;
  const stats = useQuery({
    queryFn: () => getDesktopApi().dashboard.stats(getSessionToken()),
    queryKey: [...queryKeys.dashboard, accessKey],
    refetchInterval: 30_000,
    refetchOnMount: 'always',
  });
  const attention = useQuery({
    enabled: manager,
    queryFn: () => getDesktopApi().attention.list(getSessionToken(), {}),
    queryKey: queryKeys.attention({ accessKey, dashboard: true }),
    refetchInterval: 30_000,
    refetchOnMount: 'always',
  });
  const leads = useQuery({
    enabled: manager,
    queryFn: () => getDesktopApi().leads.list(getSessionToken(), { status: 'NEW' }),
    queryKey: queryKeys.leads(accessKey, { status: 'NEW' }),
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    retry: false,
  });
  const chats = useQuery({
    enabled: Boolean(user),
    queryFn: () => getDesktopApi().chats.list(getSessionToken(), { filter: 'UNREAD' }),
    queryKey: queryKeys.chats(accessKey, { filter: 'UNREAD' }),
    refetchInterval: 20_000,
    refetchOnMount: 'always',
    retry: false,
  });
  const trials = useQuery({
    enabled: manager,
    queryFn: () => {
      const dateFrom = new Date();
      dateFrom.setHours(0, 0, 0, 0);
      const dateTo = new Date(dateFrom);
      dateTo.setHours(23, 59, 59, 999);
      return getDesktopApi().trials.list(getSessionToken(), {
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
        includeFollowUp: true,
      });
    },
    queryKey: queryKeys.trials(accessKey, { dashboard: true }),
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    retry: false,
  });
  const firstName = user?.fullName.trim().split(/\s+/u)[0] ?? '';
  const now = useMemo(() => new Date(stats.dataUpdatedAt || Date.now()), [stats.dataUpdatedAt]);
  const currentStats = stats.data ?? EMPTY_STATS;
  const workspace = useMemo(
    () =>
      buildDashboardWorkspace({
        attention: attention.data ?? [],
        chats: chats.data?.conversations ?? [],
        leads: leads.data?.leads ?? [],
        now,
        trials: trials.data ?? [],
      }),
    [attention.data, chats.data?.conversations, leads.data?.leads, now, trials.data],
  );
  const trialsToday =
    trials.data?.filter((trial) => {
      const date = new Date(trial.startsAt);
      return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
      );
    }).length ?? currentStats.trialsToday;
  const subscriptionAttention =
    attention.data?.filter(({ category }) => category === 'SUBSCRIPTIONS').length ?? 0;
  const paymentProblems =
    attention.data?.filter(
      ({ category, severity }) => category === 'PAYMENTS' && severity === 'CRITICAL',
    ).length ?? currentStats.problematicPayments;
  const refresh = () => {
    void Promise.all([
      stats.refetch(),
      attention.refetch(),
      leads.refetch(),
      chats.refetch(),
      trials.refetch(),
    ]);
  };

  return (
    <main className="mx-auto w-full max-w-[1540px] animate-fade-in p-6 pb-12 2xl:p-9">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-1.5 text-sm font-medium text-muted-foreground">
            {t('dashboard.datePrefix', {
              date: formatDate(now, { day: 'numeric', month: 'long', weekday: 'long' }),
            })}
          </p>
          <h2 className="text-4xl font-semibold tracking-[-0.045em]">
            {t(greetingKey(now.getHours()), { name: firstName })}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Всё важное для рабочего дня — в одном месте.
          </p>
        </div>
        <div className="flex gap-2">
          <Button aria-label="Обновить рабочий день" onClick={refresh} variant="outline">
            <RefreshCw
              className={`size-4 ${stats.isFetching || attention.isFetching ? 'animate-spin' : ''}`}
            />
            Обновить
          </Button>
          {manager ? (
            <Button onClick={() => navigate('/students')}>
              <Plus className="size-4" /> Добавить ученика
            </Button>
          ) : null}
        </div>
      </header>

      {stats.isError ? (
        <Card>
          <ErrorState
            message={t('dashboard.error')}
            onRetry={() => void stats.refetch()}
            retryLabel={t('common.retry')}
            title={t('common.errorTitle')}
          />
        </Card>
      ) : (
        <section aria-label="Сегодня">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xl font-semibold tracking-tight">Сегодня</h3>
            <span className="text-xs text-muted-foreground">Обновляется автоматически</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <TodayCounter
              icon={CalendarDays}
              label="Занятий"
              loading={stats.isLoading}
              onClick={() => navigate('/schedule')}
              value={currentStats.lessonsToday}
            />
            <TodayCounter
              icon={Sparkles}
              label="Пробных"
              loading={stats.isLoading}
              onClick={() => navigate('/attendance')}
              value={trialsToday}
            />
            <TodayCounter
              icon={Inbox}
              label="Новых заявок"
              loading={leads.isLoading}
              onClick={() => navigate('/leads')}
              value={leads.data?.newCount ?? 0}
            />
            <TodayCounter
              icon={MessageCircle}
              label="Непрочитанных"
              loading={chats.isLoading}
              onClick={() => navigate('/chats')}
              value={chats.data?.totalUnread ?? 0}
            />
            <TodayCounter
              icon={CreditCard}
              label="Абонементы"
              loading={attention.isLoading}
              onClick={() => navigate('/attention?category=SUBSCRIPTIONS')}
              tone={subscriptionAttention ? 'warning' : 'neutral'}
              value={subscriptionAttention}
            />
            <TodayCounter
              icon={CircleAlert}
              label="Проблемы оплат"
              loading={attention.isLoading}
              onClick={() => navigate('/attention?category=PAYMENTS')}
              tone={paymentProblems ? 'critical' : 'neutral'}
              value={paymentProblems}
            />
          </div>
        </section>
      )}

      {manager ? (
        <LessonTimeline
          lessons={currentStats.todayLessons}
          now={now}
          onOpenAttendance={() => navigate('/attendance')}
        />
      ) : null}

      {manager ? (
        <section className="mt-5 grid items-start gap-5 xl:grid-cols-2">
          <ActionQueue
            empty="Срочных проблем нет."
            icon={BellRing}
            items={workspace.attention}
            onNavigate={navigate}
            title="Требует внимания"
          />
          <ActionQueue
            empty="На сегодня обязательных действий нет."
            icon={UserRoundCheck}
            items={workspace.today}
            onNavigate={navigate}
            title="Нужно сделать сегодня"
          />
        </section>
      ) : null}

      <section className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <ActionQueue
          empty="На ближайшие семь дней отдельных предупреждений нет."
          icon={CalendarClock}
          items={workspace.upcoming}
          onNavigate={navigate}
          title="Ближайшее"
        />
        <Card>
          <CardHeader>
            <CardTitle>Ход дня</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Актуальные операционные показатели.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <CompactMetric label="Ожидается учеников" value={currentStats.expectedToday} />
            <CompactMetric label="Отмечено посещений" value={currentStats.attendanceMarked} />
            <CompactMetric label="Не отмечено" value={currentStats.attendanceUnmarked} />
            {manager ? (
              <CompactMetric
                label="Выручка сегодня"
                value={<Money amount={currentStats.revenueToday} />}
              />
            ) : null}
          </CardContent>
        </Card>
      </section>

      {manager ? (
        <section className="mt-5">
          <Card>
            <CardHeader>
              <CardTitle>Быстрые действия</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button onClick={() => navigate('/students')} variant="outline">
                Найти ученика
              </Button>
              <Button onClick={() => navigate('/leads')} variant="outline">
                Заявки
              </Button>
              <Button onClick={() => navigate('/attendance')} variant="outline">
                Посещения
              </Button>
              <Button onClick={() => navigate('/schedule')} variant="outline">
                Расписание
              </Button>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </main>
  );
}

function LessonTimeline({
  lessons,
  now,
  onOpenAttendance,
}: {
  lessons: DashboardStats['todayLessons'];
  now: Date;
  onOpenAttendance: () => void;
}) {
  const { current, upcoming } = classifyTodayLessons(lessons, now);
  return (
    <section className="mt-5 grid items-start gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Идёт сейчас</CardTitle>
        </CardHeader>
        <CardContent>
          {current.length ? (
            <div className="space-y-3">
              {current.map((lesson) => (
                <TodayLesson key={lesson.id} lesson={lesson} onOpen={onOpenAttendance} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Сейчас занятий нет.
              {upcoming[0]
                ? ` Ближайшее начнётся в ${formatDate(upcoming[0].startsAt, { hour: '2-digit', minute: '2-digit' })}.`
                : ''}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Дальше сегодня</CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length ? (
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {upcoming.map((lesson) => (
                <TodayLesson key={lesson.id} lesson={lesson} onOpen={onOpenAttendance} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">На сегодня больше занятий нет.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function TodayLesson({
  lesson,
  onOpen,
}: {
  lesson: DashboardStats['todayLessons'][number];
  onOpen: () => void;
}) {
  return (
    <button
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-border p-4 text-left transition hover:bg-muted/50"
      onClick={onOpen}
      type="button"
    >
      <span className="min-w-0">
        <span className="block font-semibold">{lesson.groupName}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {[lesson.trainerName, lesson.branchName, lesson.roomName].filter(Boolean).join(' · ')}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {lesson.expectedStudents} учеников · присутствуют {lesson.attendanceMarked}
        </span>
      </span>
      <span className="shrink-0 text-sm font-semibold">
        {formatDate(lesson.startsAt, { hour: '2-digit', minute: '2-digit' })}–
        {formatDate(lesson.endsAt, { hour: '2-digit', minute: '2-digit' })}
      </span>
    </button>
  );
}

function TodayCounter({
  icon,
  label,
  loading,
  onClick,
  tone = 'neutral',
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  loading: boolean;
  onClick: () => void;
  tone?: 'critical' | 'neutral' | 'warning';
  value: number;
}) {
  const toneClass =
    tone === 'critical'
      ? 'border-red-200 bg-red-50/70 dark:border-red-500/20 dark:bg-red-500/5'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-500/5'
        : '';
  return (
    <button className="min-w-0 text-left" onClick={onClick} type="button">
      <StatCard className={toneClass} icon={icon} label={label} loading={loading} value={value} />
    </button>
  );
}

function ActionQueue({
  empty,
  icon: Icon,
  items,
  onNavigate,
  title,
}: {
  empty: string;
  icon: typeof BellRing;
  items: DashboardActionItem[];
  onNavigate: (route: string) => void;
  title: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Icon className="size-5" />
          <CardTitle>{title}</CardTitle>
          {items.length ? <Badge>{items.length}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5">
        {!items.length ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {empty}
          </p>
        ) : null}
        {items.map((item) => (
          <AttentionCard
            action={
              <Button onClick={() => onNavigate(item.actionRoute)} size="small" variant="ghost">
                {item.actionLabel} <ArrowRight className="size-4" />
              </Button>
            }
            description={item.description}
            key={item.id}
            meta={item.meta}
            title={item.title}
            tone={
              item.priority === 'RED' ? 'critical' : item.priority === 'YELLOW' ? 'warning' : 'info'
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

function CompactMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
