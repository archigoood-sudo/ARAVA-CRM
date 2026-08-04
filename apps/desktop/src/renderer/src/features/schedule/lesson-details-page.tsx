import { formatDate, t, type LessonCancelInput, type LessonInput } from '@arava/shared';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  ErrorState,
  Input,
  Label,
  LoadingState,
  StatusBadge,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CalendarClock, MapPin, Pencil, UserRoundCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { LessonDialog } from './lesson-dialog';

export function LessonDetailsPage() {
  const { lessonId = '' } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role !== 'COACH';
  const [edit, setEdit] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const lesson = useQuery({
    queryFn: () => getDesktopApi().lessons.get(getSessionToken(), lessonId),
    queryKey: queryKeys.lesson(lessonId),
  });
  const groups = useQuery({
    queryFn: () => getDesktopApi().groups.list(getSessionToken(), {}),
    queryKey: queryKeys.groups({}),
  });
  const staff = useQuery({
    queryFn: () => getDesktopApi().users.staffOptions(getSessionToken()),
    queryKey: queryKeys.staffOptions,
  });
  const update = useMutation({
    mutationFn: (input: LessonInput) =>
      getDesktopApi().lessons.update(getSessionToken(), lessonId, input),
  });
  const cancelMutation = useMutation({
    mutationFn: (input: LessonCancelInput) =>
      getDesktopApi().lessons.cancel(getSessionToken(), lessonId, input),
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.lesson(lessonId) }),
      client.invalidateQueries({ queryKey: ['subscriptions'] }),
      client.invalidateQueries({ queryKey: ['students', 'finance'] }),
      client.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };
  if (lesson.isLoading) return <LoadingState label={t('common.loading')} />;
  if (!lesson.data || lesson.isError)
    return (
      <ErrorState
        message={t('lesson.errorLoad')}
        onRetry={() => void lesson.refetch()}
        retryLabel={t('common.retry')}
        title={t('common.errorTitle')}
      />
    );
  const detail = lesson.data;
  return (
    <main className="mx-auto w-full max-w-[1100px] animate-fade-in p-9">
      <Link
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground"
        to="/schedule"
      >
        <ArrowLeft className="size-4" />
        {t('nav.schedule')}
      </Link>
      <Card className="overflow-hidden">
        <div className="bg-sidebar p-8 text-white">
          <div className="flex items-start justify-between">
            <div>
              <StatusBadge tone={detail.status === 'CANCELLED' ? 'danger' : 'accent'}>
                {t(`lesson.status.${detail.status}`)}
              </StatusBadge>
              <h1 className="mt-4 text-4xl font-semibold">{detail.groupName}</h1>
              <p className="mt-3 flex items-center gap-2 text-neutral-400">
                <MapPin className="size-4 text-accent" />
                {detail.branchName}
              </p>
            </div>
            <CalendarClock className="size-12 text-accent" />
          </div>
        </div>
        <CardContent className="grid grid-cols-2 gap-4 pt-6">
          <Info
            label={t('lesson.start')}
            value={formatDate(detail.startsAt, { dateStyle: 'long', timeStyle: 'short' })}
          />
          <Info
            label={t('lesson.end')}
            value={formatDate(detail.endsAt, { dateStyle: 'long', timeStyle: 'short' })}
          />
          <Info label={t('lesson.coach')} value={detail.coachName ?? t('group.noCoach')} />
          <Info label={t('lesson.room')} value={detail.room ?? t('common.notSpecified')} />
          <div className="col-span-2 mt-4 flex gap-3">
            <Button onClick={() => navigate(`/attendance/${detail.id}`)}>
              <UserRoundCheck className="size-4" />
              {t('lesson.action.attendance')}
            </Button>
            {canManage && detail.status !== 'CANCELLED' ? (
              <>
                <Button onClick={() => setEdit(true)} variant="outline">
                  <Pencil className="size-4" />
                  {t('lesson.action.move')}
                </Button>
                <Button onClick={() => setCancel(true)} variant="outline">
                  <Ban className="size-4" />
                  {t('lesson.action.cancel')}
                </Button>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <LessonDialog
        groups={groups.data ?? []}
        lesson={detail}
        onClose={() => setEdit(false)}
        onSubmit={async (input) => {
          await update.mutateAsync(input);
          await refresh();
          setEdit(false);
        }}
        open={edit}
        staff={staff.data ?? []}
      />
      <Dialog
        closeLabel={t('common.closeDialog')}
        onClose={() => setCancel(false)}
        open={cancel}
        title={t('lesson.cancelTitle')}
      >
        <div className="space-y-4">
          <Label>{t('lesson.cancelReason')}</Label>
          <Input onChange={(event) => setReason(event.target.value)} value={reason} />
          <div className="flex justify-end gap-3">
            <Button onClick={() => setCancel(false)} variant="outline">
              {t('common.cancel')}
            </Button>
            <Button
              disabled={reason.trim().length < 2}
              onClick={async () => {
                await cancelMutation.mutateAsync({ cancellationReason: reason });
                await refresh();
                setCancel(false);
              }}
            >
              {t('lesson.action.cancel')}
            </Button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-medium">{value}</p>
    </div>
  );
}
