import { formatDate, t, type StudentListQuery, type StudentStatus } from '@arava/shared';
import {
  Avatar,
  AttentionCard,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  LoadingState,
  Money,
  StatCard,
} from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BellRing,
  Building2,
  CalendarDays,
  CreditCard,
  HandCoins,
  Landmark,
  TrendingDown,
  WalletCards,
  Plus,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const recentStudentsQuery: StudentListQuery = {
  page: 1,
  pageSize: 5,
  sortBy: 'createdAt',
  sortDirection: 'desc',
};

const statusStyles: Record<StudentStatus, string> = {
  ACTIVE: '',
  ARCHIVED: 'bg-muted text-muted-foreground',
  FROZEN: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  LEFT: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
  TRIAL: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
};

function greetingKey(hour: number) {
  if (hour < 5) return 'dashboard.greeting.night' as const;
  if (hour < 12) return 'dashboard.greeting.morning' as const;
  if (hour < 18) return 'dashboard.greeting.afternoon' as const;
  return 'dashboard.greeting.evening' as const;
}

export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const stats = useQuery({
    queryFn: () => getDesktopApi().dashboard.stats(getSessionToken()),
    queryKey: queryKeys.dashboard,
  });
  const attention = useQuery({
    enabled: user?.role === 'OWNER' || user?.role === 'ADMIN',
    queryFn: () => getDesktopApi().attention.summary(getSessionToken()),
    queryKey: queryKeys.attentionSummary(user?.id),
  });
  const recentStudents = useQuery({
    queryFn: () => getDesktopApi().students.list(getSessionToken(), recentStudentsQuery),
    queryKey: queryKeys.students(recentStudentsQuery),
  });
  const firstName = user?.fullName.trim().split(/\s+/u)[0] ?? '';
  const now = new Date();
  const canManageStudents = user?.role !== 'COACH';
  const canManageBranches = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const canAccessFinance = user?.role !== 'COACH';
  const statMetadata = [
    { icon: UsersRound, key: 'students', label: t('dashboard.stat.students') },
    { icon: Building2, key: 'branches', label: t('dashboard.stat.activeBranches') },
    { icon: ShieldCheck, key: 'users', label: t('dashboard.stat.activeUsers') },
    { icon: UsersRound, key: 'activeGroups', label: t('dashboard.stat.activeGroups') },
    {
      icon: UsersRound,
      key: 'groupsWithPlaces',
      label: t('dashboard.stat.groupsWithPlaces'),
    },
    { icon: CalendarDays, key: 'lessonsToday', label: t('dashboard.stat.lessonsToday') },
    { icon: UserRoundCheck, key: 'expectedToday', label: t('dashboard.stat.expectedToday') },
    { icon: ShieldCheck, key: 'attendanceMarked', label: t('dashboard.stat.attendance') },
    {
      icon: UserRoundCheck,
      key: 'attendanceUnmarked',
      label: t('dashboard.stat.attendanceUnmarked'),
    },
  ] as const;
  const financeMetadata = [
    { icon: Landmark, key: 'revenueToday', label: t('dashboard.stat.revenueToday') },
    { icon: TrendingDown, key: 'expensesToday', label: 'Расходы сегодня' },
    { icon: WalletCards, key: 'netCashFlow', label: 'Чистый денежный поток' },
    { icon: Landmark, key: 'revenueThisMonth', label: t('dashboard.stat.revenueMonth') },
    { icon: CreditCard, key: 'outstandingDebt', label: t('dashboard.stat.outstandingDebt') },
    { icon: HandCoins, key: 'payrollPendingApproval', label: 'Зарплата к утверждению' },
  ] as const;

  return (
    <main className="mx-auto w-full max-w-[1540px] animate-fade-in p-9 pb-14">
      <header className="mb-8 flex items-end justify-between gap-8">
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            {t('dashboard.datePrefix', {
              date: formatDate(now, { day: 'numeric', month: 'long', weekday: 'long' }),
            })}
          </p>
          <h2 className="text-4xl font-semibold tracking-[-0.045em]">
            {t(greetingKey(now.getHours()), { name: firstName })}
          </h2>
          <p className="mt-2.5 text-base text-muted-foreground">{t('dashboard.subtitle')}</p>
        </div>
        {canManageStudents ? (
          <Button onClick={() => navigate('/students')}>
            <Plus className="size-4" />
            {t('dashboard.action.addStudent')}
          </Button>
        ) : null}
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
        <section aria-label={t('nav.dashboard')} className="grid grid-cols-3 gap-4">
          {statMetadata.map(({ icon, key, label }) => (
            <StatCard
              icon={icon}
              key={key}
              label={label}
              loading={stats.isLoading}
              value={stats.data?.[key] ?? 0}
            />
          ))}
          {canAccessFinance
            ? financeMetadata.map(({ icon, key, label }) => (
                <StatCard
                  icon={icon}
                  key={key}
                  label={label}
                  loading={stats.isLoading}
                  value={<Money amount={stats.data?.[key] ?? 0} />}
                />
              ))
            : null}
          <StatCard
            icon={CreditCard}
            label={t('dashboard.stat.subscriptionsExpiring')}
            loading={stats.isLoading}
            value={stats.data?.subscriptionsExpiringSoon ?? 0}
          />
          <StatCard
            icon={UsersRound}
            label="Группы с низкой заполняемостью"
            loading={stats.isLoading}
            value={stats.data?.groupsLowOccupancy ?? 0}
          />
          <StatCard
            icon={CreditCard}
            label={t('dashboard.stat.lowBalance')}
            loading={stats.isLoading}
            value={stats.data?.lowLessonBalance ?? 0}
          />
        </section>
      )}

      {canAccessFinance && attention.data?.total ? (
        <Card className="mt-5 overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>Требует внимания</CardTitle>
                <Badge className="bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  {attention.data.total}
                </Badge>
                {attention.data.criticalCount ? (
                  <Badge className="bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300">
                    Критично: {attention.data.criticalCount}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Главные операционные задачи на сегодня.
              </p>
            </div>
            <Button onClick={() => navigate('/attention')} size="small" variant="ghost">
              Показать всё <ArrowRight className="size-4" />
            </Button>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="mb-4 flex flex-wrap gap-2">
              {attention.data.categories.map(({ category, count }) => (
                <button
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold transition hover:border-neutral-400 hover:bg-surface"
                  key={category}
                  onClick={() => navigate(`/attention?category=${category}`)}
                  type="button"
                >
                  {attentionCategoryLabel(category)} · {count}
                </button>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {attention.data.items.map((item) => (
                <AttentionCard
                  action={
                    <Button
                      aria-label={item.actionLabel}
                      onClick={() => navigate(item.actionRoute)}
                      size="small"
                      variant="ghost"
                    >
                      <ArrowRight className="size-4" />
                    </Button>
                  }
                  description={item.description}
                  icon={<BellRing className="size-4" />}
                  key={item.id}
                  meta={item.branchName}
                  title={item.title}
                  tone={
                    item.severity === 'CRITICAL'
                      ? 'critical'
                      : item.severity === 'INFO'
                        ? 'info'
                        : 'warning'
                  }
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="mt-5 grid grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)] gap-5">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>{t('dashboard.recentStudents')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('dashboard.recentStudentsDescription')}
              </p>
            </div>
            <Button onClick={() => navigate('/students')} size="small" variant="ghost">
              {t('dashboard.action.students')} <ArrowRight className="size-4" />
            </Button>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            {recentStudents.isLoading ? <LoadingState label={t('student.loading')} /> : null}
            {recentStudents.data?.items.length === 0 ? (
              <p className="px-3 py-12 text-center text-sm text-muted-foreground">
                {t('dashboard.recentStudentsEmpty')}
              </p>
            ) : null}
            {recentStudents.data?.items.map((student) => {
              const name = `${student.lastName} ${student.firstName}`;
              return (
                <button
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-muted/70"
                  key={student.id}
                  onClick={() => navigate(`/students/${student.id}`)}
                  type="button"
                >
                  <Avatar name={name} size="small" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {student.branchName}
                    </span>
                  </span>
                  <Badge className={statusStyles[student.status]}>
                    {t(`status.${student.status}`)}
                  </Badge>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.quickActions')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <QuickAction
                icon={UsersRound}
                label={t('dashboard.action.students')}
                onClick={() => navigate('/students')}
              />
              <QuickAction
                icon={UserRoundCheck}
                label={t('dashboard.action.attendance')}
                onClick={() => navigate('/schedule')}
              />
              <QuickAction
                icon={CalendarDays}
                label={t('nav.schedule')}
                onClick={() => navigate('/schedule')}
              />
              {canManageBranches ? (
                <QuickAction
                  icon={Building2}
                  label={t('dashboard.action.branches')}
                  onClick={() => navigate('/branches')}
                />
              ) : null}
              {canAccessFinance ? (
                <>
                  <QuickAction
                    icon={CreditCard}
                    label={t('nav.tariffs')}
                    onClick={() => navigate('/tariffs')}
                  />
                  <QuickAction
                    icon={Landmark}
                    label={t('nav.finance')}
                    onClick={() => navigate('/finance')}
                  />
                  <QuickAction
                    icon={TrendingDown}
                    label="Добавить расход"
                    onClick={() => navigate('/expenses')}
                  />
                  <QuickAction
                    icon={HandCoins}
                    label="Рассчитать зарплату"
                    onClick={() => navigate('/payroll')}
                  />
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}

function attentionCategoryLabel(category: string): string {
  return (
    {
      ATTENDANCE: 'Посещаемость',
      CARDS: 'Карты',
      PAYMENTS: 'Оплаты',
      PAYROLL: 'Зарплата',
      ROOMS: 'Залы',
      SCHEDULE: 'Расписание',
      STUDENTS: 'Ученики',
      SUBSCRIPTIONS: 'Абонементы',
      SUBSTITUTIONS: 'Замены',
      BACKUPS: 'Резервные копии',
    }[category] ?? category
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof UsersRound;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3.5 text-left text-sm font-semibold transition hover:-translate-y-0.5 hover:border-neutral-400 hover:bg-surface"
      onClick={onClick}
      type="button"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-foreground dark:bg-accent/10 dark:text-accent">
        <Icon className="size-4" />
      </span>
      {label}
      <ArrowRight className="ml-auto size-4 text-muted-foreground" />
    </button>
  );
}
