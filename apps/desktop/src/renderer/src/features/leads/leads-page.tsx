import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  type LeadCreateInput,
  type LeadDetail,
  type LeadListQuery,
  type LeadSource,
  type LeadStatus,
  type LeadSummary,
  type StudentInput,
  type TrialAppointmentSummary,
} from '@arava/shared';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  Inbox,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  UserPlus,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { invalidateTrialCaches } from '../../lib/operational-cache';
import { getErrorMessage } from '../../lib/errors';
import { invalidateStudentIdentityCaches } from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { StudentDialog } from '../students/student-dialog';
import { leadSourceLabels, leadStatusLabels, studentPrefill } from './lead-model';

const statusTone: Record<
  LeadStatus,
  'accent' | 'danger' | 'info' | 'muted' | 'success' | 'warning'
> = {
  CONTACTED: 'info',
  CONVERTED: 'success',
  NEW: 'accent',
  NOT_RELEVANT: 'muted',
  NO_ANSWER: 'warning',
  REJECTED: 'danger',
  TRIAL_ATTENDED: 'success',
  TRIAL_BOOKED: 'info',
};

const trialStateLabels: Record<TrialAppointmentSummary['state'], string> = {
  ATTENDED: 'Пришёл',
  CANCELLED: 'Занятие отменено',
  CLOSED: 'Заявка закрыта',
  FOLLOW_UP: 'Связаться после пробного',
  MISSED: 'Не пришёл',
  SCHEDULED: 'Пробное запланировано',
  SUBSCRIPTION_PURCHASED: 'Абонемент оформлен',
  TODAY: 'Пробное сегодня',
};

