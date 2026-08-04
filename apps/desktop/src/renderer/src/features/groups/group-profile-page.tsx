import { formatDate, formatWeekday, t, type EnrollmentInput } from '@arava/shared';
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  ParticipantRow,
  StatusBadge,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, MapPin, Plus, Trash2, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { EnrollmentDialog } from './enrollment-dialog';

export function GroupProfilePage() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role !== 'COACH';
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState<string>();
  const group = useQuery({
    enabled: Boolean(groupId),
    queryFn: () => getDesktopApi().groups.get(getSessionToken(), groupId),
    queryKey: queryKeys.group(groupId),
  });
  const students = useQuery({
    enabled: Boolean(group.data),
    queryFn: () =>
      getDesktopApi().students.list(getSessionToken(), {
        branchId: group.data?.branchId,
        page: 1,
        pageSize: 100,
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    queryKey: ['group-students', group.data?.branchId],
  });
  const add = useMutation({
    mutationFn: (input: EnrollmentInput) =>
      getDesktopApi().groups.addEnrollment(getSessionToken(), groupId, input),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      getDesktopApi().groups.removeEnrollment(getSessionToken(), groupId, id),
  });
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.group(groupId) });
  if (group.isLoading) return <LoadingState label={t('group.loading')} />;
  if (!group.data || group.isError)
    return (
      <ErrorState
        message={t('group.errorLoad')}
        onRetry={() => void group.refetch()}
        retryLabel={t('common.retry')}
        title={t('common.errorTitle')}
      />
    );
  const detail = group.data;
  const submit = async (input: EnrollmentInput) => {
    setError(undefined);
    try {
      await add.mutateAsync(input);
      await refresh();
      setDialog(false);
    } catch (caught) {
      setError(getErrorMessage(caught, t('group.errorSave')));
    }
  };
  const removeParticipant = async (id: string) => {
    await remove.mutateAsync(id);
    await refresh();
  };
  return (
    <main className="mx-auto w-full max-w-[1400px] animate-fade-in p-9 pb-14">
      <Link
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        to="/groups"
      >
        <ArrowLeft className="size-4" />
        {t('group.back')}
      </Link>
      <Card className="mb-5 overflow-hidden">
        <div className="relative flex items-center gap-5 bg-sidebar px-7 py-8 text-white">
          <div
            className="absolute inset-y-0 right-0 w-64 opacity-30"
            style={{
              background: `radial-gradient(circle at right, ${detail.color ?? '#9CFF2E'}, transparent 70%)`,
            }}
          />
          <Avatar className="ring-4 ring-white/10" name={detail.name} size="large" />
          <div className="relative flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-4xl font-semibold tracking-[-0.045em]">{detail.name}</h2>
              <StatusBadge tone="accent">{t(`group.status.${detail.status}`)}</StatusBadge>
            </div>
            <p className="mt-2 flex items-center gap-2 text-sm text-neutral-400">
              <MapPin className="size-4 text-accent" />
              {detail.branchName} · {detail.direction}
            </p>
          </div>
          <div className="relative text-right">
            <p className="text-3xl font-semibold">
              {detail.studentCount}/{detail.capacity}
            </p>
            <p className="text-xs text-neutral-400">
              {t('group.students', { count: detail.studentCount })}
            </p>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] gap-5">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>{t('group.participants')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('group.available', { count: detail.availablePlaces })}
              </p>
            </div>
            {canManage ? (
              <Button onClick={() => setDialog(true)} size="small">
                <Plus className="size-4" />
                {t('group.action.addParticipant')}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2">
            {detail.participants.filter(({ leftAt }) => !leftAt).length ? (
              detail.participants
                .filter(({ leftAt }) => !leftAt)
                .map((participant) => (
                  <ParticipantRow
                    actions={
                      canManage ? (
                        <Button
                          aria-label={t('group.removeParticipant')}
                          onClick={() => void removeParticipant(participant.id)}
                          size="icon"
                          variant="ghost"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : undefined
                    }
                    detail={`${t(`enrollment.status.${participant.status}`)} · ${formatDate(participant.joinedAt)}`}
                    key={participant.id}
                    name={participant.studentName}
                    trailing={
                      <button
                        className="text-xs font-semibold text-muted-foreground hover:text-foreground"
                        onClick={() => navigate(`/students/${participant.studentId}`)}
                        type="button"
                      >
                        {t('page.profile.title')}
                      </button>
                    }
                  />
                ))
            ) : (
              <EmptyState
                description={t('group.emptyDescription')}
                icon={UsersRound}
                title={t('enrollment.empty')}
              />
            )}
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t('group.attendance')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-5xl font-semibold tracking-tight">
                {detail.attendancePercentage}%
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{t('attendance.history')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('nav.schedule')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {detail.schedules.map((schedule) => (
                <div className="rounded-2xl border border-border p-4 text-sm" key={schedule.id}>
                  <p className="font-semibold">
                    {formatWeekday(schedule.weekday)}, {schedule.startTime}–{schedule.endTime}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {schedule.room ?? t('common.notSpecified')}
                  </p>
                </div>
              ))}
              <Button className="w-full" onClick={() => navigate('/schedule')} variant="outline">
                <CalendarDays className="size-4" />
                {t('nav.schedule')}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
      <EnrollmentDialog
        error={error}
        isFull={detail.studentCount >= detail.capacity}
        onClose={() => setDialog(false)}
        onSubmit={submit}
        open={dialog}
        students={(students.data?.items ?? []).filter(
          (student) =>
            !detail.participants.some(
              (participant) => !participant.leftAt && participant.studentId === student.id,
            ),
        )}
      />
    </main>
  );
}
