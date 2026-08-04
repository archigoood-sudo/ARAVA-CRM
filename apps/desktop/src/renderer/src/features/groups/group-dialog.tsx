import { zodResolver } from '@hookform/resolvers/zod';
import {
  GROUP_STATUSES,
  groupInputSchema,
  t,
  type BranchSummary,
  type GroupInput,
  type GroupSummary,
  type StaffOption,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Select, Textarea } from '@arava/ui';
import { useLayoutEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';

const blank: GroupInput = {
  branchId: '',
  capacity: 20,
  color: '#9CFF2E',
  direction: '',
  name: '',
  status: 'RECRUITING',
};

export function GroupDialog({
  branches,
  error,
  group,
  onClose,
  onSubmit,
  open,
  staff,
}: {
  branches: BranchSummary[];
  error?: string | undefined;
  group: GroupSummary | null;
  onClose: () => void;
  onSubmit: (input: GroupInput) => Promise<void>;
  open: boolean;
  staff: StaffOption[];
}) {
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<GroupInput>({ defaultValues: blank, resolver: zodResolver(groupInputSchema) });
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && !wasOpen.current) reset(group ?? blank);
    wasOpen.current = open;
  }, [group, open, reset]);
  const optionalNumber = {
    setValueAs: (value: string) => (value === '' ? undefined : Number(value)),
  };
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('group.dialogDescription')}
      onClose={onClose}
      open={open}
      title={group ? t('group.editTitle') : t('group.createTitle')}
      wide
    >
      <form className="grid grid-cols-2 gap-4" onSubmit={handleSubmit(onSubmit)}>
        <Field error={errors.name?.message} label={t('group.name')}>
          <Input aria-label={t('group.name')} {...register('name')} />
        </Field>
        <Field error={errors.direction?.message} label={t('group.direction')}>
          <Input aria-label={t('group.direction')} {...register('direction')} />
        </Field>
        <Field error={errors.branchId?.message} label={t('student.branch')}>
          <Select aria-label={t('student.branch')} {...register('branchId')}>
            <option value="">{t('group.filter.branch')}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.status')}>
          <Select aria-label={t('common.status')} {...register('status')}>
            {GROUP_STATUSES.filter(
              (status) => status !== 'ARCHIVED' || group?.status === 'ARCHIVED',
            ).map((status) => (
              <option key={status} value={status}>
                {t(`group.status.${status}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('group.coach')}>
          <Select aria-label={t('group.coach')} {...register('coachId')}>
            <option value="">{t('group.noCoach')}</option>
            {staff.map((coach) => (
              <option key={coach.id} value={coach.id}>
                {coach.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field error={errors.assistantCoachId?.message} label={t('group.assistantCoach')}>
          <Select aria-label={t('group.assistantCoach')} {...register('assistantCoachId')}>
            <option value="">{t('common.notSpecified')}</option>
            {staff.map((coach) => (
              <option key={coach.id} value={coach.id}>
                {coach.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field error={errors.ageFrom?.message} label={t('group.ageFrom')}>
          <Input
            aria-label={t('group.ageFrom')}
            min={0}
            type="number"
            {...register('ageFrom', optionalNumber)}
          />
        </Field>
        <Field error={errors.ageTo?.message} label={t('group.ageTo')}>
          <Input
            aria-label={t('group.ageTo')}
            min={0}
            type="number"
            {...register('ageTo', optionalNumber)}
          />
        </Field>
        <Field error={errors.capacity?.message} label={t('group.capacity')}>
          <Input
            aria-label={t('group.capacity')}
            min={1}
            type="number"
            {...register('capacity', { valueAsNumber: true })}
          />
        </Field>
        <Field error={errors.color?.message} label={t('group.color')}>
          <Input aria-label={t('group.color')} type="color" {...register('color')} />
        </Field>
        <div className="col-span-2">
          <Field label={t('group.description')}>
            <Textarea aria-label={t('group.description')} {...register('description')} />
          </Field>
        </div>
        {error ? <p className="col-span-2 text-sm text-red-600">{error}</p> : null}
        <div className="col-span-2 flex justify-end gap-3 pt-2">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? t('common.saving') : t('group.save')}
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
