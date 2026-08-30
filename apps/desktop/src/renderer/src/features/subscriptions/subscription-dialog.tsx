import {
  t,
  type StudentSummary,
  type SubscriptionCreateInput,
  type TariffSummary,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Select, Textarea, formatMoney } from '@arava/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

function today(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export interface SubscriptionSalePaymentPlan {
  amount: number;
  mode: 'FULL';
}

function calculatedExpiryDate(startsAt: string, validityDays?: number): string {
  if (!validityDays || !startsAt) return '';
  const [year, month, day] = startsAt.split('-').map(Number);
  const value = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  value.setDate(value.getDate() + validityDays);
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

export function SubscriptionDialog({
  activeSubscriptionCount = 0,
  error,
  onClose,
  onSubmit,
  open,
  student,
  tariffs,
}: {
  error?: string | undefined;
  onClose: () => void;
  activeSubscriptionCount?: number | undefined;
  onSubmit: (
    input: SubscriptionCreateInput,
    payment: SubscriptionSalePaymentPlan,
  ) => Promise<void> | void;
  open: boolean;
  student: StudentSummary;
  tariffs: TariffSummary[];
}) {
  const [tariffId, setTariffId] = useState('');
  const [startsAt, setStartsAt] = useState(today());
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const saleKey = useRef(crypto.randomUUID());
  const selected = useMemo(
    () => tariffs.find((tariff) => tariff.id === tariffId),
    [tariffId, tariffs],
  );

  useEffect(() => {
    if (!open) return;
    const first = tariffs[0];
    setTariffId(first?.id ?? '');
    setStartsAt(today());
    setExpiresAt(calculatedExpiryDate(today(), first?.validityDays));
    setNotes('');
    setValidationError(undefined);
    saleKey.current = crypto.randomUUID();
  }, [open, tariffs]);
  const chooseTariff = (id: string) => {
    setTariffId(id);
    const tariff = tariffs.find((item) => item.id === id);
    if (tariff) {
      setExpiresAt(calculatedExpiryDate(startsAt, tariff.validityDays));
    }
  };
  const submit = async () => {
    const input: SubscriptionCreateInput = {
      expiresAt: expiresAt || undefined,
      idempotencyKey: saleKey.current,
      notes,
      salePrice: selected?.price ?? 0,
      startsAt,
      studentId: student.id,
      tariffId,
    };
    if (!selected || selected.price <= 0 || !tariffId || !startsAt) {
      setValidationError('Выберите платный тариф для продажи абонемента.');
      return;
    }
    if (expiresAt && expiresAt < startsAt) {
      setValidationError('Дата окончания не может быть раньше даты начала.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(input, { amount: selected.price, mode: 'FULL' });
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('subscription.createDescription')}
      onClose={onClose}
      open={open}
      title={t('subscription.createTitle')}
    >
      <div className="space-y-4">
        {activeSubscriptionCount > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            У ученика уже есть действующий абонемент. Новый абонемент будет сохранён отдельно.
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="subscription-tariff">{t('subscription.tariff')}</Label>
          <Select
            disabled={tariffs.length === 0}
            id="subscription-tariff"
            onChange={(event) => chooseTariff(event.target.value)}
            value={tariffId}
          >
            <option value="">{t('common.notSpecified')}</option>
            {tariffs.map((tariff) => (
              <option key={tariff.id} value={tariff.id}>
                {tariff.name} · {formatMoney(tariff.price)}
              </option>
            ))}
          </Select>
        </div>
        {selected ? (
          <div className="rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            <p className="font-semibold">{t(`tariff.type.${selected.type}`)}</p>
            <p className="mt-1 text-muted-foreground">
              {selected.branchName ?? t('tariff.branch.global')} ·{' '}
              {selected.validityDays
                ? t('tariff.validityValue', { days: selected.validityDays })
                : t('common.notSpecified')}
            </p>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="subscription-start">{t('subscription.startsAt')}</Label>
            <Input
              id="subscription-start"
              onChange={(event) => {
                setStartsAt(event.target.value);
                setExpiresAt(calculatedExpiryDate(event.target.value, selected?.validityDays));
              }}
              type="date"
              value={startsAt}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subscription-expiry">{t('subscription.expiresAt')}</Label>
            <Input
              id="subscription-expiry"
              min={startsAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              type="date"
              value={expiresAt}
            />
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">Стоимость абонемента</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(selected?.price ?? 0)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Стоимость фиксируется на момент продажи и не меняется вместе с тарифом.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="subscription-notes">{t('subscription.notes')}</Label>
          <Textarea
            id="subscription-notes"
            onChange={(event) => setNotes(event.target.value)}
            value={notes}
          />
        </div>
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          Абонемент будет выдан только после полной оплаты. Способ оплаты — наличные, карта или СБП
          — выбирается на следующем шаге.
        </div>
        {validationError || error ? (
          <p className="text-sm text-red-600">{validationError ?? error}</p>
        ) : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={submitting} onClick={() => void submit()}>
            {submitting ? t('common.saving') : 'Продолжить к оплате'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
