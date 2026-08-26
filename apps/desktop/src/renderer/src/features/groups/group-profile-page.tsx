import {
  formatDate,
  formatWeekday,
  t,
  type GroupRosterMember,
  type StudentBulkAction,
  type StudentBulkExecutionResult,
} from '@arava/shared';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Money,
  StatusBadge,
} from '@arava/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRightLeft,
  CalendarCheck2,
  CalendarDays,
  CheckSquare,
  Plus,
  RefreshCw,
  Search,
  Snowflake,
  UserMinus,
  UsersRound,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { localDateInputValue } from '../../lib/local-date';
import { invalidateStudentIdentityCaches } from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { StudentBulkDialog } from '../students/student-bulk-dialog';
import { GroupAddStudentsDialog } from './group-add-students-dialog';
import { activeTrialGuests } from './group-profile-model';

type RosterFilter =
  | 'ACTIVE'
  | 'ALL'
  | 'DEBT'
  | 'FORMER'
  | 'FROZEN'
  | 'FUTURE'
  | 'NO_SUBSCRIPTION'
  | 'RECENT'
  | 'TRIAL';

const filterLabels: Record<RosterFilter, string> = {
  ACTIVE: 'Активные',
  ALL: 'Все текущие',
  DEBT: 'С долгом',
  FORMER: 'Выбыли',
  FROZEN: 'Заморожены',
  FUTURE: 'Начнут позже',
  NO_SUBSCRIPTION: 'Без абонемента',
  RECENT: 'Недавно добавлены',
  TRIAL: 'Пробные',
};

function matchesFilter(member: GroupRosterMember, filter: RosterFilter): boolean {
  if (filter === 'FORMER') return member.segment === 'FORMER';
  if (filter === 'FUTURE') return member.segment === 'FUTURE';
  if (member.segment !== 'CURRENT') return false;
  if (filter === 'ALL') return true;
  if (filter === 'ACTIVE')
    return member.membershipStatus === 'ACTIVE' && member.studentStatus === 'ACTIVE';
  if (filter === 'TRIAL')
    return member.membershipStatus === 'TRIAL' || member.studentStatus === 'TRIAL';
  if (filter === 'FROZEN')
    return member.membershipStatus === 'FROZEN' || member.studentStatus === 'FROZEN';
  if (filter === 'RECENT') return member.recentlyAdded;
  if (filter === 'DEBT') return (member.totalDebt ?? 0) > 0;
  return !member.subscription;
}

