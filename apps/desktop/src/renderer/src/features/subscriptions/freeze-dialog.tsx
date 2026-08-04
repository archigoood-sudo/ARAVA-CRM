import { subscriptionFreezeInputSchema, t, type SubscriptionFreezeInput } from '@arava/shared';
import { Button, Dialog, Input, Label } from '@arava/ui';
import { useEffect, useState } from 'react';

export function FreezeDialog({
  error,
  onClose,
  onSubmit,
  open,
}: {
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (input: SubscriptionFreezeInput) => Promise<void>;
  open: boolean;
}) {
  const [days, setDays] = useState(1);
  const [validation, setValidation] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (open) {
      setDays(1);
      setValidation(undefined);
    }
  }, [open]);
  const submit = async () => {
    const result = subscriptionFreezeInputSchema.safeParse({ days });
    if (!result.success) {
      setValidation(result.error.issues[0]?.message);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(result.data);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('subscription.freezeConfirm')}
      onClose={onClose}
      open={open}
      title={t('subscription.freezeTitle')}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="freeze-days">{t('subscription.freezeDays')}</Label>
          <Input
            id="freeze-days"
            min="1"
            onChange={(event) => setDays(Number(event.target.value))}
            type="number"
            value={days}
          />
        </div>
        {validation || error ? <p className="text-sm text-red-600">{validation ?? error}</p> : null}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={submitting} onClick={() => void submit()}>
            {submitting ? t('common.saving') : t('subscription.action.freeze')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
