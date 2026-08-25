import {
  PAYMENT_METHODS,
  subscriptionCreateInputSchema,
  t,
  type PaymentMethod,
  type StudentSummary,
  type SubscriptionCreateInput,
  type TariffSummary,
} from '@arava/shared';
import { Button, Checkbox, Dialog, Input, Label, Select, Textarea, formatMoney } from '@arava/ui';
import { useEffect, useMemo, useState } from 'react';

function today(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function SubscriptionDialog({
  error,
  onClose,
  onSubmit,
  open,
  student,
  tariffs,
}: {
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (input: SubscriptionCreateInput) => Promise<void>;
  open: boolean;
  student: StudentSummary;
  tariffs: TariffSummary[];
}) {
  const [tariffId, setTariffId] = useState('');
  const [startsAt, setStartsAt] = useState(today());
  const [salePrice, setSalePrice] = useState('0');
  const [notes, setNotes] = useState('');
  const [withPayment, setWithPayment] = useState(true);
  const [paymentAmount, setPaymentAmount] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [validationError, setValidationError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const selected = useMemo(
    () => tariffs.find((tariff) => tariff.id === tariffId),
    [tariffId, tariffs],
  );
  const calculatedExpiry = useMemo(() => {
    if (!selected?.validityDays || !startsAt) return undefined;
    const [year, month, day] = startsAt.split('-').map(Number);
    const value = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
    value.setDate(value.getDate() + selected.validityDays);
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(value);
  }, [selected?.validityDays, startsAt]);

  useEffect(() => {
    if (!open) return;
    const first = tariffs[0];
    setTariffId(first?.id ?? '');
    setStartsAt(today());
    setSalePrice(first ? String(first.price / 100) : '0');
    setPaymentAmount(first ? String(first.price / 100) : '0');
    setPaymentMethod('CASH');
    setNotes('');
    setWithPayment(true);
    setValidationError(undefined);
  }, [open, tariffs]);
  const chooseTariff = (id: string) => {
    setTariffId(id);
    const tariff = tariffs.find((item) => item.id === id);
    if (tariff) {
      setSalePrice(String(tariff.price / 100));
      setPaymentAmount(String(tariff.price / 100));
    }
  };
  const submit = async () => {
    const input: SubscriptionCreateInput = {
      initialPayment: withPayment
        ? {
            amount: Math.round(Number(paymentAmount) * 100),
            paidAt: new Date().toISOString(),
            paymentMethod,
          }
        : undefined,
      notes,
      salePrice: Math.round(Number(salePrice) * 100),
      startsAt,
      studentId: student.id,
      tariffId,
    };
    const result = subscriptionCreateInputSchema.safeParse(input);
    if (!result.success) {
      setValidationError(result.error.issues[0]?.message ?? t('validation.form'));
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
      description={t('subscription.createDescription')}
      onClose={onClose}
      open={open}
      title={t('subscription.createTitle')}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="subscription-tariff">{t('subscription.tariff')}</Label>
          <Select
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
              onChange={(event) => setStartsAt(event.target.value)}
              type="date"
              value={startsAt}
            />
            {calculatedExpiry ? (
              <p className="text-xs text-muted-foreground">Действует до: {calculatedExpiry}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="subscription-price">{t('subscription.salePrice')}</Label>
            <Input
              id="subscription-price"
              min="0"
              onChange={(event) => setSalePrice(event.target.value)}
              step="0.01"
              type="number"
              value={salePrice}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="subscription-notes">{t('subscription.notes')}</Label>
          <Textarea
            id="subscription-notes"
            onChange={(event) => setNotes(event.target.value)}
            value={notes}
          />
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-border p-4 text-sm font-medium">
          <Checkbox
            checked={withPayment}
            onChange={(event) => setWithPayment(event.target.checked)}
          />
          {t('subscription.initialPayment')}
        </label>
        {withPayment ? (
          <div className="grid grid-cols-2 gap-4 rounded-2xl bg-muted/40 p-4">
            <div className="space-y-2">
              <Label htmlFor="subscription-payment">{t('payment.amount')}</Label>
              <Input
                id="subscription-payment"
                min="0.01"
                onChange={(event) => setPaymentAmount(event.target.value)}
                step="0.01"
                type="number"
                value={paymentAmount}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-method">{t('payment.method')}</Label>
              <Select
                id="subscription-method"
                onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
                value={paymentMethod}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {t(`payment.method.${method}`)}
                  </option>
                ))}
              </Select>
            </div>
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
            {submitting ? t('common.saving') : t('subscription.issue')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
