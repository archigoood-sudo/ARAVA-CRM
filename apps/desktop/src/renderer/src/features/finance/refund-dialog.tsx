import { refundInputSchema, t, type RefundInput } from '@arava/shared';
import { Button, Dialog, Input, Label, Textarea } from '@arava/ui';
import { useLayoutEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

export function RefundDialog({
  error,
  onClose,
  onSubmit,
  open,
}: {
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (input: RefundInput) => Promise<void>;
  open: boolean;
}) {
  const {
    formState: { isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<RefundInput>({
    defaultValues: { amount: 0, reason: '', refundedAt: new Date().toISOString() },
  });
  const [validationError, setValidationError] = useState<string>();
  useLayoutEffect(() => {
    if (open) reset({ amount: 0, reason: '', refundedAt: new Date().toISOString().slice(0, 16) });
  }, [open, reset]);
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('refund.confirm')}
      onClose={onClose}
      open={open}
      title={t('refund.title')}
    >
      <form
        className="space-y-4"
        onSubmit={handleSubmit(async (values) => {
          const result = refundInputSchema.safeParse({
            ...values,
            amount: Math.round(values.amount * 100),
            refundedAt: new Date(values.refundedAt).toISOString(),
          });
          if (!result.success) {
            setValidationError(result.error.issues[0]?.message ?? t('validation.form'));
            return;
          }
          setValidationError(undefined);
          await onSubmit(result.data);
        })}
      >
        <div className="space-y-2">
          <Label htmlFor="refund-amount">{t('refund.amount')}</Label>
          <Input
            id="refund-amount"
            min="0.01"
            step="0.01"
            type="number"
            {...register('amount', { valueAsNumber: true })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="refund-date">{t('refund.date')}</Label>
          <Input id="refund-date" type="datetime-local" {...register('refundedAt')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="refund-reason">{t('refund.reason')}</Label>
          <Textarea id="refund-reason" {...register('reason')} />
        </div>
        {validationError || error ? (
          <p className="text-sm text-red-600">{validationError ?? error}</p>
        ) : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? t('common.saving') : t('refund.action')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
