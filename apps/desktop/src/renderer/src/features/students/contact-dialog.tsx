import { zodResolver } from '@hookform/resolvers/zod';
import {
  studentContactInputSchema,
  t,
  type StudentContactInput,
  type StudentContactSummary,
} from '@arava/shared';
import { Button, Checkbox, Dialog, Input, Label, Textarea } from '@arava/ui';
import { useLayoutEffect, useRef } from 'react';
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
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
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
    }
    wasOpen.current = open;
  }, [contact, open, reset]);
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('contact.dialogDescription')}
      onClose={onClose}
      open={open}
      title={contact ? t('contact.editTitle') : t('contact.createTitle')}
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-4">
          <Field error={errors.fullName?.message} label={t('contact.fullName')}>
            <Input aria-label={t('contact.fullNameAria')} {...register('fullName')} />
          </Field>
          <Field error={errors.relationship?.message} label={t('contact.relationship')}>
            <Input
              aria-label={t('contact.relationship')}
              placeholder={t('contact.relationshipPlaceholder')}
              {...register('relationship')}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field error={errors.phone?.message} label={t('contact.phone')}>
            <Input
              aria-label={t('contact.phoneAria')}
              placeholder="+7 999 123-45-67"
              {...register('phone')}
            />
          </Field>
          <Field error={errors.secondaryPhone?.message} label={t('contact.secondaryPhone')}>
            <Input aria-label={t('contact.secondaryPhone')} {...register('secondaryPhone')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field error={errors.email?.message} label={t('contact.email')}>
            <Input aria-label={t('contact.email')} type="email" {...register('email')} />
          </Field>
          <Field error={errors.telegram?.message} label="Telegram">
            <Input aria-label="Telegram" placeholder="@имя" {...register('telegram')} />
          </Field>
        </div>
        <div className="flex gap-6 rounded-2xl bg-background p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox {...register('isPrimary')} />
            {t('contact.isPrimary')}
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox {...register('whatsapp')} />
            {t('contact.whatsapp')}
          </label>
        </div>
        <Field error={errors.notes?.message} label={t('contact.notes')}>
          <Textarea aria-label={t('contact.notesAria')} {...register('notes')} />
        </Field>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? t('common.saving') : contact ? t('contact.save') : t('contact.add')}
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
