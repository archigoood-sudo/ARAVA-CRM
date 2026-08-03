import { zodResolver } from '@hookform/resolvers/zod';
import {
  GENDERS,
  STUDENT_STATUSES,
  studentInputSchema,
  type BranchSummary,
  type Gender,
  type StudentInput,
  type StudentSummary,
  type StudentStatus,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Select, Textarea } from '@arava/ui';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';

const statusLabels: Record<StudentStatus, string> = {
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
  FROZEN: 'Frozen',
  LEFT: 'Left',
  TRIAL: 'Trial',
};
const genderLabels: Record<Gender, string> = { FEMALE: 'Female', MALE: 'Male', OTHER: 'Other' };

export function StudentDialog({
  branches,
  error,
  onClose,
  onSubmit,
  open,
  student,
}: {
  branches: BranchSummary[];
  error?: string | undefined;
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
  useEffect(() => {
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
          : { branchId: defaultBranchId, firstName: '', lastName: '', status: 'ACTIVE' },
      );
    }
    wasOpen.current = open;
  }, [defaultBranchId, open, reset, student]);

  return (
    <Dialog
      description="Core student details are stored locally in this workspace."
      onClose={onClose}
      open={open}
      title={student ? 'Edit student' : 'Create student'}
      wide
    >
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-3 gap-4">
          <Field error={errors.lastName?.message} label="Last name">
            <Input aria-label="Last name" {...register('lastName')} />
          </Field>
          <Field error={errors.firstName?.message} label="First name">
            <Input aria-label="First name" {...register('firstName')} />
          </Field>
          <Field error={errors.middleName?.message} label="Middle name">
            <Input aria-label="Middle name" {...register('middleName')} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field error={errors.birthDate?.message} label="Birth date">
            <Input
              aria-label="Birth date"
              type="date"
              {...register('birthDate', { setValueAs: (value: string) => value || undefined })}
            />
          </Field>
          <Field error={errors.gender?.message} label="Gender">
            <Select
              aria-label="Gender"
              {...register('gender', { setValueAs: (value: string) => value || undefined })}
            >
              <option value="">Not specified</option>
              {GENDERS.map((gender) => (
                <option key={gender} value={gender}>
                  {genderLabels[gender]}
                </option>
              ))}
            </Select>
          </Field>
          <Field error={errors.status?.message} label="Status">
            <Select aria-label="Status" {...register('status')}>
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
          <Field error={errors.branchId?.message} label="Branch">
            <Select aria-label="Branch" {...register('branchId')}>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field error={errors.phone?.message} label="Phone">
            <Input
              aria-label="Student phone"
              placeholder="+7 999 123-45-67"
              {...register('phone')}
            />
          </Field>
          <Field error={errors.email?.message} label="Email">
            <Input aria-label="Student email" type="email" {...register('email')} />
          </Field>
        </div>
        <Field error={errors.notes?.message} label="Notes">
          <Textarea aria-label="Student notes" {...register('notes')} />
        </Field>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={isSubmitting || branches.length === 0} type="submit">
            {isSubmitting ? 'Saving…' : student ? 'Save student' : 'Create student'}
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
