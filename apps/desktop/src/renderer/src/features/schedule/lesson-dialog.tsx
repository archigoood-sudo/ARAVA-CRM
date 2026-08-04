import {
  t,
  type GroupSummary,
  type LessonInput,
  type LessonSummary,
  type StaffOption,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Select, Textarea } from '@arava/ui';
import { useLayoutEffect } from 'react';
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
  room?: string | undefined;
  startsAt: string;
}

export function LessonDialog({
  error,
  groups,
  lesson,
  onClose,
  onSubmit,
  open,
  staff,
}: {
  error?: string | undefined;
  groups: GroupSummary[];
  lesson: LessonSummary | null;
  onClose: () => void;
  onSubmit: (input: LessonInput) => Promise<void>;
  open: boolean;
  staff: StaffOption[];
}) {
  const {
    formState: { isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<LessonForm>();
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
            room: lesson.room,
            startsAt: localDateTime(lesson.startsAt),
          }
        : {
            endsAt: localDateTime(end.toISOString()),
            groupId: groups[0]?.id ?? '',
            startsAt: localDateTime(start.toISOString()),
          },
    );
  }, [groups, lesson, open, reset]);
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      onClose={onClose}
      open={open}
      title={lesson ? t('lesson.action.move') : t('lesson.createTitle')}
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
            room: value.room?.length ? value.room : undefined,
            startsAt: new Date(value.startsAt).toISOString(),
          }),
        )}
      >
        <Field label={t('schedule.group')}>
          <Select required {...register('groupId')}>
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
        <Field label={t('lesson.room')}>
          <Input {...register('room')} />
        </Field>
        <span />
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
