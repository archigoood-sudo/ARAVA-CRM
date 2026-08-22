import {
  formatDate,
  type GroupStatus,
  type LessonStatus,
  type PayrollPeriodStatus,
  type PayrollType,
  type TrainerProfileLesson,
} from '@arava/shared';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  formatMoney,
  StatusBadge,
} from '@arava/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  KeyRound,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const groupStatuses: Record<GroupStatus, string> = {
  ACTIVE: 'Активна',
  ARCHIVED: 'Архив',
  PAUSED: 'Приостановлена',
  RECRUITING: 'Набор',
};

const lessonStatuses: Record<LessonStatus, string> = {
  CANCELLED: 'Отменено',
  COMPLETED: 'Проведено',
  PLANNED: 'Запланировано',
};

const payrollStatuses: Record<PayrollPeriodStatus, string> = {
  APPROVED: 'Утверждено',
  CALCULATED: 'Рассчитано',
  CANCELLED: 'Отменено',
  DRAFT: 'Черновик',
  PAID: 'Выплачено',
};

const payrollTypes: Record<PayrollType, string> = {
  COMBINED: 'Комбинированная ставка',
  FIXED_MONTHLY: 'За месяц',
  FIXED_PER_LESSON: 'За занятие',
  PERCENT_OF_REVENUE: 'Процент от выручки',
  PER_ATTENDEE: 'За присутствующего',
};

const weekdays = [
  '',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
];

