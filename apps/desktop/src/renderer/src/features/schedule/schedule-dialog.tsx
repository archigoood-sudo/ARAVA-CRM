import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatWeekday,
  t,
  weeklyScheduleInputSchema,
  type BranchSummary,
  type GroupSummary,
  type RoomSummary,
  type StaffOption,
  type WeeklyScheduleInput,
  type WeeklyScheduleSummary,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Select } from '@arava/ui';
import { useEffect, useLayoutEffect } from 'react';
import { useForm } from 'react-hook-form';

import { localDateInputValue } from '../../lib/local-date';

export function ScheduleDialog({
  branches,
  error,
  groups,
  onClose,
  onSubmit,
  open,
  rooms,
  schedule,
  staff,
}: {
  branches: BranchSummary[];
  error?: string | undefined;
  groups: GroupSummary[];
  onClose: () => void;
  onSubmit: (input: WeeklyScheduleInput) => Promise<void>;
  open: boolean;
  rooms: RoomSummary[];
  schedule: WeeklyScheduleSummary | null;
  staff: StaffOption[];
}) {
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
    setValue,
    watch,
  } = useForm<WeeklyScheduleInput>({ resolver: zodResolver(weeklyScheduleInputSchema) });
  const branchId = watch('branchId');
  const groupId = watch('groupId');
  const roomId = watch('roomId');
  const selectedGroup = groups.find((group) => group.id === groupId);
  const selectedRoom = rooms.find((room) => room.id === roomId);
  useEffect(() => {
    if (roomId && !rooms.some((room) => room.id === roomId && room.branchId === branchId))
      setValue('roomId', undefined);
  }, [branchId, roomId, rooms, setValue]);
  useLayoutEffect(() => {
    if (open)
      reset(
        schedule ?? {
          branchId: branches[0]?.id ?? '',
          coachId: undefined,
          endTime: '19:00',
          groupId: '',
          isActive: true,
          roomId: undefined,
          startTime: '18:00',
          validFrom: localDateInputValue(),
          weekday: 1,
        },
      );
  }, [branches, open, reset, schedule]);
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('schedule.dialogDescription')}
      onClose={onClose}
      open={open}
      title={schedule ? t('schedule.editTitle') : t('schedule.createTitle')}
      wide
    >
      <form
        className="grid grid-cols-2 gap-4"
        onSubmit={handleSubmit((value) =>
          onSubmit({
            ...value,
            room: undefined,
            roomId: value.roomId?.length ? value.roomId : undefined,
          }),
        )}
      >
        <Field label={t('student.branch')}>
          <Select {...register('branchId')}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field error={errors.groupId?.message} label={t('schedule.group')}>
          <Select {...register('groupId')}>
            <option value="">{t('schedule.group')}</option>
            {groups
              .filter((group) => !branchId || group.branchId === branchId)
              .map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('schedule.weekday')}>
          <Select {...register('weekday', { valueAsNumber: true })}>
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <option key={day} value={day}>
                {formatWeekday(day)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('group.coach')}>
          <Select {...register('coachId')}>
            <option value="">{t('group.noCoach')}</option>
            {staff.map((coach) => (
              <option key={coach.id} value={coach.id}>
                {coach.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('schedule.startTime')}>
          <Input type="time" {...register('startTime')} />
        </Field>
        <Field error={errors.endTime?.message} label={t('schedule.endTime')}>
          <Input type="time" {...register('endTime')} />
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
        <span />
        {selectedGroup &&
        selectedRoom?.capacity &&
        selectedGroup.studentCount > selectedRoom.capacity ? (
          <p className="col-span-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            В группе {selectedGroup.studentCount} учеников, вместимость зала —{' '}
            {selectedRoom.capacity}. Сохранение разрешено после проверки.
          </p>
        ) : null}
        <Field label={t('schedule.validFrom')}>
          <Input type="date" {...register('validFrom')} />
        </Field>
        <Field error={errors.validTo?.message} label={t('schedule.validTo')}>
          <Input type="date" {...register('validTo')} />
        </Field>
        {error ? <p className="col-span-2 text-sm text-red-600">{error}</p> : null}
        <div className="col-span-2 flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? t('common.saving') : t('schedule.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Field({
  children,
  error,
  label,
}: {
  children: React.ReactNode;
  error?: string | undefined;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
