import {
  ATTENDANCE_STATUSES,
  formatDate,
  t,
  type AttendanceEntryInput,
  type AttendanceStatus,
} from '@arava/shared';
import {
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
  type StatusTone,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCheck, CircleCheck, UsersRound } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken } from '../../stores/auth-store';

const tones: Record<AttendanceStatus, StatusTone> = {
  ABSENT: 'danger',
  EXCUSED: 'info',
  LATE: 'warning',
  PRESENT: 'success',
  TRIAL: 'accent',
};

export function AttendancePage() {
  const { lessonId = '' } = useParams();
  const client = useQueryClient();
  const attendance = useQuery({
    enabled: Boolean(lessonId),
    queryFn: () => getDesktopApi().attendance.get(getSessionToken(), lessonId),
    queryKey: queryKeys.attendance(lessonId),
  });
  const save = useMutation({
    mutationFn: (entries: AttendanceEntryInput[]) =>
      getDesktopApi().attendance.save(getSessionToken(), lessonId, entries),
    onSuccess: async (data) => {
      client.setQueryData(queryKeys.attendance(lessonId), data);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['subscriptions'] }),
        client.invalidateQueries({ queryKey: ['students', 'finance'] }),
        client.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
  });
  if (attendance.isLoading) return <LoadingState label={t('attendance.loading')} />;
  if (!attendance.data || attendance.isError)
    return (
      <ErrorState
        message={t('attendance.errorLoad')}
        onRetry={() => void attendance.refetch()}
        retryLabel={t('common.retry')}
        title={t('common.errorTitle')}
      />
    );
  const { lesson, participants } = attendance.data;
  const marked = participants.filter(({ status }) => status).length;
  return (
    <main className="mx-auto w-full max-w-[1240px] animate-fade-in p-9 pb-14">
      <Link
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground"
        to={`/lessons/${lessonId}`}
      >
        <ArrowLeft className="size-4" />
        {t('lesson.details')}
      </Link>
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {formatDate(lesson.startsAt, { dateStyle: 'long', timeStyle: 'short' })}
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em]">
            {t('attendance.pageTitle')} · {lesson.groupName}
          </h1>
          <p className="mt-2 text-muted-foreground">{t('attendance.pageDescription')}</p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-2 text-sm font-semibold">
            <CircleCheck className="size-4 text-emerald-500" />
            {t('attendance.instantSave')}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('attendance.marked', { expected: participants.length, marked })}
          </p>
          {attendance.data.attendanceCompletedAt ? (
            <p className="mt-1 text-xs font-semibold text-emerald-600">Посещаемость заполнена</p>
          ) : null}
        </div>
      </header>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t('group.participants')}</CardTitle>
          <Button
            disabled={save.isPending || participants.length === 0}
            onClick={() =>
              void save.mutateAsync(
                participants.map(({ studentId }) => ({ status: 'PRESENT', studentId })),
              )
            }
          >
            <CheckCheck className="size-4" />
            {t('attendance.action.allPresent')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {participants.length === 0 ? (
            <EmptyState
              description={t('attendance.empty')}
              icon={UsersRound}
              title={t('enrollment.empty')}
            />
          ) : (
            participants.map((participant) => (
              <ParticipantRow
                detail={
                  participant.status ? (
                    <StatusBadge tone={tones[participant.status]}>
                      {t(`attendance.status.${participant.status}`)}
                    </StatusBadge>
                  ) : (
                    t('common.notSpecified')
                  )
                }
                key={participant.studentId}
                name={participant.studentName}
                trailing={
                  <div className="flex flex-wrap justify-end gap-1">
                    {ATTENDANCE_STATUSES.map((status) => (
                      <button
                        aria-label={`${participant.studentName}: ${t(`attendance.status.${status}`)}`}
                        className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${participant.status === status ? 'border-transparent bg-sidebar text-white' : 'border-border bg-surface hover:bg-muted'}`}
                        disabled={save.isPending}
                        key={status}
                        onClick={() =>
                          void save.mutateAsync([{ status, studentId: participant.studentId }])
                        }
                        type="button"
                      >
                        {t(`attendance.status.${status}`)}
                      </button>
                    ))}
                  </div>
                }
              />
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
