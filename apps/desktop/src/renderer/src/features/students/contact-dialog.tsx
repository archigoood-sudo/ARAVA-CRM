import { zodResolver } from '@hookform/resolvers/zod';
import {
  studentContactInputSchema,
  type StudentContactInput,
  type StudentContactSummary,
} from '@arava/shared';
import { Button, Checkbox, Dialog, Input, Label, Textarea } from '@arava/ui';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

export function ContactDialog({
  contact,
  error,
  onClose,
  onSubmit,
  open,
}: {
  contact: StudentContactSummary | null;
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (input: StudentContactInput) => Promise<void>;
  open: boolean;
}) {
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<StudentContactInput>({
    defaultValues: { fullName: '', isPrimary: false, phone: '', relationship: '', whatsapp: false },
    resolver: zodResolver(studentContactInputSchema),
  });
  useEffect(() => {
    reset(
      contact
        ? {
            email: contact.email,
            fullName: contact.fullName,
            isPrimary: contact.isPrimary,
            notes: contact.notes,
            phone: contact.phone,
            relationship: contact.relationship,
            secondaryPhone: contact.secondaryPhone,
            telegram: contact.telegram,
            whatsapp: contact.whatsapp,
          }
        : { fullName: '', isPrimary: false, phone: '', relationship: '', whatsapp: false },
    );
  }, [contact, open, reset]);
  return (
    <Dialog
      description="Phone numbers are normalized before they are stored."
      onClose={onClose}
      open={open}
      title={contact ? 'Edit parent or contact' : 'Add parent or contact'}
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-4">
          <Field error={errors.fullName?.message} label="Full name">
            <Input aria-label="Contact full name" {...register('fullName')} />
          </Field>
          <Field error={errors.relationship?.message} label="Relationship">
            <Input
              aria-label="Relationship"
              placeholder="Mother, father, guardian…"
              {...register('relationship')}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field error={errors.phone?.message} label="Phone">
            <Input
              aria-label="Contact phone"
              placeholder="+7 999 123-45-67"
              {...register('phone')}
            />
          </Field>
          <Field error={errors.secondaryPhone?.message} label="Secondary phone">
            <Input aria-label="Secondary phone" {...register('secondaryPhone')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field error={errors.email?.message} label="Email">
            <Input aria-label="Contact email" type="email" {...register('email')} />
          </Field>
          <Field error={errors.telegram?.message} label="Telegram">
            <Input aria-label="Telegram" placeholder="@username" {...register('telegram')} />
          </Field>
        </div>
        <div className="flex gap-6 rounded-2xl bg-background p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox {...register('isPrimary')} />
            Primary contact
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox {...register('whatsapp')} />
            Uses WhatsApp
          </label>
        </div>
        <Field error={errors.notes?.message} label="Notes">
          <Textarea aria-label="Contact notes" {...register('notes')} />
        </Field>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Saving…' : contact ? 'Save contact' : 'Add contact'}
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
