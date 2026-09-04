import {
  t,
  type GroupSummary,
  type LessonInput,
  type LessonSummary,
  type RoomSummary,
  type StaffOption,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Select, Textarea } from '@arava/ui';
import { useEffect, useLayoutEffect } from 'react';
import { useForm } from 'react-hook-form';

function localDateTime(value: string): string {
  const date = new Date(value);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

interface LessonForm {
  coachId?: string | undefined;
  endsAt: string;
  groupId: string;
  notes?: string | undefined;
  payoutCategory?: 'REGULAR_ATTENDANCE' | 'MAKEUP' | 'PROMOTIONAL_FREE' | 'PERSONAL_LESSON';
  room?: string | undefined;
  roomId?: string | undefined;
  startsAt: string;
}

function editablePayoutCategory(
  value: LessonSummary['payoutCategory'],
): 'REGULAR_ATTENDANCE' | 'MAKEUP' | 'PROMOTIONAL_FREE' | 'PERSONAL_LESSON' {
  return value === 'MAKEUP' || value === 'PROMOTIONAL_FREE' || value === 'PERSONAL_LESSON'
    ? value
    : 'REGULAR_ATTENDANCE';
}

export function LessonDialog({
  error,
  groups,
  lesson,
  onClose,
  onSubmit,
  open,
  rooms,
  staff,
  variant = 'DEFAULT',
}: {
  error?: string | undefined;
  groups: GroupSummary[];
  lesson: LessonSummary | null;
  onClose: () => void;
  onSubmit: (input: LessonInput) => Promise<void>;
  open: boolean;
  rooms: RoomSummary[];
  staff: StaffOption[];
  variant?: 'DEFAULT' | 'MAKEUP' | 'RESCHEDULE';
}) {
  const {
    formState: { isSubmitting },
    handleSubmit,
    register,
    reset,
    setValue,
    watch,
  } = useForm<LessonForm>();
  const groupId = watch('groupId');
  const roomId = watch('roomId');
  const branchId = groups.find((group) => group.id === groupId)?.branchId;
  const selectedGroup = groups.find((group) => group.id === groupId);
  const selectedRoom = rooms.find((room) => room.id === roomId);
  useEffect(() => {
    if (roomId && !rooms.some((room) => room.id === roomId && room.branchId === branchId))
      setValue('roomId', undefined);
  }, [branchId, roomId, rooms, setValue]);
  useLayoutEffect(() => {
    if (!open) return;
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    const end = new Date(start.getTime() + 60 * 60_000);
    reset(
      lesson
        ? {
            coachId: lesson.coachId,
            endsAt: localDateTime(lesson.endsAt),
            groupId: lesson.groupId,
            notes: lesson.notes,
            payoutCategory: editablePayoutCategory(lesson.payoutCategory),
            room: lesson.room,
            roomId: lesson.roomId,
            startsAt: localDateTime(lesson.startsAt),
          }
        : {
            endsAt: localDateTime(end.toISOString()),
            groupId: groups[0]?.id ?? '',
            payoutCategory: 'REGULAR_ATTENDANCE',
            startsAt: localDateTime(start.toISOString()),
          },
    );
  }, [groups, lesson, open, reset]);
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      onClose={onClose}
      open={open}
      title={
        variant === 'MAKEUP'
          ? 'Назначить отработку'
          : variant === 'RESCHEDULE'
            ? 'Перенести занятие'
            : lesson
              ? t('lesson.action.move')
              : t('lesson.createTitle')
      }
      wide
    >
      <form
        className="grid grid-cols-2 gap-4"
        onSubmit={handleSubmit(async (value) =>
          onSubmit({
            ...value,
            coachId: value.coachId?.length ? value.coachId : undefined,
            endsAt: new Date(value.endsAt).toISOString(),
            notes: value.notes?.length ? value.notes : undefined,
            room: undefined,
            roomId: value.roomId?.length ? value.roomId : undefined,
            startsAt: new Date(value.startsAt).toISOString(),
          }),
        )}
      >
        <Field label={t('schedule.group')}>
          <Select disabled={variant !== 'DEFAULT'} required {...register('groupId')}>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('lesson.coach')}>
          <Select {...register('coachId')}>
            <option value="">{t('group.noCoach')}</option>
            {staff.map((coach) => (
              <option key={coach.id} value={coach.id}>
                {coach.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('lesson.start')}>
          <Input required type="datetime-local" {...register('startsAt')} />
        </Field>
        <Field label={t('lesson.end')}>
          <Input required type="datetime-local" {...register('endsAt')} />
        </Field>
        <Field label="Зал">
          <Select {...register('roomId')}>
            <option value="">Зал не указан</option>
            {rooms
              .filter((room) => room.branchId === branchId)
              .map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Категория выплаты">
          <Select disabled={variant === 'MAKEUP'} {...register('payoutCategory')}>
            <option value="REGULAR_ATTENDANCE">Обычное занятие</option>
            <option value="MAKEUP">Отработка</option>
            <option value="PROMOTIONAL_FREE">Промо / бесплатное</option>
            <option value="PERSONAL_LESSON">Персональное занятие</option>
          </Select>
        </Field>
        {selectedGroup &&
        selectedRoom?.capacity &&
        selectedGroup.studentCount > selectedRoom.capacity ? (
          <p className="col-span-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            В группе {selectedGroup.studentCount} учеников, вместимость зала —{' '}
            {selectedRoom.capacity}. Можно продолжить после проверки.
          </p>
        ) : null}
        <div className="col-span-2">
          <Field label={t('lesson.notes')}>
            <Textarea {...register('notes')} />
          </Field>
        </div>
        {error ? <p className="col-span-2 text-sm text-red-600">{error}</p> : null}
        <div className="col-span-2 flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? t('common.saving') : t('lesson.save')}
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
