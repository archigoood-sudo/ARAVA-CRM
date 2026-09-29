import { formatDate, type LessonSummary } from '@arava/shared';
import { Button, Dialog, Label } from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getDesktopApi } from '../../lib/desktop-api';
import { invalidateLessonCaches } from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

export function LessonSubstitutionControl({ lesson }: { lesson: LessonSummary }) {
  const user = useAuthStore((state) => state.user);
  const client = useQueryClient();
  const [mode, setMode] = useState<'assign' | 'remove' | null>(null);
  const [selected, setSelected] = useState('');
  const canManage =
    (user?.role === 'OWNER' || user?.role === 'ADMIN') && lesson.status !== 'CANCELLED';
  const isReplacement = Boolean(lesson.substituteCoachId);
  const regularId = isReplacement ? lesson.originalCoachId : lesson.coachId;
  const regularName =
    (isReplacement ? lesson.originalCoachName : lesson.coachName) ?? 'Не назначен';
  const staff = useQuery({
    enabled: mode === 'assign' && canManage,
    queryKey: queryKeys.staffOptions,
    queryFn: () => getDesktopApi().users.staffOptions(getSessionToken()),
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === 'remove')
        await getDesktopApi().lessons.removeSubstitution(getSessionToken(), lesson.id);
      else
        await getDesktopApi().lessons.assignSubstitution(getSessionToken(), lesson.id, {
          substituteTrainerId: selected,
        });
    },
    onSuccess: async () => {
      setMode(null);
      await invalidateLessonCaches(client);
    },
  });
  function open(next: 'assign' | 'remove') {
    mutation.reset();
    setSelected(lesson.substituteCoachId ?? '');
    setMode(next);
  }
  return (
    <div className="mt-3 space-y-1 text-sm" data-testid="lesson-substitution">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Тренер: {lesson.substituteCoachName ?? lesson.coachName ?? 'Не назначен'}</strong>
        {canManage ? (
          <Button variant="outline" onClick={() => open('assign')}>
            {isReplacement ? 'Изменить' : 'Замена'}
          </Button>
        ) : null}
        {canManage && isReplacement ? (
          <Button variant="outline" onClick={() => open('remove')}>
            Снять замену
          </Button>
        ) : null}
      </div>
      {isReplacement ? <p className="text-muted-foreground">Замена вместо {regularName}</p> : null}
      <Dialog
        open={mode !== null}
        onClose={() => {
          if (!mutation.isPending) setMode(null);
        }}
        closeLabel="Закрыть"
        title={mode === 'remove' ? 'Снять замену' : 'Замена тренера'}
      >
        <div className="space-y-4">
          {mode === 'assign' ? (
            <div>
              <Label htmlFor={`substitute-${lesson.id}`}>Заменяющий тренер</Label>
              <select
                id={`substitute-${lesson.id}`}
                className="mt-2 h-11 w-full rounded-xl border border-border bg-surface px-3"
                value={selected}
                disabled={mutation.isPending}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Выберите тренера</option>
                {(staff.data ?? [])
                  .filter((trainer) => trainer.role === 'COACH' && trainer.id !== regularId)
                  .map((trainer) => (
                    <option key={trainer.id} value={trainer.id}>
                      {trainer.fullName}
                    </option>
                  ))}
              </select>
              {staff.isLoading ? <p>Загружаем тренеров…</p> : null}
              {staff.isError ? <p role="alert">Не удалось загрузить тренеров.</p> : null}
            </div>
          ) : null}
          <div className="rounded-xl bg-muted p-4">
            <p>
              Занятие{' '}
              {formatDate(lesson.startsAt, {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <p>Основной тренер: {regularName}</p>
            <p>
              Проведёт:{' '}
              {mode === 'remove'
                ? regularName
                : (staff.data?.find(({ id }) => id === selected)?.fullName ?? 'Выберите тренера')}
            </p>
            <p className="mt-2 text-muted-foreground">
              Только это занятие. Будущее расписание и посещения не изменятся.
            </p>
          </div>
          {mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={mutation.isPending} onClick={() => setMode(null)}>
              Отмена
            </Button>
            <Button
              disabled={mutation.isPending || (mode === 'assign' && !selected)}
              onClick={() => mutation.mutate()}
            >
              {mode === 'remove' ? 'Снять замену' : 'Сохранить замену'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
