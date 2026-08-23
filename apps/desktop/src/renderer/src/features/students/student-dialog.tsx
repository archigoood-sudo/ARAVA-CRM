import { zodResolver } from '@hookform/resolvers/zod';
import {
  GENDERS,
  STUDENT_STATUSES,
  studentInputSchema,
  t,
  type BranchSummary,
  type Gender,
  type StudentInput,
  type StudentSummary,
  type StudentStatus,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Select, Textarea } from '@arava/ui';
import { useLayoutEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';

const statusLabels: Record<StudentStatus, string> = {
  ACTIVE: t('status.ACTIVE'),
  ARCHIVED: t('status.ARCHIVED'),
  FROZEN: t('status.FROZEN'),
  LEFT: t('status.LEFT'),
  TRIAL: t('status.TRIAL'),
};
const genderLabels: Record<Gender, string> = {
  FEMALE: t('gender.FEMALE'),
  MALE: t('gender.MALE'),
  OTHER: t('gender.OTHER'),
};

export function StudentDialog({
  branches,
  error,
  initialValues,
  onClose,
  onSubmit,
  open,
  student,
}: {
  branches: BranchSummary[];
  error?: string | undefined;
  initialValues?: Partial<StudentInput> | undefined;
  onClose: () => void;
  onSubmit: (input: StudentInput) => Promise<void>;
  open: boolean;
  student: StudentSummary | null;
}) {
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<StudentInput>({
    defaultValues: { branchId: '', firstName: '', lastName: '', status: 'ACTIVE' },
    resolver: zodResolver(studentInputSchema),
  });
  const wasOpen = useRef(false);
  const defaultBranchId = branches[0]?.id ?? '';
  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      reset(
        student
          ? {
              birthDate: student.birthDate,
              branchId: student.branchId,
              email: student.email,
              firstName: student.firstName,
              gender: student.gender,
              lastName: student.lastName,
              middleName: student.middleName,
              notes: student.notes,
              phone: student.phone,
              status: student.status,
            }
          : {
              branchId: defaultBranchId,
              firstName: '',
              lastName: '',
              status: 'ACTIVE',
              ...initialValues,
            },
      );
    }
    wasOpen.current = open;
  }, [defaultBranchId, initialValues, open, reset, student]);

  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('student.dialogDescription')}
      onClose={onClose}
      open={open}
      title={student ? t('student.editTitle') : t('student.createTitle')}
      wide
    >
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-3 gap-4">
          <Field error={errors.lastName?.message} label={t('student.lastName')}>
            <Input aria-label={t('student.lastName')} {...register('lastName')} />
          </Field>
          <Field error={errors.firstName?.message} label={t('student.firstName')}>
            <Input aria-label={t('student.firstName')} {...register('firstName')} />
          </Field>
          <Field error={errors.middleName?.message} label={t('student.middleName')}>
            <Input aria-label={t('student.middleName')} {...register('middleName')} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field error={errors.birthDate?.message} label={t('student.birthDate')}>
            <Input
              aria-label={t('student.birthDate')}
              type="date"
              {...register('birthDate', { setValueAs: (value: string) => value || undefined })}
            />
          </Field>
          <Field error={errors.gender?.message} label={t('student.gender')}>
            <Select
              aria-label={t('student.gender')}
              {...register('gender', { setValueAs: (value: string) => value || undefined })}
            >
              <option value="">{t('common.notSpecified')}</option>
              {GENDERS.map((gender) => (
                <option key={gender} value={gender}>
                  {genderLabels[gender]}
                </option>
              ))}
            </Select>
          </Field>
          <Field error={errors.status?.message} label={t('common.status')}>
            <Select aria-label={t('common.status')} {...register('status')}>
              {STUDENT_STATUSES.filter(
                (status) => status !== 'ARCHIVED' || student?.status === 'ARCHIVED',
              ).map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field error={errors.branchId?.message} label={t('student.branch')}>
            <Select aria-label={t('student.branch')} {...register('branchId')}>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field error={errors.phone?.message} label={t('student.phone')}>
            <Input
              aria-label={t('student.phone')}
              placeholder="+7 999 123-45-67"
              {...register('phone')}
            />
          </Field>
          <Field error={errors.email?.message} label={t('student.email')}>
            <Input aria-label={t('student.email')} type="email" {...register('email')} />
          </Field>
        </div>
        <Field error={errors.notes?.message} label={t('student.notes')}>
          <Textarea aria-label={t('student.notes')} {...register('notes')} />
        </Field>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={isSubmitting || branches.length === 0} type="submit">
            {isSubmitting
              ? t('common.saving')
              : student
                ? t('student.save')
                : t('student.action.add')}
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
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
