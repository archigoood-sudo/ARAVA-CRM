import {
  subscriptionUpdateInputSchema,
  type SubscriptionDetail,
  type SubscriptionUpdateInput,
  type TariffSummary,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Select, Textarea } from '@arava/ui';
import { useEffect, useState } from 'react';

function inputDate(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function SubscriptionEditDialog({
  error,
  onClose,
  onSubmit,
  open,
  subscription,
  tariffs,
}: {
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (input: SubscriptionUpdateInput) => Promise<void>;
  open: boolean;
  subscription?: SubscriptionDetail | undefined;
  tariffs: TariffSummary[];
}) {
  const [tariffId, setTariffId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!open || !subscription) return;
    setTariffId(subscription.tariffId);
    setStartsAt(inputDate(subscription.startsAt));
    setExpiresAt(inputDate(subscription.expiresAt));
    setNotes(subscription.notes ?? '');
    setValidationError(undefined);
  }, [open, subscription]);
  const submit = async () => {
    const result = subscriptionUpdateInputSchema.safeParse({
      expiresAt: expiresAt || undefined,
      notes,
      startsAt,
      tariffId,
    });
    if (!result.success) {
      setValidationError(result.error.issues[0]?.message ?? 'Проверьте заполнение формы.');
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
      closeLabel="Закрыть"
      description="Изменение периода может пересчитать ранее учтённые посещения."
      onClose={onClose}
      open={open}
      title="Изменить абонемент"
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="edit-subscription-tariff">Тариф</Label>
          <Select
            id="edit-subscription-tariff"
            onChange={(event) => setTariffId(event.target.value)}
            value={tariffId}
          >
            {tariffs.map((tariff) => (
              <option key={tariff.id} value={tariff.id}>
                {tariff.name}
              </option>
            ))}
          </Select>
          {subscription?.payments.length ? (
            <p className="text-xs text-muted-foreground">
              После оплаты смена тарифа недоступна; даты и примечание можно исправить.
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="edit-subscription-start">Действует с</Label>
            <Input
              id="edit-subscription-start"
              onChange={(event) => setStartsAt(event.target.value)}
              type="date"
              value={startsAt}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-subscription-end">Действует до</Label>
            <Input
              id="edit-subscription-end"
              onChange={(event) => setExpiresAt(event.target.value)}
              type="date"
              value={expiresAt}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-subscription-notes">Примечание</Label>
          <Textarea
            id="edit-subscription-notes"
            onChange={(event) => setNotes(event.target.value)}
            value={notes}
          />
        </div>
        {validationError || error ? (
          <p className="text-sm text-destructive">{validationError ?? error}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Отмена
          </Button>
          <Button disabled={submitting} onClick={() => void submit()}>
            Сохранить
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