function lastAttendanceLabel(value: string | undefined, today: string): string {
  if (!value) return 'Ещё не посещал';
  const date = value.slice(0, 10);
  if (date === today) return 'Был сегодня';
  const yesterday = new Date(`${today}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === localDateInputValue(yesterday)) return 'Был вчера';
  return `Был ${formatDate(value, { day: '2-digit', month: '2-digit' })}`;
}

function subscriptionLabel(member: GroupRosterMember): string {
  const subscription = member.subscription;
  if (!subscription) return 'Нет активного абонемента';
  if (subscription.remainingLessons === undefined) return subscription.tariffName;
  return `${subscription.tariffName} · осталось ${String(subscription.remainingLessons)}`;
}

export function GroupProfilePage() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const accessKey = `${user?.id ?? 'guest'}:${user?.role ?? 'none'}:${user?.branchIds.join(',') ?? ''}`;
  const today = localDateInputValue();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedFilter = searchParams.get('roster');
  const filter: RosterFilter = Object.hasOwn(filterLabels, requestedFilter ?? '')
    ? (requestedFilter as RosterFilter)
    : 'ALL';
  const search = searchParams.get('q') ?? '';
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<StudentBulkAction>();
  const [addSelectionOpen, setAddSelectionOpen] = useState(false);
  const [addStudentIds, setAddStudentIds] = useState<string[]>([]);
  const [result, setResult] = useState<string>();
  const group = useQuery({
    enabled: Boolean(groupId),
    queryFn: () => getDesktopApi().groups.get(getSessionToken(), groupId),
    queryKey: queryKeys.group(groupId),
    refetchOnMount: 'always',
  });
  const roster = useQuery({
    enabled: Boolean(groupId),
    queryFn: () => getDesktopApi().groups.getRoster(getSessionToken(), groupId, today),
    queryKey: queryKeys.groupRoster(groupId, today, accessKey),
    refetchOnMount: 'always',
  });
  const eligibleStudents = useQuery({
    enabled: Boolean(groupId) && canManage,
    queryFn: () => getDesktopApi().groups.listEligibleStudents(getSessionToken(), groupId),
    queryKey: ['students', 'eligible-for-group', groupId],
  });
  const groups = useQuery({
    enabled: canManage,
    queryFn: () => getDesktopApi().groups.list(getSessionToken(), {}),
    queryKey: queryKeys.groups({}),
  });
  const upcomingTrials = useQuery({
    enabled: Boolean(groupId) && canManage,
    queryFn: () => {
      const from = new Date();
      const to = new Date(from);
      to.setDate(to.getDate() + 30);
      return getDesktopApi().trials.list(getSessionToken(), {
        dateFrom: from.toISOString(),
        dateTo: to.toISOString(),
        groupId,
      });
    },
    queryKey: queryKeys.trials(accessKey, { groupId, upcoming: true }),
  });
  const members = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('ru-RU');
    return (roster.data?.members ?? []).filter(
      (member) =>
        matchesFilter(member, filter) &&
        (!term ||
          member.studentName.toLocaleLowerCase('ru-RU').includes(term) ||
          member.studentPhone?.includes(term)),
    );
  }, [filter, roster.data?.members, search]);
  const selectableIds = members
    .filter(({ segment }) => segment === 'CURRENT')
    .map(({ studentId }) => studentId);
  const allVisibleSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const setView = (nextFilter: RosterFilter, nextSearch = search) => {
    const next = new URLSearchParams();
    if (nextFilter !== 'ALL') next.set('roster', nextFilter);
    if (nextSearch.trim()) next.set('q', nextSearch);
    setSearchParams(next, { replace: true });
  };
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.group(groupId) }),
      client.invalidateQueries({ queryKey: ['groups', 'roster', groupId] }),
      client.invalidateQueries({ queryKey: ['students', 'eligible-for-group', groupId] }),
      client.invalidateQueries({ queryKey: ['groups', 'list'] }),
    ]);
  };
  const closeSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBulkAction(undefined);
  };
  const handleBulkSuccess = async (bulkResult: StudentBulkExecutionResult) => {
    setResult(`Готово. Изменено учеников: ${String(bulkResult.changedCount)}.`);
    setAddStudentIds([]);
    setAddSelectionOpen(false);
    closeSelection();
    await Promise.all([refresh(), invalidateStudentIdentityCaches(client)]);
  };

  if (group.isLoading || roster.isLoading) return <LoadingState label="Загружаем состав группы…" />;
  if (!group.data || !roster.data || group.isError || roster.isError)
    return (
      <ErrorState
        message="Не удалось загрузить группу и актуальный состав."
        onRetry={() => void Promise.all([group.refetch(), roster.refetch()])}
        retryLabel={t('common.retry')}
        title={t('common.errorTitle')}
      />
    );
  const detail = group.data;
  const overview = roster.data;
  const trialGuests = activeTrialGuests(upcomingTrials.data ?? [], overview.members);
  const selectedStudents = bulkAction === 'ADD_TO_GROUP' ? addStudentIds : [...selectedIds];
  const roomNames = [...new Set(detail.schedules.flatMap(({ room }) => (room ? [room] : [])))];

  return (
    <main className="mx-auto w-full max-w-[1450px] animate-fade-in p-7 pb-14 min-[1500px]:p-9">
      <Link
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        to="/groups"
      >
        <ArrowLeft className="size-4" /> {t('group.back')}
      </Link>

      <Card className="mb-5 overflow-hidden">
        <div className="relative flex flex-wrap items-center gap-5 bg-sidebar px-7 py-7 text-white">
          <div
            className="absolute inset-y-0 right-0 w-72 opacity-30"
            style={{
              background: `radial-gradient(circle at right, ${detail.color ?? '#9CFF2E'}, transparent 70%)`,
            }}
          />
          <Avatar className="ring-4 ring-white/10" name={detail.name} size="large" />
          <div className="relative min-w-[280px] flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-semibold tracking-[-0.045em]">{detail.name}</h1>
              <StatusBadge tone="accent">{t(`group.status.${detail.status}`)}</StatusBadge>
            </div>
            <p className="mt-2 text-sm text-neutral-300">
              {detail.branchName} · {detail.direction}
              {roomNames.length ? ` · ${roomNames.join(', ')}` : ''}
            </p>
            <p className="mt-1 text-sm text-neutral-400">
              {detail.coachName ? `Тренер: ${detail.coachName}` : 'Тренер не назначен'}
              {detail.ageFrom !== undefined || detail.ageTo !== undefined
                ? ` · Возраст ${String(detail.ageFrom ?? 0)}–${String(detail.ageTo ?? '∞')}`
                : ''}
            </p>
            {detail.description ? (
              <p className="mt-2 max-w-3xl text-sm text-neutral-400">{detail.description}</p>
            ) : null}
          </div>
          <div className="relative grid grid-cols-2 gap-5 text-right">
            <div>
              <p className="text-3xl font-semibold">
                {overview.currentCount} из {overview.capacity}
              </p>
              <p className="text-xs text-neutral-400">текущий состав</p>
            </div>
            <div>
              <p className="text-3xl font-semibold">{overview.freePlaces}</p>
              <p className="text-xs text-neutral-400">
                {overview.freePlaces === 0 ? 'группа заполнена' : 'свободных мест'}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {result ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {result}
        </div>
      ) : null}

      {trialGuests.length ? (
        <Card className="mb-5 p-5">
          <h2 className="text-lg font-semibold">Пробные / ближайшие</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {trialGuests.map((trial) => (
              <Link
                className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted"
                key={trial.id}
                to={`/attendance/${trial.lessonId}`}
              >
                <b>{trial.leadName}</b> ·{' '}
                {formatDate(trial.startsAt, {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <h2 className="text-xl font-semibold">Состав</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Активных: {overview.activeCount} · пробных:{' '}
                {overview.trialCount + trialGuests.length} · заморожены: {overview.frozenCount}
              </p>
            </div>
            <Button
              aria-label="Обновить состав"
              onClick={() => void refresh()}
              size="icon"
              variant="outline"
            >
              <RefreshCw className="size-4" />
            </Button>
            {canManage && !selectionMode ? (
              <Button onClick={() => setSelectionMode(true)} variant="outline">
                <CheckSquare className="size-4" /> Выбрать
              </Button>
            ) : null}
            {canManage ? (
              <Button
                onClick={() => {
                  void eligibleStudents.refetch();
                  setAddSelectionOpen(true);
                }}
              >
                <Plus className="size-4" /> Добавить учеников
              </Button>
            ) : null}
          </div>

          {selectionMode ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-muted/35 p-3">
              <span className="mr-auto text-sm font-semibold">Выбрано: {selectedIds.size}</span>
              <Button
                disabled={selectableIds.length === 0}
                onClick={() => {
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    for (const id of selectableIds) {
                      if (allVisibleSelected) next.delete(id);
                      else next.add(id);
                    }
                    return next;
                  });
                }}
                size="small"
                variant="outline"
              >
                {allVisibleSelected ? 'Снять видимых' : 'Выбрать видимых'}
              </Button>
              <Button
                disabled={selectedIds.size === 0}
                onClick={() => setBulkAction('MOVE_TO_GROUP')}
                size="small"
                variant="outline"
              >
                <ArrowRightLeft className="size-4" /> Перевести
              </Button>
              <Button
                disabled={selectedIds.size === 0}
                onClick={() => setBulkAction('REMOVE_FROM_GROUP')}
                size="small"
                variant="outline"
              >
                <UserMinus className="size-4" /> Убрать из группы
              </Button>
              <Button
                disabled={selectedIds.size === 0}
                onClick={() => setBulkAction('CHANGE_STATUS')}
                size="small"
                variant="outline"
              >
                <Snowflake className="size-4" /> Изменить статус
              </Button>
              <Button
                aria-label="Завершить выбор"
                onClick={closeSelection}
                size="icon"
                variant="ghost"
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {(Object.keys(filterLabels) as RosterFilter[])
              .filter(
                (value) =>
                  user?.role !== 'COACH' || (value !== 'DEBT' && value !== 'NO_SUBSCRIPTION'),
              )
              .map((value) => (
                <Button
                  className="shrink-0"
                  key={value}
                  onClick={() => setView(value)}
                  size="small"
                  variant={filter === value ? 'secondary' : 'ghost'}
                >
                  {filterLabels[value]}
                </Button>
              ))}
          </div>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Поиск по составу группы"
              className="pl-9"
              onChange={(event) => setView(filter, event.target.value)}
              placeholder="Имя, фамилия или телефон"
              value={search}
            />
          </div>

          {members.length ? (
            <div className="mt-4 space-y-2">
              {members.map((member) => {
                const selectable = member.segment === 'CURRENT';
                return (
                  <div
                    className="flex min-w-0 items-center gap-3 rounded-2xl border border-border px-4 py-3 transition hover:bg-muted/30"
                    key={member.membershipId}
                  >
                    {selectionMode && selectable ? (
                      <Checkbox
                        aria-label={`Выбрать ${member.studentName}`}
                        checked={selectedIds.has(member.studentId)}
                        onChange={() => {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (next.has(member.studentId)) next.delete(member.studentId);
                            else next.add(member.studentId);
                            return next;
                          });
                        }}
                      />
                    ) : (
                      <Avatar name={member.studentName} size="small" />
                    )}
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => navigate(`/students/${member.studentId}`)}
                      type="button"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold">{member.studentName}</span>
                        <Badge>{t(`status.${member.studentStatus}`)}</Badge>
                        {member.membershipStatus !== 'ACTIVE' ? (
                          <Badge>{t(`enrollment.status.${member.membershipStatus}`)}</Badge>
                        ) : null}
                        {member.recentlyAdded ? <Badge>Недавно добавлен</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {member.age === undefined ? '' : `${String(member.age)} лет · `}
                        Вступил {formatDate(member.joinedAt)}
                        {member.leftAt ? ` · вышел ${formatDate(member.leftAt)}` : ''}
                      </p>
                    </button>
                    <div className="hidden min-w-[190px] text-right md:block">
                      <p className="text-xs font-semibold">{subscriptionLabel(member)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {lastAttendanceLabel(member.lastAttendanceAt, today)}
                      </p>
                    </div>
                    {member.totalDebt !== undefined && member.totalDebt > 0 ? (
                      <Badge className="bg-red-50 text-red-700">
                        Долг&nbsp;
                        <Money amount={member.totalDebt} />
                      </Badge>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-5">
              <EmptyState
                action={
                  canManage && filter === 'ALL' && !search ? (
                    <Button onClick={() => setAddSelectionOpen(true)}>Добавить учеников</Button>
                  ) : undefined
                }
                description={
                  search ? 'Измените поиск или фильтр.' : 'В этом сегменте пока никого нет.'
                }
                icon={UsersRound}
                title={search ? 'Ничего не найдено' : 'Нет учеников'}
              />
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-lg font-semibold">Расписание</h2>
            <div className="mt-3 space-y-2">
              {detail.schedules.length ? (
                detail.schedules.map((schedule) => (
                  <div className="rounded-2xl border border-border p-3 text-sm" key={schedule.id}>
                    <p className="font-semibold">
                      {formatWeekday(schedule.weekday)}, {schedule.startTime}–{schedule.endTime}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {schedule.room ?? t('common.notSpecified')}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Расписание пока не настроено.</p>
              )}
            </div>
            <Button className="mt-4 w-full" onClick={() => navigate('/schedule')} variant="outline">
              <CalendarDays className="size-4" /> Открыть расписание
            </Button>
            {user?.role !== 'COACH' ? (
              <Button
                className="mt-2 w-full"
                onClick={() => navigate(`/attendance?groupId=${groupId}`)}
                variant="outline"
              >
                <CalendarCheck2 className="size-4" /> Посещения
              </Button>
            ) : null}
          </Card>
          <Card className="p-5">
            <h2 className="text-lg font-semibold">Структура состава</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-muted/45 p-3">
                <p className="text-2xl font-semibold">{overview.currentCount}</p>
                <p className="text-xs text-muted-foreground">занимаются сейчас</p>
              </div>
              <div className="rounded-xl bg-muted/45 p-3">
                <p className="text-2xl font-semibold">{overview.futureCount}</p>
                <p className="text-xs text-muted-foreground">начнут позже</p>
              </div>
              <div className="rounded-xl bg-muted/45 p-3">
                <p className="text-2xl font-semibold">{overview.formerCount}</p>
                <p className="text-xs text-muted-foreground">в истории</p>
              </div>
              <div className="rounded-xl bg-muted/45 p-3">
                <p className="text-2xl font-semibold">{overview.recentlyAddedCount}</p>
                <p className="text-xs text-muted-foreground">за 14 дней</p>
              </div>
            </div>
            {overview.capacityOccupiedCount !== overview.currentCount ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Мест запланировано: {overview.capacityOccupiedCount} из {overview.capacity} — с
                учётом будущих участников.
              </p>
            ) : null}
          </Card>
        </div>
      </div>

      <GroupAddStudentsDialog
        onClose={() => setAddSelectionOpen(false)}
        onContinue={(studentIds) => {
          setAddSelectionOpen(false);
          setAddStudentIds(studentIds);
          setBulkAction('ADD_TO_GROUP');
        }}
        open={addSelectionOpen}
        students={eligibleStudents.data ?? []}
      />
      <StudentBulkDialog
        action={bulkAction}
        fixedSourceGroupId={
          bulkAction === 'MOVE_TO_GROUP' || bulkAction === 'REMOVE_FROM_GROUP' ? groupId : undefined
        }
        fixedTargetGroupId={bulkAction === 'ADD_TO_GROUP' ? groupId : undefined}
        groups={groups.data ?? []}
        onClose={() => {
          setBulkAction(undefined);
          setAddStudentIds([]);
        }}
        onSuccess={(bulkResult) => void handleBulkSuccess(bulkResult)}
        open={Boolean(bulkAction)}
        studentIds={selectedStudents}
      />
    </main>
  );
}