function currentMonth(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthTitle(month: string): string {
  const [year, number] = month.split('-').map(Number);
  if (year === undefined || number === undefined) return month;
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(
    new Date(year, number - 1, 1),
  );
}

function LessonRow({ lesson }: { lesson: TrainerProfileLesson }) {
  return (
    <Link
      className="group flex items-center gap-4 rounded-2xl border border-border bg-background/60 p-4 transition hover:border-neutral-300 hover:bg-surface"
      to={`/lessons/${lesson.id}`}
    >
      <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-sidebar text-white">
        <span className="text-sm font-bold">
          {formatDate(lesson.startsAt, { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{lesson.groupName}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {lesson.branchName}
          {lesson.roomName ? ` · ${lesson.roomName}` : ''}
        </p>
        {lesson.isSubstitution ? (
          <p className="mt-1 text-xs font-medium text-blue-600">
            {lesson.actualTrainerName === lesson.scheduledTrainerName
              ? 'В занятии назначена замена'
              : `По замене · вместо ${lesson.scheduledTrainerName ?? 'тренера'}`}
          </p>
        ) : null}
      </div>
      <StatusBadge
        tone={
          lesson.status === 'CANCELLED'
            ? 'danger'
            : lesson.status === 'COMPLETED'
              ? 'success'
              : 'muted'
        }
      >
        {lessonStatuses[lesson.status]}
      </StatusBadge>
      <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
    </Link>
  );
}

export function TrainerProfilePage() {
  const { trainerId = '' } = useParams();
  const actor = useAuthStore((state) => state.user);
  const [month, setMonth] = useState(currentMonth);
  const [actionMessage, setActionMessage] = useState<string>();
  const accessKey = actor
    ? `${actor.id}:${actor.role}:${[...actor.branchIds].sort().join(',')}`
    : 'anonymous';
  const profile = useQuery({
    enabled: Boolean(actor && trainerId),
    queryFn: () => getDesktopApi().trainers.getProfile(getSessionToken(), trainerId, month),
    queryKey: queryKeys.trainerProfile(trainerId, month, accessKey),
  });
  const resetPassword = useMutation({
    mutationFn: () => getDesktopApi().users.resetPassword(getSessionToken(), trainerId),
  });

  if (profile.isLoading) return <LoadingState label="Загружаем профиль тренера…" />;
  if (profile.isError || !profile.data)
    return (
      <ErrorState
        message={getErrorMessage(profile.error, 'Не удалось загрузить профиль тренера.')}
        onRetry={() => void profile.refetch()}
        retryLabel="Повторить"
        title="Профиль недоступен"
      />
    );

  const data = profile.data;
  const nextLesson = data.upcomingLessons[0];
  return (
    <main className="mx-auto w-full max-w-[1480px] animate-fade-in p-9 pb-16">
      {actor?.role !== 'COACH' ? (
        <Link
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          to="/users"
        >
          <ArrowLeft className="size-4" />
          Сотрудники
        </Link>
      ) : null}

      <Card className="overflow-hidden border-0 bg-sidebar text-white shadow-lg shadow-black/10">
        <div className="relative flex flex-wrap items-center gap-6 px-8 py-9">
          <div className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-accent/10 blur-3xl" />
          <Avatar className="ring-4 ring-white/10" name={data.trainer.fullName} size="large" />
          <div className="relative min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-4xl font-semibold tracking-[-0.045em]">
                {data.trainer.fullName}
              </h2>
              <StatusBadge tone={data.trainer.isActive ? 'success' : 'muted'}>
                {data.trainer.isActive ? 'Активен' : 'Неактивен'}
              </StatusBadge>
              <Badge className="bg-accent/15 text-accent">Тренер</Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-400">
              {data.trainer.branches.map((branch) => (
                <span className="flex items-center gap-1.5" key={branch.id}>
                  <MapPin className="size-3.5 text-accent" /> {branch.name}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <Mail className="size-3.5" /> {data.trainer.email}
              </span>
              {data.trainer.phone ? (
                <span className="flex items-center gap-1.5">
                  <Phone className="size-3.5" /> {data.trainer.phone}
                </span>
              ) : null}
            </div>
            {data.trainer.directions.length ? (
              <p className="mt-3 text-sm text-neutral-300">{data.trainer.directions.join(' · ')}</p>
            ) : null}
            {data.trainer.trainerDescription ? (
              <p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-neutral-300">
                {data.trainer.trainerDescription}
              </p>
            ) : null}
          </div>
          <div className="relative flex flex-wrap gap-2">
            <Button onClick={() => window.location.assign('#/schedule')} variant="outline">
              <CalendarDays className="size-4" /> Открыть расписание
            </Button>
            {data.permissions.canManageTrainer ? (
              <Button onClick={() => window.location.assign('#/users')} variant="outline">
                Изменить профиль
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {data.attention.length ? (
        <section className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <CircleAlert className="size-5" /> Требует внимания
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {data.attention.map((item) => (
              <Link
                className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 text-sm font-medium transition hover:bg-white"
                key={item.code}
                to={item.actionRoute}
              >
                {item.message}
                <ChevronRight className="size-4" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {data.permissions.canManageTrainer ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button onClick={() => window.location.assign('#/groups')} variant="outline">
            <UsersRound className="size-4" /> Открыть группы
          </Button>
          <Button onClick={() => window.location.assign('#/payroll')} variant="outline">
            <WalletCards className="size-4" /> Открыть зарплату
          </Button>
          {nextLesson ? (
            <Link
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-muted"
              to={`/lessons/${nextLesson.id}`}
            >
              <Sparkles className="size-4" /> Назначить замену
            </Link>
          ) : null}
          {data.permissions.canResetPassword ? (
            <Button
              disabled={resetPassword.isPending}
              onClick={() => {
                if (!window.confirm(`Сбросить пароль тренера «${data.trainer.fullName}»?`)) return;
                void resetPassword
                  .mutateAsync()
                  .then((result) =>
                    setActionMessage(`Временный пароль: ${result.temporaryPassword}`),
                  )
                  .catch((error: unknown) =>
                    setActionMessage(getErrorMessage(error, 'Не удалось сбросить пароль.')),
                  );
              }}
              variant="outline"
            >
              <KeyRound className="size-4" /> Сбросить пароль
            </Button>
          ) : null}
          {actionMessage ? (
            <span className="rounded-xl bg-muted px-4 py-2 text-sm font-medium">
              {actionMessage}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <section className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="size-5 text-blue-600" /> Сегодня
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.today.length ? (
                  data.today.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} />)
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Сегодня занятий нет.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock3 className="size-5 text-accent-foreground" /> Ближайшее занятие
                </CardTitle>
              </CardHeader>
              <CardContent>
                {nextLesson ? (
                  <div className="rounded-2xl bg-muted/60 p-5">
                    <p className="text-2xl font-semibold">{nextLesson.groupName}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {formatDate(nextLesson.startsAt, { dateStyle: 'long', timeStyle: 'short' })}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {nextLesson.branchName}
                      {nextLesson.roomName ? ` · ${nextLesson.roomName}` : ''}
                    </p>
                    {nextLesson.isSubstitution ? (
                      <Badge className="mt-4 bg-blue-50 text-blue-700">Замена</Badge>
                    ) : null}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Ближайших занятий нет.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Группы</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {data.groups.length ? (
                data.groups.map((group) => (
                  <Link
                    className="rounded-2xl border border-border p-5 transition hover:border-neutral-300 hover:bg-muted/30"
                    key={group.id}
                    to={`/groups/${group.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{group.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {group.direction} · {group.branchName}
                        </p>
                      </div>
                      <StatusBadge tone="muted">{groupStatuses[group.status]}</StatusBadge>
                    </div>
                    <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-xl font-semibold">{group.studentCount}</p>
                        <p className="text-[11px] text-muted-foreground">учеников</p>
                      </div>
                      <div>
                        <p className="text-xl font-semibold">{group.attendancePercentage}%</p>
                        <p className="text-[11px] text-muted-foreground">посещаемость</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold">
                          {group.nextLesson
                            ? formatDate(group.nextLesson.startsAt, {
                                day: '2-digit',
                                month: 'short',
                              })
                            : 'Нет'}
                        </p>
                        <p className="text-[11px] text-muted-foreground">следующее</p>
                      </div>
                    </div>
                    {group.schedule.length ? (
                      <p className="mt-4 text-xs leading-5 text-muted-foreground">
                        {group.schedule.join(' · ')}
                      </p>
                    ) : null}
                  </Link>
                ))
              ) : (
                <EmptyState
                  description="У тренера пока нет активных групп."
                  icon={UsersRound}
                  title="Группы не назначены"
                />
              )}
            </CardContent>
          </Card>

          {data.historicalGroups.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Архивные группы</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 md:grid-cols-2">
                {data.historicalGroups.map((group) => (
                  <Link
                    className="flex items-center justify-between rounded-2xl border border-border px-4 py-3 text-sm transition hover:bg-muted/30"
                    key={group.id}
                    to={`/groups/${group.id}`}
                  >
                    <span>
                      <span className="font-semibold">{group.name}</span>
                      <span className="ml-2 text-muted-foreground">
                        {group.direction} · {group.branchName}
                      </span>
                    </span>
                    <StatusBadge tone="muted">Архив</StatusBadge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Расписание</CardTitle>
            </CardHeader>
            <CardContent>
              {data.schedule.length ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {data.schedule.map((item) => (
                    <div
                      className="flex items-center gap-4 rounded-2xl border border-border p-4"
                      key={item.id}
                    >
                      <div className="w-24 text-sm font-semibold">{weekdays[item.weekday]}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.groupName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.startTime}–{item.endTime} · {item.branchName}
                          {item.roomName ? ` · ${item.roomName}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Регулярное расписание не назначено.
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-5">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Период</CardTitle>
              <input
                aria-label="Месяц профиля"
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
                onChange={(event) => setMonth(event.target.value)}
                type="month"
                value={month}
              />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold capitalize">{monthTitle(month)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Проведённые занятия</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {[
                ['Запланировано', data.activity.scheduled],
                ['Проведено', data.activity.conducted],
                ['Проведено по замене', data.activity.substitutionsConducted],
                ['Отменено', data.activity.cancelled],
              ].map(([label, value]) => (
                <div className="rounded-2xl bg-muted/50 p-4" key={String(label)}>
                  <p className="text-2xl font-semibold">{value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Посещаемость</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-2xl font-semibold">{data.attendance.presentTotal}</p>
                  <p className="text-[11px] text-muted-foreground">присутствий</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold">{data.attendance.averagePresent}</p>
                  <p className="text-[11px] text-muted-foreground">в среднем</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold">{data.attendance.percentage}%</p>
                  <p className="text-[11px] text-muted-foreground">посещаемость</p>
                </div>
              </div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Учитываются только отметки «Присутствовал» на фактически проведённых тренером
                занятиях.
              </p>
            </CardContent>
          </Card>
          <Card className="border-neutral-800 bg-sidebar text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <WalletCards className="size-5 text-accent" /> Зарплата
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-neutral-400">Начислено за период</p>
              <Money
                amount={data.payroll.accruedAmount}
                className="mt-1 block text-4xl font-semibold tracking-tight"
              />
              <div className="mt-5 grid grid-cols-4 gap-2 border-t border-white/10 pt-5 text-center">
                <div>
                  <p className="font-semibold">{data.payroll.lessonsIncluded}</p>
                  <p className="text-[11px] text-neutral-500">занятий</p>
                </div>
                <div>
                  <p className="font-semibold">{data.payroll.presentCount}</p>
                  <p className="text-[11px] text-neutral-500">присутствий</p>
                </div>
                <div>
                  <Money amount={data.payroll.approvedAmount} className="font-semibold" />
                  <p className="text-[11px] text-neutral-500">утверждено</p>
                </div>
                <div>
                  <Money amount={data.payroll.paidAmount} className="font-semibold" />
                  <p className="text-[11px] text-neutral-500">выплачено</p>
                </div>
              </div>
              {data.payroll.pendingAttendanceCount ? (
                <Link
                  className="mt-5 flex items-center gap-2 rounded-xl bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-300"
                  to="/payroll"
                >
                  <CircleAlert className="size-4" /> Ожидает посещаемость ·{' '}
                  {data.payroll.pendingAttendanceCount}
                </Link>
              ) : null}
              {data.payroll.statuses.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.payroll.statuses.map((status) => (
                    <Badge className="bg-white/10 text-neutral-200" key={status}>
                      {payrollStatuses[status]}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Замены</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {[
              { label: 'Тренер заменяет коллегу', items: data.substitutions.incoming },
              { label: 'Тренера заменяет коллега', items: data.substitutions.outgoing },
            ].map((section) => (
              <div key={section.label}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </p>
                {section.items.length ? (
                  <div className="space-y-2">
                    {section.items.map((item) => (
                      <Link
                        className="flex items-center gap-3 rounded-2xl border border-border p-4"
                        key={item.id}
                        to={`/lessons/${item.lessonId}`}
                      >
                        <Sparkles className="size-4 text-blue-600" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{item.groupName}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDate(item.startsAt, { dateStyle: 'medium', timeStyle: 'short' })}{' '}
                            · {item.branchName}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.originalTrainerName ?? 'Без основного тренера'} →{' '}
                            {item.substituteTrainerName}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
                    Замен нет.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Детализация зарплаты</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.payroll.details.length ? (
              data.payroll.details.map((item) => (
                <div
                  className="flex items-center gap-4 rounded-2xl border border-border p-4"
                  key={item.id}
                >
                  <CheckCircle2 className="size-4 text-green-600" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {item.lessonStartsAt
                        ? formatDate(item.lessonStartsAt, { dateStyle: 'medium' })
                        : 'Ежемесячное начисление'}{' '}
                      · {item.groupName ?? item.branchName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.type === 'PER_ATTENDEE' && item.attendeeCount !== undefined
                        ? `${String(item.attendeeCount)} × ${formatMoney(item.rate)}`
                        : payrollTypes[item.type]}{' '}
                      · {payrollStatuses[item.periodStatus]}
                    </p>
                  </div>
                  <Money amount={item.finalAmount} className="font-semibold" />
                </div>
              ))
            ) : (
              <EmptyState
                description="После расчёта зарплаты здесь появится расшифровка."
                icon={WalletCards}
                title="Начислений за период нет"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
