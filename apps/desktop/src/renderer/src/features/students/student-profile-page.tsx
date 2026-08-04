import {
  formatDate,
  t,
  type Gender,
  type StudentContactInput,
  type StudentContactSummary,
  type StudentInput,
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
  EmptyState,
  ErrorState,
  LoadingState,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  Crown,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Trash2,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { ContactDialog } from './contact-dialog';
import { StudentDialog } from './student-dialog';
import { StudentFinance } from '../subscriptions/student-finance';

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
  const user = useAuthStore((state) => state.user);
  const canManage =
    user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'BRANCH_MANAGER';
  const queryClient = useQueryClient();
  const [studentDialog, setStudentDialog] = useState(false);
  const [contactDialog, setContactDialog] = useState(false);
  const [editingContact, setEditingContact] = useState<StudentContactSummary | null>(null);
  const [error, setError] = useState<string>();
  const student = useQuery({
    enabled: Boolean(studentId),
    queryFn: () => getDesktopApi().students.get(getSessionToken(), studentId),
    queryKey: queryKeys.student(studentId),
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
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
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.student(studentId) });
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

  const detail = student.data;
  const fullName = `${detail.lastName} ${detail.firstName}${detail.middleName ? ` ${detail.middleName}` : ''}`;
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

      <div className="grid grid-cols-[340px_minmax(0,1fr)] gap-5">
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
            </dl>
          </CardContent>
        </Card>

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
                    <Button onClick={() => setContactDialog(true)}>{t('contact.addFirst')}</Button>
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
                      <p className="flex items-center gap-2">
                        <Phone className="size-3.5 text-muted-foreground" /> {contact.phone}
                      </p>
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
      </div>

      <div className="mt-5 grid grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle>{t('student.groups')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {detail.groups.length ? (
              detail.groups.map((membership) => (
                <Link
                  className="flex items-center gap-3 rounded-2xl border border-border bg-background p-4 transition hover:bg-muted/50"
                  key={`${membership.groupId}-${membership.joinedAt}`}
                  to={`/groups/${membership.groupId}`}
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft">
                    <UsersRound className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {membership.groupName}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {formatDate(membership.joinedAt)}
                    </span>
                  </span>
                  <Badge>{t(`enrollment.status.${membership.status}`)}</Badge>
                </Link>
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
            <CardTitle>{t('attendance.history')}</CardTitle>
            <span className="text-2xl font-semibold">{detail.attendancePercentage}%</span>
          </CardHeader>
          <CardContent className="space-y-2">
            {detail.attendanceHistory.length ? (
              detail.attendanceHistory.map((entry) => (
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

      <StudentFinance branches={branches.data ?? []} student={detail} />

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
