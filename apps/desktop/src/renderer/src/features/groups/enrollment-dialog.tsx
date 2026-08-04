import { zodResolver } from '@hookform/resolvers/zod';
import { enrollmentInputSchema, t, type EnrollmentInput, type StudentSummary } from '@arava/shared';
import { Button, Checkbox, Dialog, Label, Select, Textarea } from '@arava/ui';
import { useLayoutEffect } from 'react';
import { useForm } from 'react-hook-form';

export function EnrollmentDialog({
  error,
  isFull,
  onClose,
  onSubmit,
  open,
  students,
}: {
  error?: string | undefined;
  isFull: boolean;
  onClose: () => void;
  onSubmit: (input: EnrollmentInput) => Promise<void>;
  open: boolean;
  students: StudentSummary[];
}) {
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<EnrollmentInput>({
    defaultValues: {
      joinedAt: new Date().toISOString().slice(0, 10),
      notes: '',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: '',
    },
    resolver: zodResolver(enrollmentInputSchema),
  });
  useLayoutEffect(() => {
    if (open)
      reset({
        joinedAt: new Date().toISOString().slice(0, 10),
        notes: '',
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: '',
      });
  }, [open, reset]);
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('enrollment.dialogDescription')}
      onClose={onClose}
      open={open}
      title={t('enrollment.title')}
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-2">
          <Label>{t('enrollment.selectStudent')}</Label>
          <Select aria-label={t('enrollment.selectStudent')} {...register('studentId')}>
            <option value="">{t('enrollment.selectStudent')}</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.lastName} {student.firstName}
              </option>
            ))}
          </Select>
          {errors.studentId ? (
            <p className="text-xs text-red-600">{errors.studentId.message}</p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t('enrollment.joinedAt')}</Label>
            <input
              aria-label={t('enrollment.joinedAt')}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
              type="date"
              {...register('joinedAt')}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('common.status')}</Label>
            <Select aria-label={t('common.status')} {...register('status')}>
              <option value="ACTIVE">{t('enrollment.status.ACTIVE')}</option>
              <option value="TRIAL">{t('enrollment.status.TRIAL')}</option>
              <option value="FROZEN">{t('enrollment.status.FROZEN')}</option>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('enrollment.notes')}</Label>
          <Textarea {...register('notes')} />
        </div>
        {isFull ? (
          <label className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <Checkbox {...register('overrideCapacity')} />
            <span>{t('group.capacityOverride')}</span>
          </label>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? t('common.saving') : t('enrollment.add')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
