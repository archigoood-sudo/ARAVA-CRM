import { formatDate, type LessonSummary } from '@arava/shared';
import { Button, Dialog, Input, Label } from '@arava/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { invalidateAttendanceCaches, invalidateLessonCaches } from '../../lib/operational-cache';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

export function LessonEndCorrectionControl({ lesson }: { lesson: LessonSummary }) {
  const role = useAuthStore((state) => state.user?.role);
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const correction = useMutation({
    mutationFn: () =>
      getDesktopApi().lessons.reschedule(getSessionToken(), lesson.id, {
        startsAt: lesson.startsAt,
        endsAt: new Date(end).toISOString(),
        coachId: lesson.coachId,
        roomId: lesson.roomId,
        room: lesson.room,
        endTimeCorrection: { expectedEndsAt: lesson.endsAt, reason: reason.trim() },
      }),
    onSuccess: async () => {
      setOpen(false);
      await invalidateLessonCaches(client);
      await invalidateAttendanceCaches(client);
    },
  });
  if (
    (role !== 'OWNER' && role !== 'ADMIN') ||
    lesson.status === 'CANCELLED' ||
    Date.parse(lesson.endsAt) - Date.parse(lesson.startsAt) <= 24 * 60 * 60_000
  )
    return null;
  const duration = Date.parse(end) - Date.parse(lesson.startsAt);
  const valid =
    Number.isFinite(duration) &&
    duration > 0 &&
    duration <= 24 * 60 * 60_000 &&
    Date.parse(end) < Date.parse(lesson.endsAt) &&
    reason.trim().length >= 2;
  return (
    <>
      <Button
        className="mt-3"
        variant="outline"
        onClick={() => {
          correction.reset();
          setEnd('');
          setReason('');
          setOpen(true);
        }}
      >
        Исправить окончание
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!correction.isPending) setOpen(false);
        }}
        title="Исправить ошибочное окончание"
        closeLabel="Закрыть"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !correction.isPending) correction.mutate();
          }}
        >
          <p>{lesson.groupName}</p>
          <p>Начало: {formatDate(lesson.startsAt, { dateStyle: 'long', timeStyle: 'short' })}</p>
          <p>
            Сохранённое окончание:{' '}
            {formatDate(lesson.endsAt, { dateStyle: 'long', timeStyle: 'short' })}
          </p>
          <p>
            Будет исправлено только окончание этого занятия. Посещения, списания, оплаты, тренер и
            регулярное расписание останутся прежними. Утверждённые расчётные листы не изменятся.
          </p>
          <div>
            <Label htmlFor="lesson-correct-end">Фактическое окончание</Label>
            <Input
              id="lesson-correct-end"
              type="datetime-local"
              required
              value={end}
              disabled={correction.isPending}
              onChange={(event) => setEnd(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lesson-correct-reason">Причина исправления</Label>
            <Input
              id="lesson-correct-reason"
              required
              minLength={2}
              maxLength={500}
              value={reason}
              disabled={correction.isPending}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Укажите фактическую дату и время окончания, не позднее 24 часов после начала.
          </p>
          {correction.isError ? (
            <p role="alert" className="text-red-600">
              {getErrorMessage(
                correction.error,
                'Не удалось исправить окончание. Обновите карточку и попробуйте снова.',
              )}
            </p>
          ) : null}
          <Button type="submit" disabled={!valid || correction.isPending}>
            Подтвердить исправление
          </Button>
        </form>
      </Dialog>
    </>
  );
}
