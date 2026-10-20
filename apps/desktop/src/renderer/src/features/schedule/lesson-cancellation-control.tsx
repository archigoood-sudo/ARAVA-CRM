import { formatDate, type LessonSummary } from '@arava/shared';
import { Button, Dialog, Input, Label } from '@arava/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDesktopApi } from '../../lib/desktop-api';
import { invalidateAttendanceCaches, invalidateLessonCaches } from '../../lib/operational-cache';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

export function LessonCancellationControl({
  lesson,
  busy = false,
}: {
  lesson: LessonSummary;
  busy?: boolean;
}) {
  const role = useAuthStore((state) => state.user?.role);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [requiresMakeup, setRequiresMakeup] = useState(false);
  const cancel = useMutation({
    mutationFn: () =>
      getDesktopApi().lessons.cancel(getSessionToken(), lesson.id, {
        cancellationReason: reason.trim(),
        requiresMakeup,
      }),
    onSuccess: async () => {
      setOpen(false);
      await navigate(`/lessons/${lesson.id}`);
      await invalidateLessonCaches(client);
      await invalidateAttendanceCaches(client);
    },
  });
  if ((role !== 'OWNER' && role !== 'ADMIN') || lesson.status === 'CANCELLED') return null;
  return (
    <>
      <Button
        className="mt-3"
        variant="outline"
        size="small"
        disabled={busy || cancel.isPending}
        onClick={() => {
          cancel.reset();
          setReason('');
          setRequiresMakeup(false);
          setOpen(true);
        }}
      >
        Отменить занятие
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!cancel.isPending) setOpen(false);
        }}
        title="Отменить только это занятие"
        closeLabel="Закрыть"
      >
        <div className="space-y-4">
          <p className="font-semibold">
            {lesson.groupName} ·{' '}
            {formatDate(lesson.startsAt, { dateStyle: 'short', timeStyle: 'short' })}
          </p>
          <p className="text-sm text-muted-foreground">
            Занятие останется в истории со статусом «Отменено». Регулярное расписание и будущие
            занятия не изменятся. Списания за это занятие будут возвращены по существующим правилам.
          </p>
          <div className="space-y-2">
            <Label htmlFor="attendance-cancel-reason">Причина отмены</Label>
            <Input
              id="attendance-cancel-reason"
              value={reason}
              disabled={cancel.isPending}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requiresMakeup}
              disabled={cancel.isPending}
              onChange={(event) => setRequiresMakeup(event.target.checked)}
            />
            Запланировать последующую отработку
          </label>
          {cancel.error ? (
            <p role="alert" className="text-sm text-red-600">
              {cancel.error.message}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button variant="outline" disabled={cancel.isPending} onClick={() => setOpen(false)}>
              Не отменять
            </Button>
            <Button
              disabled={busy || cancel.isPending || reason.trim().length < 2}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? 'Отменяем…' : 'Подтвердить отмену занятия'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
