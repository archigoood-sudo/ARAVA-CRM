import {
  formatDate,
  t,
  type Gender,
  type StudentContactInput,
  type StudentContactSummary,
  type StudentInput,
  type StudentNoteInput,
  type StudentProfileNote,
  type StudentStatus,
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
  TicketCheck,
  Trash2,
  UserRound,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { invalidateStudentIdentityCaches } from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { ContactDialog } from './contact-dialog';
import { StudentDialog } from './student-dialog';
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
  const queryClient = useQueryClient();
  const [studentDialog, setStudentDialog] = useState(false);
  const [contactDialog, setContactDialog] = useState(false);
  const [editingContact, setEditingContact] = useState<StudentContactSummary | null>(null);
  const [noteDialog, setNoteDialog] = useState(false);
  const [editingNote, setEditingNote] = useState<StudentProfileNote | null>(null);
  const [noteText, setNoteText] = useState('');
  const [groupDialog, setGroupDialog] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [financeAction, setFinanceAction] = useState<'payment' | 'subscription' | undefined>(() => {
    const action = searchParameters.get('action');
    return action === 'payment' || action === 'subscription' ? action : undefined;
  });
  const [cardAction, setCardAction] = useState(searchParameters.get('action') === 'card');
  const [error, setError] = useState<string>();
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
    enabled: canManage && Boolean(student.data?.student.id),
    queryFn: () => getDesktopApi().groups.listEligibleGroups(getSessionToken(), studentId),
    queryKey: ['groups', 'eligible-for-student', studentId],
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
  const addEnrollment = useMutation({
    mutationFn: (groupId: string) =>
      getDesktopApi().groups.addEnrollment(getSessionToken(), groupId, {
        joinedAt: new Date().toISOString().slice(0, 10),
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId,
      }),
  });
  const removeEnrollment = useMutation({
    mutationFn: ({ enrollmentId, groupId }: { enrollmentId: string; groupId: string }) =>
      getDesktopApi().groups.removeEnrollment(getSessionToken(), groupId, enrollmentId),
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
  const submitEnrollment = async () => {
    setError(undefined);
    try {
      await addEnrollment.mutateAsync(selectedGroupId);
      await refresh();
      setGroupDialog(false);
      setSelectedGroupId('');
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось добавить ученика в группу.'));
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
  return (
    <main className="mx-auto w-full max-w-[1320px] animate-fade-in p-9 pb-14">
      <Link
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        to="/students"
      >
        <ArrowLeft className="size-4" />
        {t('student.back')}
      </Link>

      <Card className="mb-5 overflow-hidden">
        <div className="relative flex items-center gap-5 bg-sidebar px-7 py-8 text-white">
          <span className="absolute right-0 top-0 h-full w-48 bg-[radial-gradient(circle_at_top_right,rgba(156,255,46,0.22),transparent_66%)]" />
          <Avatar className="ring-4 ring-white/10" name={fullName} size="large" />
          <div className="relative min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="truncate text-4xl font-semibold tracking-[-0.045em]">{fullName}</h2>
              <Badge className={statusStyles[detail.status]}>{t(`status.${detail.status}`)}</Badge>
            </div>
            <p className="mt-2 flex items-center gap-2 text-sm text-neutral-400">
              <MapPin className="size-4 text-accent" /> {detail.branchName}
            </p>
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
          {canManage ? (
            <Button
              className="relative border-white/15 bg-white/10 text-white hover:bg-white/15"
              onClick={() => {
                setError(undefined);
                setStudentDialog(true);
              }}
              variant="outline"
            >
              <Pencil className="size-4" />
              {t('student.action.edit')}
            </Button>
          ) : null}
        </div>
      </Card>

      {profile.warnings.length ? (
        <Card className="mb-5 border-amber-200 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-500/5">
          <CardContent className="flex items-start gap-4 p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle className="size-5" />
            </span>
            <div>
              <p className="font-semibold">Требует внимания</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {profile.warnings.map((warning) => (
                  <Badge
                    className={warning.tone === 'danger' ? 'bg-red-100 text-red-700' : ''}
                    key={warning.code}
                  >
                    {warning.message}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        <Card className="mb-5">
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <p className="mr-3 text-sm font-semibold">Быстрые действия</p>
            <Button onClick={() => setFinanceAction('payment')} size="small">
              <WalletCards className="size-4" /> Принять оплату
            </Button>
            <Button onClick={() => setFinanceAction('subscription')} size="small" variant="outline">
              <TicketCheck className="size-4" />{' '}
              {profile.currentSubscription ? 'Продлить абонемент' : 'Оформить абонемент'}
            </Button>
            <Button
              onClick={() => {
                void groups.refetch();
                setGroupDialog(true);
              }}
              size="small"
              variant="outline"
            >
              <UsersRound className="size-4" /> Добавить в группу
            </Button>
            <Button onClick={() => setCardAction(true)} size="small" variant="outline">
              <Crown className="size-4" /> {profile.card ? 'Заменить карту' : 'Привязать карту'}
            </Button>
            <Button
              onClick={() => {
                setEditingNote(null);
                setNoteText('');
                setNoteDialog(true);
              }}
              size="small"
              variant="outline"
            >
              <StickyNote className="size-4" /> Добавить заметку
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div
        className={
          profile.access === 'ADMIN'
            ? 'grid grid-cols-[340px_minmax(0,1fr)] gap-5'
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
                <div className="grid grid-cols-2 gap-3">
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

      <div className="mt-5 grid grid-cols-2 gap-5">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Группы</CardTitle>
            {canManage ? (
              <Button onClick={() => setGroupDialog(true)} size="small" variant="outline">
                <Plus className="size-4" /> Добавить
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2">
            {profile.groups.length ? (
              profile.groups.map((membership) => (
                <article
                  className="flex items-center gap-3 rounded-2xl border border-border bg-background p-4"
                  key={membership.enrollmentId}
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft">
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
                  </span>
                  <Badge>{t(`enrollment.status.${membership.membershipStatus}`)}</Badge>
                  {canManage ? (
                    <Button
                      aria-label={`Удалить из группы ${membership.groupName}`}
                      onClick={async () => {
                        if (!window.confirm(`Удалить ученика из группы «${membership.groupName}»?`))
                          return;
                        await removeEnrollment.mutateAsync({
                          enrollmentId: membership.enrollmentId,
                          groupId: membership.groupId,
                        });
                        await refresh();
                      }}
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </article>
              ))
            ) : (
              <EmptyState
                description={t('group.emptyDescription')}
                icon={UsersRound}
                title={t('student.groups')}
              />
            )}
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
                key={lesson.id}
                to={`/lessons/${lesson.id}`}
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
          <StudentFinance
            branches={branches.data ?? []}
            onRequestedActionHandled={() => setFinanceAction(undefined)}
            requestedAction={financeAction}
            student={detail}
          />
          <Card className="mt-5">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Оплаты и задолженность</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Последние финансовые операции</p>
              </div>
              <span
                className={
                  profile.totalDebt
                    ? 'text-xl font-semibold text-red-600'
                    : 'text-sm font-semibold text-emerald-600'
                }
              >
                {profile.totalDebt
                  ? `Долг: ${formatRubles(profile.totalDebt)}`
                  : 'Задолженности нет'}
              </span>
            </CardHeader>
            <CardContent className="space-y-2">
              {profile.recentPayments.length ? (
                profile.recentPayments.map((payment) => (
                  <div
                    className="flex items-center justify-between rounded-2xl border border-border p-4"
                    key={payment.id}
                  >
                    <span>
                      <span className="block text-sm font-semibold">
                        {formatRubles(payment.amount)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(payment.paidAt)} · {paymentMethodLabel(payment.method)}
                      </span>
                    </span>
                    <Badge>{t(`payment.status.${payment.status}`)}</Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Оплат пока нет</p>
              )}
            </CardContent>
          </Card>
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
              <CardHeader>
                <CardTitle>История</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {profile.history.length ? (
                  profile.history.map((event) => (
                    <div className="border-l-2 border-accent pl-4" key={event.id}>
                      <p className="text-sm font-semibold">{event.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {event.actorName} ·{' '}
                        {formatDate(event.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">История пока пуста</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      <Dialog
        closeLabel="Закрыть"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setGroupDialog(false)} variant="outline">
              Отмена
            </Button>
            <Button
              disabled={!selectedGroupId || addEnrollment.isPending}
              onClick={() => void submitEnrollment()}
            >
              Добавить в группу
            </Button>
          </div>
        }
        onClose={() => setGroupDialog(false)}
        open={groupDialog}
        title="Добавление в группу"
      >
        <div className="space-y-3">
          <Label htmlFor="student-profile-group">Группа</Label>
          <Select
            id="student-profile-group"
            onChange={(event) => setSelectedGroupId(event.target.value)}
            value={selectedGroupId}
          >
            <option value="">Выберите группу</option>
            {(groups.data ?? []).map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} · свободно {group.availablePlaces}
              </option>
            ))}
          </Select>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </Dialog>

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

function paymentMethodLabel(method: string): string {
  return (
    (
      {
        CASH: 'Наличные',
        CARD: 'Карта',
        TRANSFER: 'Перевод',
        ONLINE: 'Онлайн',
        OTHER: 'Другое',
      } as Record<string, string>
    )[method] ?? method
  );
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
