import {
  formatDate,
  subscriptionFreezeInputSchema,
  t,
  type SubscriptionFreezeInput,
  type SubscriptionSummary,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Textarea } from '@arava/ui';
import { useEffect, useState } from 'react';

export function FreezeDialog({
  error,
  onClose,
  onSubmit,
  open,
  subscription,
}: {
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (input: SubscriptionFreezeInput) => Promise<void>;
  open: boolean;
  subscription?: SubscriptionSummary | undefined;
}) {
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [validation, setValidation] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (open) {
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60_000;
      const value = new Date(now.getTime() - offset).toISOString().slice(0, 10);
      setStartsAt(value);
      setEndsAt(value);
      setReason('');
      setValidation(undefined);
    }
  }, [open]);
  const submit = async () => {
    const result = subscriptionFreezeInputSchema.safeParse({ endsAt, reason, startsAt });
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
          <Label htmlFor="freeze-start">Начало заморозки</Label>
          <Input
            id="freeze-start"
            onChange={(event) => setStartsAt(event.target.value)}
            type="date"
            value={startsAt}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="freeze-end">Последний день заморозки</Label>
          <Input
            id="freeze-end"
            min={startsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            type="date"
            value={endsAt}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="freeze-reason">Причина / комментарий</Label>
          <Textarea
            id="freeze-reason"
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </div>
        {subscription?.expiresAt && startsAt && endsAt && endsAt >= startsAt ? (
          <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
            Ожидаемая новая дата окончания:{' '}
            <strong className="text-foreground">
              {formatDate(
                new Date(
                  new Date(subscription.expiresAt).getTime() +
                    (Math.round(
                      (new Date(`${endsAt}T00:00:00`).getTime() -
                        new Date(`${startsAt}T00:00:00`).getTime()) /
                        86_400_000,
                    ) +
                      1) *
                      86_400_000,
                ).toISOString(),
              )}
            </strong>
          </p>
        ) : null}
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
