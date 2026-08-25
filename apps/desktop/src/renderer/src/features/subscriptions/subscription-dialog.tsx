import {
  subscriptionCreateInputSchema,
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
  mode: 'FULL' | 'NONE' | 'PARTIAL';
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
  onSubmit: (input: SubscriptionCreateInput, payment: SubscriptionSalePaymentPlan) => Promise<void>;
  open: boolean;
  student: StudentSummary;
  tariffs: TariffSummary[];
}) {
  const [tariffId, setTariffId] = useState('');
  const [startsAt, setStartsAt] = useState(today());
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMode, setPaymentMode] = useState<SubscriptionSalePaymentPlan['mode']>('FULL');
  const [paymentAmount, setPaymentAmount] = useState('0');
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
    setPaymentAmount(first ? String(first.price / 100) : '0');
    setNotes('');
    setPaymentMode(first?.price === 0 ? 'NONE' : 'FULL');
    setValidationError(undefined);
    saleKey.current = crypto.randomUUID();
  }, [open, tariffs]);
  const chooseTariff = (id: string) => {
    setTariffId(id);
    const tariff = tariffs.find((item) => item.id === id);
    if (tariff) {
      setExpiresAt(calculatedExpiryDate(startsAt, tariff.validityDays));
      setPaymentAmount(String(tariff.price / 100));
      if (tariff.price === 0) setPaymentMode('NONE');
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
    const result = subscriptionCreateInputSchema.safeParse(input);
    if (!result.success) {
      setValidationError(result.error.issues[0]?.message ?? t('validation.form'));
      return;
    }
    const effectivePaymentMode = selected?.price === 0 ? 'NONE' : paymentMode;
    const amount = effectivePaymentMode === 'NONE' ? 0 : Math.round(Number(paymentAmount) * 100);
    if (
      (effectivePaymentMode === 'FULL' && amount !== (selected?.price ?? 0)) ||
      (effectivePaymentMode === 'PARTIAL' && (amount <= 0 || amount >= (selected?.price ?? 0)))
    ) {
      setValidationError(
        effectivePaymentMode === 'PARTIAL'
          ? 'Частичный платёж должен быть больше нуля и меньше стоимости абонемента.'
          : 'Полная оплата должна совпадать со стоимостью абонемента.',
      );
      return;
    }
    if (
      effectivePaymentMode === 'NONE' &&
      (selected?.price ?? 0) > 0 &&
      !window.confirm(
        `Абонемент будет выдан с задолженностью ${new Intl.NumberFormat('ru-RU', {
          currency: 'RUB',
          style: 'currency',
        }).format((selected?.price ?? 0) / 100)}. Продолжить?`,
      )
    )
      return;
    setSubmitting(true);
    try {
      await onSubmit(result.data, { amount, mode: effectivePaymentMode });
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
            disabled={(selected?.price ?? 0) === 0}
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
        <div className="space-y-2">
          <Label htmlFor="subscription-payment-mode">Оплата при продаже</Label>
          <Select
            id="subscription-payment-mode"
            onChange={(event) => {
              const mode = event.target.value as SubscriptionSalePaymentPlan['mode'];
              setPaymentMode(mode);
              if (mode === 'FULL') setPaymentAmount(String((selected?.price ?? 0) / 100));
            }}
            value={paymentMode}
          >
            <option value="FULL">Полная оплата</option>
            <option value="PARTIAL">Частичная оплата</option>
            <option value="NONE">Выдать без оплаты</option>
          </Select>
        </div>
        {paymentMode !== 'NONE' ? (
          <div className="rounded-2xl bg-muted/40 p-4">
            <div className="space-y-2">
              <Label htmlFor="subscription-payment">{t('payment.amount')}</Label>
              <Input
                id="subscription-payment"
                min="0.01"
                onChange={(event) => setPaymentAmount(event.target.value)}
                readOnly={paymentMode === 'FULL'}
                step="0.01"
                type="number"
                value={paymentAmount}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Способ оплаты — наличные, карта или СБП — выбирается на следующем шаге.
            </p>
          </div>
        ) : null}
        {validationError || error ? (
          <p className="text-sm text-red-600">{validationError ?? error}</p>
        ) : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={submitting} onClick={() => void submit()}>
            {submitting
              ? t('common.saving')
              : paymentMode === 'NONE'
                ? 'Выдать без оплаты'
                : 'Продолжить к оплате'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
