import {
  formatDate,
  t,
  type Gender,
  type StudentContactInput,
  type StudentContactSummary,
  type StudentInput,
  type StudentNoteInput,
  type StudentProfileNote,
  type StudentProfileGroup,
  type StudentBulkAction,
  type StudentStatus,
  type TrialAppointmentSummary,
  type TrialOutcome,
} from '@arava/shared';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Label,
  Select,
  Textarea,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  AlertTriangle,
  CalendarDays,
  Crown,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  StickyNote,
  Trash2,
  UserRound,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import {
  invalidateStudentIdentityCaches,
  invalidateTrialCaches,
} from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { ContactDialog } from './contact-dialog';
import { ClientWebAccessCard } from './client-web-access-card';
import { StudentDialog } from './student-dialog';
import { StudentBulkDialog } from './student-bulk-dialog';
import { StudentCommunicationCard } from './student-communication-card';
import { StudentFinance } from '../subscriptions/student-finance';
import { StudentCard } from '../cards/student-card';

const statusStyles: Record<StudentStatus, string> = {
  ACTIVE: '',
  ARCHIVED: 'bg-muted text-muted-foreground',
  FROZEN: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  LEFT: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
  TRIAL: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
};

const genderLabels: Record<Gender, string> = {
  FEMALE: t('gender.FEMALE'),
  MALE: t('gender.MALE'),
  OTHER: t('gender.OTHER'),
};