export function LeadsPage() {
  const user = useAuthStore((state) => state.user);
  const accessKey = `${user?.id ?? ''}:${user?.role ?? ''}:${[...(user?.branchIds ?? [])].sort().join(',')}`;
  const client = useQueryClient();
  const [searchParameters] = useSearchParams();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [source, setSource] = useState<LeadSource | ''>('');
  const [direction, setDirection] = useState('');
  const [selectedId, setSelectedId] = useState(searchParameters.get('leadId') ?? '');
  const [manualOpen, setManualOpen] = useState(false);
  const [studentOpen, setStudentOpen] = useState(false);
  const [addToGroup, setAddToGroup] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [studentError, setStudentError] = useState<string>();
  const [flowError, setFlowError] = useState<Error>();
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const lessonRange = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 60);
    to.setHours(23, 59, 59, 999);
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }, []);
  const query = useMemo<LeadListQuery>(
    () => ({
      direction: direction || undefined,
      search: deferredSearch || undefined,
      source: source || undefined,
      status: status || undefined,
    }),
    [deferredSearch, direction, source, status],
  );
  const leads = useQuery({
    enabled: user?.role !== 'COACH',
    queryFn: () => getDesktopApi().leads.list(getSessionToken(), query),
    queryKey: queryKeys.leads(accessKey, query),
    refetchInterval: 60_000,
    retry: false,
  });
  const detail = useQuery({
    enabled: selectedId.length > 0 && user?.role !== 'COACH',
    queryFn: () => getDesktopApi().leads.get(getSessionToken(), selectedId),
    queryKey: queryKeys.lead(selectedId, accessKey),
    retry: false,
  });
  const branches = useQuery({
    enabled: user?.role !== 'COACH',
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const groups = useQuery({
    enabled: user?.role !== 'COACH',
    queryFn: () => getDesktopApi().groups.list(getSessionToken(), {}),
    queryKey: queryKeys.groups({}),
  });
  const trial = useQuery({
    enabled: Boolean(selectedId) && user?.role !== 'COACH',
    queryFn: () => getDesktopApi().trials.list(getSessionToken(), { leadId: selectedId }),
    queryKey: queryKeys.trials(accessKey, { leadId: selectedId }),
    retry: false,
  });
  const trialOccurrences = useQuery({
    enabled: Boolean(selectedGroupId) && user?.role !== 'COACH',
    queryFn: () =>
      getDesktopApi().trials.occurrences(getSessionToken(), {
        ...lessonRange,
        groupId: selectedGroupId,
      }),
    queryKey: queryKeys.trialOccurrences(accessKey, {
      ...lessonRange,
      groupId: selectedGroupId,
    }),
  });
  const invalidate = async (id?: string) => {
    await client.invalidateQueries({ queryKey: ['leads', accessKey] });
    await invalidateTrialCaches(client);
    if (id) await client.invalidateQueries({ queryKey: queryKeys.lead(id, accessKey) });
  };
  const updateStatus = useMutation({
    mutationFn: ({ id, value }: { id: string; value: LeadStatus }) =>
      getDesktopApi().leads.updateStatus(getSessionToken(), id, value),
    onSuccess: (updated) => invalidate(updated.id),
  });
  const convert = useMutation({
    mutationFn: ({ id, studentId }: { id: string; studentId: string }) =>
      getDesktopApi().leads.convert(getSessionToken(), id, studentId),
    onSuccess: (updated) => invalidate(updated.id),
  });
  const assignGroup = useMutation({
    mutationFn: ({ id, groupId }: { groupId?: string; id: string }) =>
      getDesktopApi().leads.assignGroup(getSessionToken(), id, { crmGroupId: groupId }),
    onSuccess: (updated) => {
      client.setQueryData(queryKeys.lead(updated.id, accessKey), updated);
      return invalidate(updated.id);
    },
  });
  const scheduleTrial = useMutation({
    mutationFn: ({
      groupId,
      leadId,
      startsAt,
    }: {
      groupId: string;
      leadId: string;
      startsAt: string;
    }) => getDesktopApi().trials.schedule(getSessionToken(), { groupId, leadId, startsAt }),
    onSuccess: async (saved) => {
      setSelectedLessonId('');
      await Promise.all([
        saved.leadId ? invalidate(saved.leadId) : Promise.resolve(),
        invalidateTrialCaches(client),
      ]);
    },
  });
  const cancelTrial = useMutation({
    mutationFn: (trial: TrialAppointmentSummary) =>
      getDesktopApi().trials.cancel(getSessionToken(), trial.id, {
        expectedVersion: trial.version ?? 1,
      }),
    onSuccess: () => invalidate(selectedId),
  });
  const setTrialOutcome = useMutation({
    mutationFn: ({
      outcome,
      trial,
    }: {
      outcome: 'PURCHASED' | 'THINKING' | 'DECLINED' | 'NO_SHOW';
      trial: TrialAppointmentSummary;
    }) =>
      getDesktopApi().trials.setOutcome(getSessionToken(), trial.id, {
        expectedVersion: trial.version ?? 1,
        outcome,
      }),
    onSuccess: () => invalidate(selectedId),
  });

  const current = detail.data;
  useEffect(() => {
    setSelectedGroupId(current?.crmGroupId ?? '');
    setAddToGroup(Boolean(current?.crmGroupId));
    setSelectedLessonId('');
  }, [current?.crmGroupId, current?.id]);
  const selectedGroup = groups.data?.find(({ id }) => id === selectedGroupId);
  const selectableGroups =
    groups.data?.filter(({ status }) => status === 'ACTIVE' || status === 'RECRUITING') ?? [];
  const prefillBranches = selectedGroup ? [{ id: selectedGroup.branchId }] : (branches.data ?? []);
  const initialStudent = current ? studentPrefill(current, prefillBranches) : undefined;

  if (user?.role === 'COACH') return <Navigate replace to="/dashboard" />;

  const saveStudent = async (input: StudentInput) => {
    if (!current) return;
    setStudentError(undefined);
    setFlowError(undefined);
    try {
      const result = await getDesktopApi().leads.createStudent(getSessionToken(), current.id, {
        addToGroup,
        allowDuplicate,
        ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
        student: input,
      });
      client.setQueryData(queryKeys.lead(current.id, accessKey), result.lead);
      await Promise.all([
        invalidate(current.id),
        invalidateStudentIdentityCaches(client, result.student.id),
        client.invalidateQueries({ queryKey: ['groups'] }),
      ]);
      setStudentOpen(false);
    } catch (error) {
      setStudentError(getErrorMessage(error, 'Не удалось создать ученика из заявки.'));
    }
  };

  return (
    <main className="mx-auto flex h-full w-full max-w-[1580px] flex-col p-7 pb-8 2xl:p-9">
      <PageHeader
        action={
          <div className="flex gap-2">
            <Button onClick={() => void leads.refetch()} variant="outline">
              <RefreshCw className={`size-4 ${leads.isFetching ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
            <Button onClick={() => setManualOpen(true)}>
              <Plus className="size-4" />
              Добавить заявку
            </Button>
          </div>
        }
        description="Потенциальные клиенты с сайта, по телефону и с ресепшена."
        eyebrow="ARAVA · КЛИЕНТЫ"
        title="Заявки"
      />
      <Card className="mt-5 grid min-h-0 flex-1 grid-cols-[minmax(420px,0.95fr)_minmax(440px,1.05fr)] overflow-hidden p-0">
        <section className="flex min-h-0 flex-col border-r border-border">
          <div className="grid grid-cols-2 gap-3 border-b border-border p-4 xl:grid-cols-[minmax(220px,1fr)_180px_170px_170px]">
            <label className="relative col-span-2 xl:col-span-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Поиск заявок"
                className="pl-9"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Телефон, контакт или ученик"
                value={search}
              />
            </label>
            <Select
              aria-label="Статус заявки"
              onChange={(event) => setStatus(event.target.value as LeadStatus | '')}
              value={status}
            >
              <option value="">Все статусы</option>
              {LEAD_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {leadStatusLabels[item]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Источник заявки"
              onChange={(event) => setSource(event.target.value as LeadSource | '')}
              value={source}
            >
              <option value="">Все источники</option>
              {LEAD_SOURCES.map((item) => (
                <option key={item} value={item}>
                  {leadSourceLabels[item]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Направление заявки"
              onChange={(event) => setDirection(event.target.value)}
              value={direction}
            >
              <option value="">Все направления</option>
              {[...new Set(leads.data?.leads.map((lead) => lead.direction).filter(Boolean) ?? [])]
                .sort()
                .map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
            </Select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {leads.isLoading ? <LoadingState label="Загружаем заявки…" /> : null}
            {leads.isError ? (
              <ErrorState
                title="Заявки недоступны"
                message={getErrorMessage(
                  leads.error,
                  'ARAVA-WEB сейчас недоступен. Данные не показаны как актуальные.',
                )}
                retryLabel="Повторить"
                onRetry={() => void leads.refetch()}
              />
            ) : null}
            {leads.data && leads.data.leads.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="Новых заявок пока нет"
                description="Измените фильтры или обновите список позднее."
              />
            ) : null}
            {leads.data?.leads.map((lead) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                selected={lead.id === selectedId}
                onClick={() => {
                  setSelectedId(lead.id);
                  setAllowDuplicate(false);
                }}
              />
            ))}
          </div>
          {leads.data ? (
            <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              Новых: {leads.data.newCount} · Обновлено {formatDateTime(leads.data.serverTimestamp)}
            </p>
          ) : null}
        </section>
        <section className="min-h-0 overflow-y-auto bg-muted/15 p-6">
          {!selectedId ? (
            <EmptyState
              icon={Inbox}
              title="Выберите заявку"
              description="Контакты, комментарий и действия появятся здесь."
            />
          ) : null}
          {detail.isLoading ? <LoadingState label="Открываем заявку…" /> : null}
          {detail.isError ? (
            <ErrorState
              title="Не удалось открыть заявку"
              message={getErrorMessage(detail.error, 'Повторите запрос к ARAVA-WEB.')}
              retryLabel="Повторить"
              onRetry={() => void detail.refetch()}
            />
          ) : null}
          {current ? (
            <LeadDetailView
              accessKey={accessKey}
              actionError={
                flowError ??
                updateStatus.error ??
                assignGroup.error ??
                convert.error ??
                scheduleTrial.error ??
                cancelTrial.error ??
                setTrialOutcome.error
              }
              allowDuplicate={allowDuplicate}
              canCreateStudent={!branches.isLoading && (branches.data?.length ?? 0) > 0}
              addToGroup={addToGroup}
              groups={selectableGroups}
              lead={current}
              lessons={trialOccurrences.data ?? []}
              onAllowDuplicate={() => setAllowDuplicate(true)}
              onCreateStudent={() => setStudentOpen(true)}
              onAddToGroup={setAddToGroup}
              onGroup={(groupId) => {
                setSelectedGroupId(groupId);
                setAddToGroup(Boolean(groupId));
                assignGroup.mutate({ id: current.id, ...(groupId ? { groupId } : {}) });
              }}
              onLink={(studentId) => convert.mutate({ id: current.id, studentId })}
              onStatus={(value) => updateStatus.mutate({ id: current.id, value })}
              onCancelTrial={() => trial.data?.[0] && cancelTrial.mutate(trial.data[0])}
              onTrialOutcome={(outcome) =>
                trial.data?.[0] && setTrialOutcome.mutate({ outcome, trial: trial.data[0] })
              }
              onScheduleTrial={() => {
                if (!selectedGroupId || !selectedLessonId) return;
                scheduleTrial.mutate({
                  groupId: selectedGroupId,
                  leadId: current.id,
                  startsAt: selectedLessonId,
                });
              }}
              onTrialLesson={setSelectedLessonId}
              scheduledTrial={trial.data?.[0]}
              selectedLessonId={selectedLessonId}
              trialPending={scheduleTrial.isPending}
              statusPending={updateStatus.isPending}
              selectedGroupId={selectedGroupId}
            />
          ) : null}
        </section>
      </Card>
      <ManualLeadDialog
        branches={branches.data ?? []}
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onSaved={async (lead) => {
          setManualOpen(false);
          setSelectedId(lead.id);
          await invalidate(lead.id);
        }}
      />
      <StudentDialog
        branches={branches.data ?? []}
        error={studentError}
        initialValues={initialStudent}
        onClose={() => setStudentOpen(false)}
        onSubmit={saveStudent}
        open={studentOpen}
        student={null}
      />
    </main>
  );
}

function LeadRow({
  lead,
  onClick,
  selected,
}: {
  lead: LeadSummary;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      className={`mb-1 flex w-full gap-3 rounded-2xl p-3 text-left transition ${selected ? 'bg-white shadow-soft dark:bg-white/10' : 'hover:bg-muted/60'}`}
      onClick={onClick}
      type="button"
    >
      <Avatar name={lead.childName} />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <b className="truncate text-sm">{lead.childName}</b>
          <time className="shrink-0 text-[11px] text-muted-foreground">
            {formatDateTime(lead.createdAt)}
          </time>
        </span>
        <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{lead.phone}</span>
          <span>·</span>
          <span className="truncate">{lead.direction ?? leadSourceLabels[lead.source]}</span>
        </span>
        <StatusBadge className="mt-2" tone={statusTone[lead.status]}>
          {leadStatusLabels[lead.status]}
        </StatusBadge>
      </span>
    </button>
  );
}

function LeadDetailView({
  accessKey,
  actionError,
  addToGroup,
  allowDuplicate,
  canCreateStudent,
  groups,
  lead,
  lessons,
  onAllowDuplicate,
  onCreateStudent,
  onAddToGroup,
  onGroup,
  onLink,
  onStatus,
  onCancelTrial,
  onTrialOutcome,
  onScheduleTrial,
  onTrialLesson,
  scheduledTrial,
  statusPending,
  selectedGroupId,
  selectedLessonId,
  trialPending,
}: {
  accessKey: string;
  actionError: unknown;
  addToGroup: boolean;
  allowDuplicate: boolean;
  canCreateStudent: boolean;
  groups: { branchName: string; id: string; name: string }[];
  lead: LeadDetail;
  lessons: {
    endsAt: string;
    lessonId?: string | undefined;
    source: string;
    startsAt: string;
  }[];
  onAllowDuplicate: () => void;
  onCreateStudent: () => void;
  onAddToGroup: (value: boolean) => void;
  onGroup: (groupId: string) => void;
  onLink: (studentId: string) => void;
  onStatus: (status: LeadStatus) => void;
  onCancelTrial: () => void;
  onTrialOutcome: (outcome: 'PURCHASED' | 'THINKING' | 'DECLINED' | 'NO_SHOW') => void;
  onScheduleTrial: () => void;
  onTrialLesson: (lessonId: string) => void;
  scheduledTrial?: TrialAppointmentSummary | undefined;
  statusPending: boolean;
  selectedGroupId: string;
  selectedLessonId: string;
  trialPending: boolean;
}) {
  const converted = Boolean(lead.convertedStudentCrmId);
  return (
    <div data-testid="lead-detail">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Заявка · {leadSourceLabels[lead.source]}
          </p>
          <h2 className="mt-2 text-2xl font-semibold">{lead.childName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {lead.parentName ? `Контакт: ${lead.parentName} · ` : ''}
            {lead.phone}
          </p>
        </div>
        <StatusBadge tone={statusTone[lead.status]}>{leadStatusLabels[lead.status]}</StatusBadge>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Info label="Возраст" value={lead.childAge ? `${String(lead.childAge)} лет` : undefined} />
        <Info label="Направление" value={lead.direction} />
        <Info label="Создана" value={formatDateTime(lead.createdAt)} />
        <Info
          label="Источник"
          value={[leadSourceLabels[lead.source], lead.sourceDetail].filter(Boolean).join(' · ')}
        />
      </div>
      {lead.note ? (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Комментарий
          </p>
          <p className="mt-2 whitespace-pre-line text-sm leading-6">{lead.note}</p>
        </div>
      ) : null}
      {lead.utmSource || lead.utmCampaign || lead.utmMedium ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Источник рекламы:{' '}
          {[lead.utmSource, lead.utmMedium, lead.utmCampaign].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <div className="mt-6 border-t border-border pt-5">
        <Label>Статус</Label>
        <Select
          aria-label="Изменить статус заявки"
          className="mt-2"
          disabled={statusPending || converted}
          onChange={(event) => onStatus(event.target.value as LeadStatus)}
          value={lead.status}
        >
          {LEAD_STATUSES.map((item) => (
            <option key={item} value={item}>
              {leadStatusLabels[item]}
            </option>
          ))}
        </Select>
      </div>
      {!converted ? (
        <div className="mt-5 rounded-2xl border border-border bg-surface p-4">
          <Label>Целевая группа</Label>
          <Select
            aria-label="Целевая группа заявки"
            className="mt-2"
            onChange={(event) => onGroup(event.target.value)}
            value={groups.some(({ id }) => id === selectedGroupId) ? selectedGroupId : ''}
          >
            <option value="">Требуется выбрать вручную</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} · {group.branchName}
              </option>
            ))}
          </Select>
          {lead.crmGroupId && !groups.some(({ id }) => id === lead.crmGroupId) ? (
            <p className="mt-2 text-xs text-amber-700">
              Группа из заявки больше недоступна. Выберите актуальную группу вручную.
            </p>
          ) : null}
          {selectedGroupId ? (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <Checkbox
                checked={addToGroup}
                onChange={(event) => onAddToGroup(event.target.checked)}
              />
              После создания добавить ученика в эту группу
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="mt-5 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Пробное занятие
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Конкретное занятие связывает заявку с посещаемостью и последующей продажей.
            </p>
          </div>
          <CalendarClock className="size-5 text-muted-foreground" />
        </div>
        {scheduledTrial ? (
          <div className="mt-3 rounded-xl bg-muted/60 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{trialStateLabels[scheduledTrial.state]}</b>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(scheduledTrial.startsAt)}
              </span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {scheduledTrial.groupName} · {scheduledTrial.branchName}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-background px-3 text-sm font-semibold hover:bg-muted"
                to={`/attendance/${scheduledTrial.lessonId}`}
              >
                Открыть посещения
              </Link>
              {scheduledTrial.state === 'FOLLOW_UP' && scheduledTrial.studentId ? (
                <Link
                  className="inline-flex h-9 items-center justify-center rounded-xl bg-foreground px-3 text-sm font-semibold text-background hover:opacity-90"
                  to={`/students/${scheduledTrial.studentId}?action=subscription`}
                >
                  Оформить абонемент
                </Link>
              ) : null}
              {scheduledTrial.state !== 'CANCELLED' ? (
                <Button onClick={onCancelTrial} size="small" variant="ghost">
                  Отменить запись
                </Button>
              ) : null}
              {['FOLLOW_UP', 'MISSED'].includes(scheduledTrial.state) ? (
                <>
                  <Button onClick={() => onTrialOutcome('THINKING')} size="small" variant="outline">
                    Думает
                  </Button>
                  <Button onClick={() => onTrialOutcome('DECLINED')} size="small" variant="outline">
                    Отказался
                  </Button>
                  {scheduledTrial.state === 'MISSED' ? (
                    <Button
                      onClick={() => onTrialOutcome('NO_SHOW')}
                      size="small"
                      variant="outline"
                    >
                      Не пришёл
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Select
            aria-label="Занятие для пробного"
            disabled={!selectedGroupId || trialPending}
            onChange={(event) => onTrialLesson(event.target.value)}
            value={selectedLessonId}
          >
            <option value="">
              {selectedGroupId ? 'Выберите дату и занятие' : 'Сначала выберите группу'}
            </option>
            {lessons.map((lesson) => (
              <option key={lesson.startsAt} value={lesson.startsAt}>
                {formatDateTime(lesson.startsAt)}
                {lesson.source === 'WEEKLY_SCHEDULE' ? ' · по расписанию' : ''}
              </option>
            ))}
          </Select>
          <Button
            disabled={!selectedGroupId || !selectedLessonId || trialPending}
            onClick={onScheduleTrial}
            variant="outline"
          >
            {scheduledTrial ? 'Перенести пробное' : 'Записать на пробное'}
          </Button>
        </div>
        {selectedGroupId && lessons.length === 0 ? (
          <p className="mt-2 text-xs text-amber-700">
            На ближайшие 60 дней для этой группы нет занятий по расписанию. Проверьте расписание
            группы или выберите другую группу.
          </p>
        ) : null}
      </div>
      {converted && lead.convertedStudentCrmId ? (
        <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          <b>Ученик уже создан и связан.</b>
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              <Link
                className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-foreground hover:bg-muted"
                to={`/students/${lead.convertedStudentCrmId}`}
              >
                Открыть ученика
              </Link>
              <LeadWriteAction accessKey={accessKey} studentId={lead.convertedStudentCrmId} />
            </div>
          </div>
        </div>
      ) : null}
      {!converted && lead.existingStudentCandidates.length > 0 ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div>
              <b>Возможно, этот человек уже есть в CRM</b>
              <p className="mt-1">
                Совпадение найдено по телефону. Проверьте кандидата — объединение автоматически не
                выполняется.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {lead.existingStudentCandidates.map((candidate) => (
              <Button
                key={candidate.crmStudentId}
                onClick={() => onLink(candidate.crmStudentId)}
                size="small"
                variant="outline"
              >
                Связать: {candidate.displayName}
              </Button>
            ))}
          </div>
          {!allowDuplicate ? (
            <Button className="mt-3" onClick={onAllowDuplicate} size="small" variant="ghost">
              Всё равно создать нового
            </Button>
          ) : null}
        </div>
      ) : null}
      {!converted && (lead.existingStudentCandidates.length === 0 || allowDuplicate) ? (
        <Button className="mt-5 w-full" disabled={!canCreateStudent} onClick={onCreateStudent}>
          <UserPlus className="size-4" />
          Создать ученика
        </Button>
      ) : null}
      {actionError ? (
        <p className="mt-3 text-sm text-red-600">
          {getErrorMessage(actionError, 'Операция не выполнена. Повторите попытку.')}
        </p>
      ) : null}
    </div>
  );
}

function LeadWriteAction({ accessKey, studentId }: { accessKey: string; studentId: string }) {
  const summary = useQuery({
    queryFn: () => getDesktopApi().chats.studentSummary(getSessionToken(), studentId),
    queryKey: queryKeys.studentCommunication(accessKey, studentId),
    retry: false,
  });
  if (summary.data?.state !== 'AVAILABLE' || !summary.data.conversationId) return null;
  const query = new URLSearchParams({
    conversationId: summary.data.conversationId,
    studentId,
  });
  return (
    <Link
      className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-foreground px-3 text-sm font-semibold text-background hover:opacity-90"
      to={`/chats?${query.toString()}`}
    >
      <MessageCircle className="size-4" /> Написать
    </Link>
  );
}

function ManualLeadDialog({
  branches,
  onClose,
  onSaved,
  open,
}: {
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (lead: LeadDetail) => Promise<void>;
  open: boolean;
}) {
  const [input, setInput] = useState<LeadCreateInput>({ phone: '', studentName: '' });
  const create = useMutation({
    mutationFn: () => getDesktopApi().leads.create(getSessionToken(), input),
    onSuccess: async (lead) => {
      setInput({ phone: '', studentName: '' });
      await onSaved(lead);
    },
  });
  const set = (key: keyof LeadCreateInput, value: string | number | undefined) =>
    setInput((current) => ({
      ...current,
      [key]: typeof value === 'string' && value.length === 0 ? undefined : value,
    }));
  return (
    <Dialog
      closeLabel="Закрыть"
      description="Заявка будет сохранена на ARAVA-WEB и станет доступна всем устройствам."
      onClose={onClose}
      open={open}
      title="Добавить заявку"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Ученик">
          <Input
            aria-label="Имя ученика заявки"
            onChange={(event) => set('studentName', event.target.value)}
            required
            value={input.studentName}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Контакт">
            <Input
              aria-label="Контакт заявки"
              onChange={(event) => set('contactName', event.target.value)}
              value={input.contactName ?? ''}
            />
          </Field>
          <Field label="Телефон">
            <Input
              aria-label="Телефон заявки"
              onChange={(event) => set('phone', event.target.value)}
              required
              value={input.phone}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Возраст">
            <Input
              aria-label="Возраст ученика заявки"
              min={3}
              max={99}
              onChange={(event) =>
                set('studentAge', event.target.value ? Number(event.target.value) : undefined)
              }
              type="number"
              value={input.studentAge ?? ''}
            />
          </Field>
          <Field label="Направление">
            <Input
              aria-label="Направление заявки"
              onChange={(event) => set('direction', event.target.value)}
              value={input.direction ?? ''}
            />
          </Field>
        </div>
        <Field label="Филиал">
          <Select
            aria-label="Филиал заявки"
            onChange={(event) => set('branchCrmId', event.target.value)}
            value={input.branchCrmId ?? ''}
          >
            <option value="">Не назначен</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Комментарий">
          <Textarea
            aria-label="Комментарий заявки"
            onChange={(event) => set('comment', event.target.value)}
            value={input.comment ?? ''}
          />
        </Field>
        {create.error ? (
          <p className="text-sm text-red-600">
            {getErrorMessage(create.error, 'Не удалось добавить заявку.')}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="outline">
            Отмена
          </Button>
          <Button disabled={create.isPending} type="submit">
            {create.isPending ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Info({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value));
}