export function StudentProfilePage() {
  const { studentId = '' } = useParams();
  const [searchParameters] = useSearchParams();
  const openedByCard = searchParameters.get('openedByCard') === '1';
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const accessKey = `${user?.id ?? ''}:${user?.role ?? ''}:${[...(user?.branchIds ?? [])].sort().join(',')}`;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [studentDialog, setStudentDialog] = useState(false);
  const [contactDialog, setContactDialog] = useState(false);
  const [editingContact, setEditingContact] = useState<StudentContactSummary | null>(null);
  const [noteDialog, setNoteDialog] = useState(false);
  const [editingNote, setEditingNote] = useState<StudentProfileNote | null>(null);
  const [noteText, setNoteText] = useState('');
  const [membershipAction, setMembershipAction] = useState<StudentBulkAction>();
  const [membershipSourceGroupId, setMembershipSourceGroupId] = useState<string>();
  const [financeChooser, setFinanceChooser] = useState(false);
  const [financeAction, setFinanceAction] = useState<'payment' | 'subscription' | undefined>(() => {
    const action = searchParameters.get('action');
    return action === 'payment' || action === 'subscription' ? action : undefined;
  });
  const [requestedAttendanceLessonId, setRequestedAttendanceLessonId] = useState(() =>
    searchParameters.get('action') === 'attendance-payment'
      ? (searchParameters.get('lessonId') ?? undefined)
      : undefined,
  );
  const [requestedPaymentOperationId, setRequestedPaymentOperationId] = useState(
    () => searchParameters.get('paymentOperationId') ?? undefined,
  );
  const [requestedSubscriptionPaymentId, setRequestedSubscriptionPaymentId] = useState(
    () => searchParameters.get('subscriptionId') ?? undefined,
  );
  const [cardAction, setCardAction] = useState(searchParameters.get('action') === 'card');
  const [error, setError] = useState<string>();
  const [trialDialog, setTrialDialog] = useState(false);
  const [trialGroupId, setTrialGroupId] = useState('');
  const [trialStartsAt, setTrialStartsAt] = useState('');
  const student = useQuery({
    enabled: Boolean(studentId),
    queryFn: () => getDesktopApi().students.getProfile(getSessionToken(), studentId),
    queryKey: ['student-profile', user?.id, studentId],
  });
  const branches = useQuery({
    enabled: canManage,
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const groups = useQuery({
    enabled: canManage,
    queryFn: () => getDesktopApi().groups.list(getSessionToken(), {}),
    queryKey: queryKeys.groups({}),
  });
  const trialGroups = useQuery({
    enabled: canManage && trialDialog,
    queryFn: () => getDesktopApi().groups.list(getSessionToken(), {}),
    queryKey: [...queryKeys.groups({}), 'trial-picker'],
  });
  const trialRange = useMemo(() => {
    const from = new Date();
    const to = new Date(from);
    to.setDate(to.getDate() + 60);
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }, []);
  const trialOccurrences = useQuery({
    enabled: trialDialog && Boolean(trialGroupId),
    queryFn: () =>
      getDesktopApi().trials.occurrences(getSessionToken(), {
        ...trialRange,
        groupId: trialGroupId,
      }),
    queryKey: queryKeys.trialOccurrences(user?.id ?? '', {
      ...trialRange,
      groupId: trialGroupId,
    }),
  });
  const scheduleTrial = useMutation({
    mutationFn: () =>
      getDesktopApi().trials.schedule(getSessionToken(), {
        groupId: trialGroupId,
        startsAt: trialStartsAt,
        studentId,
      }),
    onSuccess: async () => {
      setTrialDialog(false);
      setTrialStartsAt('');
      await invalidateTrialCaches(queryClient);
    },
  });
  const refreshTrials = async () => {
    await invalidateTrialCaches(queryClient);
  };
  const cancelTrial = useMutation({
    mutationFn: (trial: TrialAppointmentSummary) =>
      getDesktopApi().trials.cancel(getSessionToken(), trial.id, {
        expectedVersion: trial.version ?? 1,
      }),
    onError: (caught) => setError(getErrorMessage(caught, 'Не удалось отменить пробное занятие.')),
    onSuccess: refreshTrials,
  });
  const setTrialOutcome = useMutation({
    mutationFn: ({ outcome, trial }: { outcome: TrialOutcome; trial: TrialAppointmentSummary }) =>
      getDesktopApi().trials.setOutcome(getSessionToken(), trial.id, {
        expectedVersion: trial.version ?? 1,
        outcome,
      }),
    onError: (caught) =>
      setError(getErrorMessage(caught, 'Не удалось сохранить результат пробного занятия.')),
    onSuccess: refreshTrials,
  });
  const updateStudent = useMutation({
    mutationFn: (input: StudentInput) =>
      getDesktopApi().students.update(getSessionToken(), studentId, input),
  });
  const createContact = useMutation({
    mutationFn: (input: StudentContactInput) =>
      getDesktopApi().contacts.create(getSessionToken(), studentId, input),
  });
  const updateContact = useMutation({
    mutationFn: ({ id, input }: { id: string; input: StudentContactInput }) =>
      getDesktopApi().contacts.update(getSessionToken(), id, input),
  });
  const removeContact = useMutation({
    mutationFn: (id: string) => getDesktopApi().contacts.remove(getSessionToken(), id),
  });
  const saveNote = useMutation({
    mutationFn: (input: StudentNoteInput) =>
      editingNote
        ? getDesktopApi().students.updateNote(getSessionToken(), editingNote.id, input)
        : getDesktopApi().students.createNote(getSessionToken(), studentId, input),
  });
  const archiveNote = useMutation({
    mutationFn: (noteId: string) => getDesktopApi().students.archiveNote(getSessionToken(), noteId),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.student(studentId) }),
      invalidateStudentIdentityCaches(queryClient, studentId),
      queryClient.invalidateQueries({ queryKey: queryKeys.studentFinance(studentId) }),
      queryClient.invalidateQueries({ queryKey: ['cards', 'student-current', studentId] }),
      queryClient.invalidateQueries({ queryKey: ['groups', 'list'] }),
    ]);
  };
  const saveStudent = async (input: StudentInput) => {
    setError(undefined);
    try {
      await updateStudent.mutateAsync(input);
      await refresh();
      setStudentDialog(false);
    } catch (caught) {
      setError(getErrorMessage(caught, t('student.errorUpdate')));
    }
  };
  const saveContact = async (input: StudentContactInput) => {
    setError(undefined);
    try {
      if (editingContact) await updateContact.mutateAsync({ id: editingContact.id, input });
      else await createContact.mutateAsync(input);
      await refresh();
      setContactDialog(false);
    } catch (caught) {
      setError(getErrorMessage(caught, t('contact.errorSave')));
    }
  };
  const remove = async (id: string) => {
    await removeContact.mutateAsync(id);
    await refresh();
  };
  const submitNote = async () => {
    setError(undefined);
    try {
      await saveNote.mutateAsync({ text: noteText });
      await refresh();
      setNoteDialog(false);
      setEditingNote(null);
      setNoteText('');
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось сохранить заметку.'));
    }
  };

  if (student.isLoading) return <LoadingState label={t('student.loadingProfile')} />;
  if (student.isError || !student.data)
    return (
      <ErrorState
        message={t('student.errorProfile')}
        onRetry={() => void student.refetch()}
        retryLabel={t('common.retry')}
        title={t('common.errorTitle')}
      />
    );

  const profile = student.data;
  const detail = profile.student;
  const fullName = `${detail.lastName} ${detail.firstName}${detail.middleName ? ` ${detail.middleName}` : ''}`;
  const age = detail.birthDate ? calculateAge(detail.birthDate) : undefined;
  const currentMemberships = profile.groups.filter(({ segment }) => segment === 'CURRENT');
  const futureMemberships = profile.groups.filter(({ segment }) => segment === 'FUTURE');
  const formerMemberships = profile.groups.filter(({ segment }) => segment === 'FORMER');
  const remainingLessons = profile.activeSubscriptions.reduce(
    (sum, subscription) => sum + (subscription.remainingLessons ?? 0),
    0,
  );
  const runPrimaryAction = () => {
    const action = profile.primaryAction;
    if (!action) return;
    if (action.kind === 'SALE') setFinanceAction('subscription');
    if (action.kind === 'PAYMENT') {
      if (action.targetId) setRequestedSubscriptionPaymentId(action.targetId);
      else setFinanceAction('payment');
    }
    if (action.kind === 'PAYMENT_OPERATION') setRequestedPaymentOperationId(action.targetId);
    if (action.kind === 'ADD_TO_GROUP') setMembershipAction('ADD_TO_GROUP');
    if (action.kind === 'TRIAL_OUTCOME')
      document.getElementById(`trial-${action.targetId ?? ''}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
  };
  return (
    <main className="mx-auto w-full max-w-[1320px] animate-fade-in p-5 pb-14 md:p-7 min-[1500px]:p-9">
      <Link
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        to="/students"
      >
        <ArrowLeft className="size-4" />
        {t('student.back')}
      </Link>

      <Card className="mb-5 overflow-hidden">
        <div className="relative bg-sidebar px-5 py-7 text-white md:px-7 md:py-8">
          <span className="absolute right-0 top-0 h-full w-48 bg-[radial-gradient(circle_at_top_right,rgba(156,255,46,0.22),transparent_66%)]" />
          <div className="relative flex items-start gap-5" data-testid="student-profile-identity">
            <Avatar className="shrink-0 ring-4 ring-white/10" name={fullName} size="large" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="break-words text-3xl font-semibold tracking-[-0.045em] md:text-4xl">
                  {fullName}
                </h2>
                <Badge className={statusStyles[detail.status]}>
                  {t(`status.${detail.status}`)}
                </Badge>
              </div>
              <p className="mt-2 flex items-center gap-2 text-sm text-neutral-400">
                <MapPin className="size-4 text-accent" /> {detail.branchName}
              </p>
              {detail.phone ? (
                <p className="mt-1 flex items-center gap-2 text-sm text-neutral-400">
                  <Phone className="size-4 text-accent" /> {detail.phone}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {age !== undefined ? (
                  <Badge className="border-white/10 bg-white/10 text-white">{age} лет</Badge>
                ) : null}
                {profile.groups.slice(0, 2).map((group) => (
                  <Badge className="border-white/10 bg-white/10 text-white" key={group.groupId}>
                    {group.groupName}
                  </Badge>
                ))}
                {profile.card ? (
                  <Badge className="border-white/10 bg-white/10 text-white">
                    Карта · {cardStatusLabel(profile.card.status)}
                  </Badge>
                ) : null}
                {profile.totalDebt ? (
                  <Badge className="bg-red-500 text-white">Есть долг</Badge>
                ) : null}
              </div>
              {openedByCard ? (
                <p className="mt-3 inline-flex rounded-full bg-accent px-3 py-1 text-xs font-semibold text-neutral-950">
                  Открыто по карте
                </p>
              ) : null}
            </div>
          </div>
          {canManage ? (
            <div
              className="relative mt-5 flex flex-wrap gap-1.5 border-t border-white/10 pt-4"
              data-testid="student-profile-actions"
            >
              {profile.primaryAction ? (
                <Button
                  className="bg-accent text-neutral-950 hover:bg-accent/90"
                  onClick={runPrimaryAction}
                  size="small"
                >
                  {profile.primaryAction.label}
                </Button>
              ) : null}
              <Button
                className="border-white/15 bg-white/10 text-white hover:bg-white/15"
                onClick={() => {
                  setError(undefined);
                  setStudentDialog(true);
                }}
                variant="outline"
                size="small"
              >
                <Pencil className="size-4" />
                {t('student.action.edit')}
              </Button>
              <Button
                className="border-white/15 bg-white/10 text-white hover:bg-white/15"
                onClick={() => setFinanceChooser(true)}
                size="small"
                variant="outline"
              >
                <WalletCards className="size-4" /> Оплата / абонемент
              </Button>
              <Button
                aria-label="Добавить в группу"
                className="border-white/15 bg-white/10 text-white hover:bg-white/15"
                onClick={() => {
                  void groups.refetch();
                  setMembershipAction('ADD_TO_GROUP');
                }}
                size="small"
                variant="outline"
              >
                <UsersRound className="size-4" /> В группу
              </Button>
              <Button
                className="border-white/15 bg-white/10 text-white hover:bg-white/15"
                onClick={() => navigate('/attendance')}
                size="small"
                variant="outline"
              >
                <CalendarDays className="size-4" /> Посещения
              </Button>
              <Button
                className="border-white/15 bg-white/10 text-white hover:bg-white/15"
                onClick={() => setCardAction(true)}
                size="small"
                variant="outline"
              >
                <Crown className="size-4" /> Карта
              </Button>
              <Button
                aria-label="Добавить заметку"
                className="border-white/15 bg-white/10 text-white hover:bg-white/15"
                onClick={() => {
                  setEditingNote(null);
                  setNoteText('');
                  setNoteDialog(true);
                }}
                size="small"
                variant="outline"
              >
                <StickyNote className="size-4" /> Заметка
              </Button>
              {detail.status === 'TRIAL' ? (
                <Button
                  className="border-white/15 bg-white/10 text-white hover:bg-white/15"
                  onClick={() => setTrialDialog(true)}
                  size="small"
                  variant="outline"
                >
                  <CalendarDays className="size-4" /> Пробное
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {profile.attentionItems.length ? (
        <Card className="mb-5 border-amber-200 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-500/5">
          <CardContent className="flex items-start gap-4 p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle className="size-5" />
            </span>
            <div>
              <p className="font-semibold">Требует внимания: {profile.attentionItems.length}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {profile.attentionItems.map((item) => (
                  <Link
                    className="rounded-xl border border-amber-200 bg-white/70 p-3 text-sm transition hover:bg-white"
                    key={item.id}
                    to={item.actionRoute}
                  >
                    <span className="font-semibold">{item.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {item.description}
                    </span>
                    <span className="mt-2 block text-xs font-semibold text-foreground">
                      {item.actionLabel} →
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section
        className={
          profile.access === 'ADMIN'
            ? 'mb-5 grid items-start gap-3 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]'
            : 'mb-5'
        }
      >
        {profile.access === 'ADMIN' ? (
          <StudentCommunicationCard
            accessKey={accessKey}
            attentionItems={profile.attentionItems}
            studentId={studentId}
          />
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <WorkspaceMetric
            label="Абонементы"
            value={
              profile.access === 'TRAINER'
                ? 'Недоступно'
                : profile.activeSubscriptions.length
                  ? `${String(profile.activeSubscriptions.length)} активных`
                  : 'Нет активного'
            }
          />
          <WorkspaceMetric
            label="Осталось занятий"
            value={profile.access === 'TRAINER' ? 'Недоступно' : String(remainingLessons)}
          />
          <WorkspaceMetric
            danger={Boolean(profile.totalDebt)}
            label="Общая задолженность"
            value={
              profile.access === 'TRAINER'
                ? 'Недоступно'
                : profile.totalDebt
                  ? formatRubles(profile.totalDebt)
                  : 'Нет долга'
            }
          />
          <WorkspaceMetric
            label="Следующее занятие"
            value={
              profile.upcomingLessons[0]
                ? formatDate(profile.upcomingLessons[0].startsAt, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : 'Не запланировано'
            }
          />
          <WorkspaceMetric
            label="Последний раз"
            value={
              profile.attendance.lastAttendedAt
                ? formatDate(profile.attendance.lastAttendedAt, { dateStyle: 'medium' })
                : 'Посещений нет'
            }
          />
        </div>
      </section>

      {profile.access === 'ADMIN' && detail.status === 'TRIAL' ? (
        <Card className="mb-5">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Пробные занятия</CardTitle>
            <Button onClick={() => setTrialDialog(true)} size="small" variant="outline">
              Записать на пробное
            </Button>
          </CardHeader>
          <CardContent>
            {profile.trials.length ? (
              <div className="space-y-2">
                {profile.trials.slice(0, 6).map((trial) => (
                  <div
                    className="rounded-xl border border-border p-3"
                    id={`trial-${trial.id}`}
                    key={trial.id}
                  >
                    <Link
                      className="flex items-center justify-between gap-3 hover:text-primary"
                      to={`/attendance/${trial.lessonId}`}
                    >
                      <span>
                        <b>{trial.groupName}</b>
                        <br />
                        <span className="text-sm text-muted-foreground">
                          {formatDate(trial.startsAt, { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </span>
                      <Badge>
                        {trial.state === 'CANCELLED'
                          ? 'Отменено'
                          : trial.outcome === 'THINKING'
                            ? 'Думает'
                            : trial.outcome === 'DECLINED'
                              ? 'Отказался'
                              : trial.outcome === 'PURCHASED'
                                ? 'Купил абонемент'
                                : trial.state === 'MISSED'
                                  ? 'Не пришёл'
                                  : trial.state === 'FOLLOW_UP'
                                    ? 'Требует результата'
                                    : 'Записан'}
                      </Badge>
                    </Link>
                    {trial.state === 'FOLLOW_UP' || trial.state === 'MISSED' ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          onClick={() => setTrialOutcome.mutate({ outcome: 'THINKING', trial })}
                          size="small"
                          variant="outline"
                        >
                          Думает
                        </Button>
                        <Button
                          onClick={() => setTrialOutcome.mutate({ outcome: 'DECLINED', trial })}
                          size="small"
                          variant="outline"
                        >
                          Отказался
                        </Button>
                        {trial.state === 'MISSED' ? (
                          <Button
                            onClick={() => setTrialOutcome.mutate({ outcome: 'NO_SHOW', trial })}
                            size="small"
                            variant="outline"
                          >
                            Не пришёл
                          </Button>
                        ) : null}
                        <Button onClick={() => setFinanceAction('subscription')} size="small">
                          Оформить абонемент
                        </Button>
                      </div>
                    ) : null}
                    {trial.state === 'SCHEDULED' ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button onClick={() => setTrialDialog(true)} size="small" variant="outline">
                          Перенести
                        </Button>
                        <Button
                          onClick={() => cancelTrial.mutate(trial)}
                          size="small"
                          variant="ghost"
                        >
                          Отменить запись
                        </Button>
                      </div>
                    ) : null}
                    {trial.state === 'MISSED' || trial.state === 'CANCELLED' ? (
                      <div className="mt-3">
                        <Button onClick={() => setTrialDialog(true)} size="small" variant="outline">
                          {trial.state === 'MISSED' ? 'Перенести пробное' : 'Выбрать новую дату'}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Пробных занятий пока нет.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div
        className={
          profile.access === 'ADMIN'
            ? 'grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]'
            : 'grid grid-cols-1 gap-5'
        }
      >
        <Card>
          <CardHeader>
            <CardTitle>{t('student.profileDetails')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-0">
              <Detail label={t('student.phone')} value={detail.phone ?? t('common.notProvided')} />
              <Detail label={t('student.email')} value={detail.email ?? t('common.notProvided')} />
              <Detail
                label={t('student.birthDate')}
                value={
                  detail.birthDate
                    ? formatDate(`${detail.birthDate}T00:00:00`)
                    : t('common.notProvided')
                }
              />
              <Detail
                label={t('student.gender')}
                value={detail.gender ? genderLabels[detail.gender] : t('common.notSpecified')}
              />
              <Detail label={t('student.notes')} value={detail.notes ?? t('common.noNotes')} />
              <Detail
                label="Следующее занятие"
                value={
                  detail.nextLesson
                    ? `${detail.nextLesson.groupName} · ${formatDate(detail.nextLesson.startsAt, { dateStyle: 'medium', timeStyle: 'short' })}`
                    : 'Пока не запланировано'
                }
              />
            </dl>
          </CardContent>
        </Card>

        {profile.access === 'ADMIN' ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>{t('student.contacts')}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('student.contactDescription')}
                </p>
              </div>
              {canManage ? (
                <Button
                  onClick={() => {
                    setEditingContact(null);
                    setError(undefined);
                    setContactDialog(true);
                  }}
                  size="small"
                >
                  <Plus className="size-4" />
                  {t('contact.add')}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {detail.contacts.length === 0 ? (
                <EmptyState
                  action={
                    canManage ? (
                      <Button onClick={() => setContactDialog(true)}>
                        {t('contact.addFirst')}
                      </Button>
                    ) : undefined
                  }
                  description={t('contact.emptyDescription')}
                  icon={UserRound}
                  title={t('contact.emptyTitle')}
                />
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {detail.contacts.map((contact) => (
                    <article
                      className="group rounded-2xl border border-border bg-background p-4 transition hover:-translate-y-0.5 hover:bg-surface hover:shadow-card"
                      key={contact.id}
                    >
                      <div className="flex items-start gap-3">
                        <Avatar name={contact.fullName} size="small" />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 truncate text-sm font-semibold">
                            {contact.fullName}
                            {contact.isPrimary ? (
                              <Crown className="size-3.5 shrink-0 text-amber-500" />
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {contact.relationship}
                            {contact.isPrimary ? ` · ${t('contact.primary')}` : ''}
                          </p>
                        </div>
                        {canManage ? (
                          <div className="flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                            <Button
                              aria-label={t('contact.editLabel', { name: contact.fullName })}
                              onClick={() => {
                                setEditingContact(contact);
                                setError(undefined);
                                setContactDialog(true);
                              }}
                              size="icon"
                              variant="ghost"
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              aria-label={t('contact.removeLabel', { name: contact.fullName })}
                              disabled={removeContact.isPending}
                              onClick={() => void remove(contact.id)}
                              size="icon"
                              variant="ghost"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
                        <button
                          className="flex items-center gap-2 hover:text-foreground"
                          onClick={() => void copyPhone(contact.phone)}
                          title="Скопировать телефон"
                          type="button"
                        >
                          <Phone className="size-3.5 text-muted-foreground" /> {contact.phone}
                        </button>
                        {contact.email ? (
                          <p className="flex items-center gap-2 text-muted-foreground">
                            <Mail className="size-3.5" /> {contact.email}
                          </p>
                        ) : null}
                        {contact.telegram ? (
                          <p className="flex items-center gap-2 text-muted-foreground">
                            <MessageCircle className="size-3.5" /> {contact.telegram}
                          </p>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Группы</CardTitle>
            {canManage ? (
              <Button
                onClick={() => {
                  setMembershipSourceGroupId(undefined);
                  setMembershipAction('ADD_TO_GROUP');
                }}
                size="small"
                variant="outline"
              >
                <Plus className="size-4" /> Добавить
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2">
            {currentMemberships.length ? (
              <MembershipRows
                canManage={canManage}
                memberships={currentMemberships}
                onRemove={(groupId) => {
                  setMembershipSourceGroupId(groupId);
                  setMembershipAction('REMOVE_FROM_GROUP');
                }}
              />
            ) : (
              <EmptyState
                description={t('group.emptyDescription')}
                icon={UsersRound}
                title={t('student.groups')}
              />
            )}
            {futureMemberships.length ? (
              <div className="pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Начнёт позже
                </p>
                <MembershipRows memberships={futureMemberships} />
              </div>
            ) : null}
            {formerMemberships.length ? (
              <details className="pt-3">
                <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
                  Ранее занимался · {formerMemberships.length}
                </summary>
                <div className="mt-2">
                  <MembershipRows memberships={formerMemberships} />
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Посещаемость</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                За 90 дней: {profile.attendance.attended} посещений · {profile.attendance.missed}{' '}
                пропусков
              </p>
            </div>
            <span className="text-2xl font-semibold">{profile.attendance.percentage}%</span>
          </CardHeader>
          <CardContent className="space-y-2">
            {profile.attendance.recent.length ? (
              profile.attendance.recent.map((entry) => (
                <Link
                  className="flex items-center gap-3 rounded-2xl border border-border bg-background p-4 transition hover:bg-muted/50"
                  key={`${entry.lessonId}-${entry.markedAt}`}
                  to={`/lessons/${entry.lessonId}`}
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
                    <CalendarDays className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{entry.groupName}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {formatDate(entry.startsAt, { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </span>
                  <Badge>{t(`attendance.status.${entry.status}`)}</Badge>
                </Link>
              ))
            ) : (
              <EmptyState
                description={t('attendance.empty')}
                icon={CalendarDays}
                title={t('attendance.history')}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Расписание ученика</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Ближайшее занятие и следующие уроки активных групп
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {profile.upcomingLessons.length ? (
            profile.upcomingLessons.map((lesson, index) => (
              <Link
                className="rounded-2xl border border-border bg-background p-4 transition hover:bg-muted/50"
                key={`${lesson.groupId}:${lesson.startsAt}`}
                to={
                  lesson.id
                    ? `/lessons/${lesson.id}`
                    : `/attendance?date=${lesson.startsAt.slice(0, 10)}&groupId=${lesson.groupId}`
                }
              >
                {index === 0 ? <Badge className="mb-3">Ближайшее занятие</Badge> : null}
                <p className="font-semibold">{lesson.groupName}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDate(lesson.startsAt, { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {lesson.coachName ?? 'Тренер не назначен'} · {lesson.roomName ?? 'Зал не указан'}{' '}
                  · {lesson.branchName}
                </p>
              </Link>
            ))
          ) : (
            <EmptyState
              description="Для активных групп пока нет будущих занятий."
              icon={CalendarDays}
              title="Занятия не запланированы"
            />
          )}
        </CardContent>
      </Card>

      {profile.access === 'ADMIN' ? (
        <>
          <ClientWebAccessCard student={detail} />
          <StudentFinance
            branches={branches.data ?? []}
            initialFinance={profile.finance}
            onRequestedActionHandled={() => {
              setFinanceAction(undefined);
              setRequestedAttendanceLessonId(undefined);
              setRequestedPaymentOperationId(undefined);
              setRequestedSubscriptionPaymentId(undefined);
            }}
            requestedAttendanceLessonId={requestedAttendanceLessonId}
            requestedAction={financeAction}
            requestedPaymentOperationId={requestedPaymentOperationId}
            requestedSubscriptionPaymentId={requestedSubscriptionPaymentId}
            student={detail}
          />
          <StudentCard
            assignRequested={cardAction}
            onAssignRequestedHandled={() => setCardAction(false)}
            studentId={studentId}
          />

          <div className="mt-5 grid grid-cols-2 gap-5">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Заметки</CardTitle>
                <Button
                  onClick={() => {
                    setEditingNote(null);
                    setNoteText('');
                    setNoteDialog(true);
                  }}
                  size="small"
                >
                  <Plus className="size-4" /> Добавить
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {profile.notes.length ? (
                  profile.notes.map((note) => (
                    <article className="rounded-2xl border border-border p-4" key={note.id}>
                      <p className="whitespace-pre-wrap text-sm leading-6">{note.text}</p>
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {note.authorName} · {formatDate(note.createdAt)}
                        </span>
                        <span>
                          <Button
                            aria-label="Изменить заметку"
                            onClick={() => {
                              setEditingNote(note);
                              setNoteText(note.text);
                              setNoteDialog(true);
                            }}
                            size="icon"
                            variant="ghost"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            aria-label="Архивировать заметку"
                            onClick={async () => {
                              await archiveNote.mutateAsync(note.id);
                              await refresh();
                            }}
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </span>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Заметок пока нет</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <details>
                <summary className="cursor-pointer list-none px-6 py-5 text-lg font-semibold">
                  История · {profile.history.length}
                </summary>
                <CardContent className="space-y-3 border-t border-border pt-5">
                  {profile.history.length ? (
                    profile.history.map((event) => (
                      <div className="border-l-2 border-accent pl-4" key={event.id}>
                        <p className="text-sm font-semibold">{event.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {event.actorName} ·{' '}
                          {formatDate(event.createdAt, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">История пока пуста</p>
                  )}
                </CardContent>
              </details>
            </Card>
          </div>
        </>
      ) : null}

      <Dialog
        closeLabel="Закрыть"
        onClose={() => setFinanceChooser(false)}
        open={financeChooser}
        title="Оплата и абонемент"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            className="h-auto justify-start p-4 text-left"
            onClick={() => {
              const debtSubscription = profile.finance?.subscriptions.find(({ debt }) => debt > 0);
              if (debtSubscription) setRequestedSubscriptionPaymentId(debtSubscription.id);
              else setFinanceAction('payment');
              setFinanceChooser(false);
            }}
            variant="outline"
          >
            <WalletCards className="size-5" /> Принять оплату
          </Button>
          <Button
            className="h-auto justify-start p-4 text-left"
            disabled={Boolean(profile.pendingSale)}
            onClick={() => {
              setFinanceAction('subscription');
              setFinanceChooser(false);
            }}
            variant="outline"
          >
            <Plus className="size-5" /> Продать абонемент
          </Button>
        </div>
      </Dialog>

      <Dialog
        closeLabel="Закрыть"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setTrialDialog(false)} variant="outline">
              Отмена
            </Button>
            <Button
              disabled={!trialGroupId || !trialStartsAt || scheduleTrial.isPending}
              onClick={() => scheduleTrial.mutate()}
            >
              Подтвердить запись
            </Button>
          </div>
        }
        onClose={() => setTrialDialog(false)}
        open={trialDialog}
        title="Записать на пробное"
      >
        <div className="space-y-4">
          <div>
            <Label>Группа</Label>
            <Select
              className="mt-2"
              onChange={(event) => {
                setTrialGroupId(event.target.value);
                setTrialStartsAt('');
              }}
              value={trialGroupId}
            >
              <option value="">Выберите группу</option>
              {(trialGroups.data ?? [])
                .filter((group) => group.status === 'ACTIVE' || group.status === 'RECRUITING')
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} · {group.branchName}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label>Конкретное занятие</Label>
            <Select
              className="mt-2"
              disabled={!trialGroupId}
              onChange={(event) => setTrialStartsAt(event.target.value)}
              value={trialStartsAt}
            >
              <option value="">Выберите дату и время</option>
              {(trialOccurrences.data ?? []).map((occurrence) => (
                <option key={occurrence.startsAt} value={occurrence.startsAt}>
                  {formatDate(occurrence.startsAt, { dateStyle: 'medium', timeStyle: 'short' })}
                </option>
              ))}
            </Select>
          </div>
          {scheduleTrial.error ? (
            <p className="text-sm text-red-600">
              {getErrorMessage(scheduleTrial.error, 'Не удалось записать на пробное.')}
            </p>
          ) : null}
        </div>
      </Dialog>

      <StudentBulkDialog
        action={membershipAction}
        fixedSourceGroupId={membershipSourceGroupId}
        groups={(groups.data ?? []).filter(
          ({ id }) =>
            membershipAction !== 'ADD_TO_GROUP' ||
            !profile.groups.some(({ groupId, segment }) => groupId === id && segment !== 'FORMER'),
        )}
        onClose={() => {
          setMembershipAction(undefined);
          setMembershipSourceGroupId(undefined);
        }}
        onSuccess={() => {
          setMembershipAction(undefined);
          setMembershipSourceGroupId(undefined);
          void refresh();
        }}
        open={Boolean(membershipAction)}
        studentIds={[studentId]}
      />

      <Dialog
        closeLabel="Закрыть"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setNoteDialog(false)} variant="outline">
              Отмена
            </Button>
            <Button
              disabled={!noteText.trim() || saveNote.isPending}
              onClick={() => void submitNote()}
            >
              Сохранить
            </Button>
          </div>
        }
        onClose={() => setNoteDialog(false)}
        open={noteDialog}
        title={editingNote ? 'Изменение заметки' : 'Новая заметка'}
      >
        <div className="space-y-3">
          <Label htmlFor="student-profile-note">Текст заметки</Label>
          <Textarea
            id="student-profile-note"
            maxLength={4000}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="Важная информация для администратора"
            rows={6}
            value={noteText}
          />
          <p className="text-xs text-muted-foreground">
            Не храните здесь пароли, данные банковских карт и другие секреты.
          </p>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </Dialog>

      <StudentDialog
        branches={branches.data ?? []}
        error={error}
        onClose={() => setStudentDialog(false)}
        onSubmit={saveStudent}
        open={studentDialog}
        student={detail}
      />
      <ContactDialog
        contact={editingContact}
        error={error}
        onClose={() => setContactDialog(false)}
        onSubmit={saveContact}
        open={contactDialog}
      />
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border py-4 first:pt-0 last:border-0 last:pb-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm leading-6">{value}</dd>
    </div>
  );
}

function WorkspaceMetric({
  danger = false,
  label,
  value,
}: {
  danger?: boolean;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={danger ? 'mt-2 font-semibold text-red-600' : 'mt-2 font-semibold'}>{value}</p>
      </CardContent>
    </Card>
  );
}

function MembershipRows({
  canManage = false,
  memberships,
  onRemove,
}: {
  canManage?: boolean;
  memberships: StudentProfileGroup[];
  onRemove?: ((groupId: string) => void) | undefined;
}) {
  return (
    <div className="space-y-2">
      {memberships.map((membership) => (
        <article
          className="flex items-center gap-3 rounded-2xl border border-border bg-background p-4"
          key={membership.enrollmentId}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
            <UsersRound className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <Link
              className="block truncate text-sm font-semibold hover:underline"
              to={`/groups/${membership.groupId}`}
            >
              {membership.groupName}
            </Link>
            <span className="mt-1 block text-xs text-muted-foreground">
              {membership.direction} · {membership.coachName ?? 'Тренер не назначен'}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {membership.scheduleSummary.join(', ') || 'Расписание не задано'}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              С {formatDate(membership.joinedAt, { dateStyle: 'medium' })}
              {membership.leftAt
                ? ` · до ${formatDate(membership.leftAt, { dateStyle: 'medium' })}`
                : ''}
            </span>
          </span>
          <Badge>{t(`enrollment.status.${membership.membershipStatus}`)}</Badge>
          {canManage && onRemove ? (
            <Button
              aria-label={`Убрать из группы ${membership.groupName}`}
              onClick={() => onRemove(membership.groupId)}
              size="icon"
              variant="ghost"
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function calculateAge(birthDate: string): number {
  const birth = new Date(`${birthDate}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  )
    age -= 1;
  return age;
}

function formatRubles(amount: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

function cardStatusLabel(status: string): string {
  return (
    (
      {
        ARCHIVED: 'в архиве',
        ASSIGNED: 'привязана',
        BLOCKED: 'заблокирована',
        FREE: 'свободна',
        LOST: 'утеряна',
      } as Record<string, string>
    )[status] ?? status
  );
}

async function copyPhone(phone: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(phone);
  } catch {
    // Clipboard access may be unavailable under restrictive desktop policies.
  }
}
