import {
  MANUAL_PAYMENT_METHODS,
  paymentInputSchema,
  t,
  type AqsiGatewayPayment,
  type BranchSummary,
  type PaymentInput,
  type StudentSummary,
  type SubscriptionSummary,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Select, Textarea } from '@arava/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken } from '../../stores/auth-store';

function localDateTimeValue(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

const aqsiStatusText: Record<AqsiGatewayPayment['status'], string> = {
  CANCELLED: 'Оплата отменена',
  CREATED: 'Создаём оплату…',
  EXPIRED: 'Время оплаты истекло',
  FAILED: 'Ошибка оплаты',
  PROCESSING: 'Платёж обрабатывается',
  SUCCEEDED: 'Оплачено',
  WAITING: 'Ожидаем оплату',
};

function formatRubles(kopecks: number): string {
  return new Intl.NumberFormat('ru-RU', { currency: 'RUB', style: 'currency' }).format(
    kopecks / 100,
  );
}

export function PaymentDialog({
  branches,
  error,
  fixedStudent,
  onClose,
  onSbpCompleted,
  onSubmit,
  open,
  students,
  subscriptions = [],
}: {
  branches: BranchSummary[];
  error?: string | undefined;
  fixedStudent?: StudentSummary | undefined;
  onClose: () => void;
  onSbpCompleted?: (() => Promise<void> | void) | undefined;
  onSubmit: (input: PaymentInput) => Promise<void>;
  open: boolean;
  students: StudentSummary[];
  subscriptions?: SubscriptionSummary[] | undefined;
}) {
  const {
    formState: { isSubmitting },
    handleSubmit,
    register,
    reset,
    watch,
  } = useForm<PaymentInput>({
    defaultValues: {
      amount: 0,
      branchId: '',
      paidAt: new Date().toISOString(),
      paymentMethod: 'CASH',
      studentId: '',
    },
  });
  const [validationError, setValidationError] = useState<string>();
  const [mode, setMode] = useState<'CARD' | 'MANUAL' | 'SBP'>('MANUAL');
  const [sbpAvailable, setSbpAvailable] = useState(false);
  const [sbpDeviceName, setSbpDeviceName] = useState<string>();
  const [sbpPayment, setSbpPayment] = useState<AqsiGatewayPayment>();
  const [sbpBusy, setSbpBusy] = useState(false);
  const [sbpError, setSbpError] = useState<string>();
  const attemptKey = useRef(crypto.randomUUID());
  const values = watch();
  const aqsiModeLocked = Boolean(
    sbpPayment && !['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(sbpPayment.status),
  );
  useLayoutEffect(() => {
    if (!open) return;
    reset({
      amount: 0,
      branchId: fixedStudent?.branchId ?? branches[0]?.id ?? '',
      paidAt: localDateTimeValue(),
      paymentMethod: 'CASH',
      studentId: fixedStudent?.id ?? '',
    });
    setMode('MANUAL');
    setSbpPayment(undefined);
    setSbpDeviceName(undefined);
    setSbpError(undefined);
    attemptKey.current = crypto.randomUUID();
    void getDesktopApi()
      .paymentOperations.sbpHealth(getSessionToken())
      .then((health) => {
        setSbpAvailable(health.configured && health.deviceConfigured && health.apiReachable);
        setSbpDeviceName(
          health.selectedDeviceName ??
            (health.selectedDeviceId
              ? `Касса aQsi #${String(health.selectedDeviceId)}`
              : undefined),
        );
      })
      .catch(() => setSbpAvailable(false));
  }, [branches, fixedStudent, open, reset]);

  useEffect(() => {
    if (
      !open ||
      !sbpPayment ||
      ['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(sbpPayment.status)
    )
      return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getDesktopApi()
        .paymentOperations.refreshAqsi(getSessionToken(), sbpPayment.aravaOperationId)
        .then(async (payment) => {
          if (cancelled) return;
          setSbpPayment(payment);
          if (payment.status === 'SUCCEEDED') await onSbpCompleted?.();
        })
        .catch((caught: unknown) => {
          if (!cancelled)
            setSbpError(getErrorMessage(caught, 'Не удалось проверить статус оплаты.'));
        });
    }, 3_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSbpCompleted, open, sbpPayment]);

  const startAqsi = async () => {
    const amount = Math.round(values.amount * 100);
    const purpose = values.comment?.trim();
    if (!values.studentId || !values.branchId || !Number.isSafeInteger(amount) || amount < 1_000) {
      setSbpError('Выберите ученика и укажите сумму не менее 10 ₽.');
      return;
    }
    setSbpBusy(true);
    setSbpError(undefined);
    try {
      const operation = await getDesktopApi().paymentOperations.create(getSessionToken(), {
        amount,
        branchId: values.branchId,
        currency: 'RUB',
        idempotencyKey: attemptKey.current,
        providerType: mode === 'CARD' ? 'ACQUIRING' : 'SBP',
        purpose:
          purpose && purpose.length > 0
            ? purpose
            : mode === 'CARD'
              ? 'Оплата картой через aQsi'
              : 'Оплата через СБП',
        studentId: values.studentId,
        ...(values.subscriptionId ? { subscriptionId: values.subscriptionId } : {}),
      });
      const gateway = await getDesktopApi().paymentOperations.startAqsi(
        getSessionToken(),
        operation.id,
      );
      setSbpPayment(gateway);
      if (gateway.status === 'SUCCEEDED') await onSbpCompleted?.();
    } catch (caught) {
      setSbpError(
        getErrorMessage(
          caught,
          mode === 'CARD'
            ? 'Не удалось начать оплату картой.'
            : 'Не удалось создать оплату через СБП.',
        ),
      );
    } finally {
      setSbpBusy(false);
    }
  };

  const refreshSbp = async () => {
    if (!sbpPayment) return;
    setSbpBusy(true);
    setSbpError(undefined);
    try {
      const payment = await getDesktopApi().paymentOperations.refreshAqsi(
        getSessionToken(),
        sbpPayment.aravaOperationId,
      );
      setSbpPayment(payment);
      if (payment.status === 'SUCCEEDED') await onSbpCompleted?.();
    } catch (caught) {
      setSbpError(getErrorMessage(caught, 'Не удалось проверить статус оплаты.'));
    } finally {
      setSbpBusy(false);
    }
  };

  const cancelSbp = async () => {
    if (!sbpPayment) return;
    setSbpBusy(true);
    setSbpError(undefined);
    try {
      setSbpPayment(
        await getDesktopApi().paymentOperations.cancelAqsi(
          getSessionToken(),
          sbpPayment.aravaOperationId,
        ),
      );
    } catch (caught) {
      setSbpError(getErrorMessage(caught, 'Не удалось отменить ожидание оплаты.'));
    } finally {
      setSbpBusy(false);
    }
  };

  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('payment.createDescription')}
      onClose={onClose}
      open={open}
      title={t('payment.createTitle')}
    >
      <div className="mb-5 grid grid-cols-3 rounded-2xl bg-muted p-1">
        <Button
          disabled={aqsiModeLocked}
          onClick={() => setMode('MANUAL')}
          variant={mode === 'MANUAL' ? 'primary' : 'ghost'}
        >
          Вручную
        </Button>
        <Button
          disabled={!sbpAvailable || aqsiModeLocked}
          onClick={() => setMode('CARD')}
          variant={mode === 'CARD' ? 'primary' : 'ghost'}
        >
          Оплата картой
        </Button>
        <Button
          disabled={!sbpAvailable || aqsiModeLocked}
          onClick={() => setMode('SBP')}
          variant={mode === 'SBP' ? 'primary' : 'ghost'}
        >
          Оплата по СБП
        </Button>
      </div>
      <form
        className="space-y-4"
        onSubmit={handleSubmit(async (values) => {
          const result = paymentInputSchema.safeParse({
            ...values,
            amount: Math.round(values.amount * 100),
            paidAt: new Date(values.paidAt).toISOString(),
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
          <Label htmlFor="payment-student">{t('payment.student')}</Label>
          {fixedStudent ? (
            <>
              <Select disabled id="payment-student" value={fixedStudent.id}>
                <option value={fixedStudent.id}>
                  {fixedStudent.lastName} {fixedStudent.firstName}
                </option>
              </Select>
              <input type="hidden" {...register('studentId')} />
            </>
          ) : (
            <Select id="payment-student" {...register('studentId')}>
              <option value="">{t('common.notSpecified')}</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.lastName} {student.firstName}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className={mode === 'MANUAL' ? 'grid grid-cols-2 gap-4' : 'space-y-2'}>
          <div className="space-y-2">
            <Label htmlFor="payment-branch">{t('student.branch')}</Label>
            {fixedStudent ? (
              <>
                <Select disabled id="payment-branch" value={fixedStudent.branchId}>
                  <option value={fixedStudent.branchId}>{fixedStudent.branchName}</option>
                </Select>
                <input type="hidden" {...register('branchId')} />
              </>
            ) : (
              <Select id="payment-branch" {...register('branchId')}>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-subscription">{t('payment.subscription')}</Label>
            <Select id="payment-subscription" {...register('subscriptionId')}>
              <option value="">{t('payment.subscription.none')}</option>
              {subscriptions
                .filter(({ debt }) => debt > 0)
                .map((subscription) => (
                  <option key={subscription.id} value={subscription.id}>
                    {subscription.tariffName}
                  </option>
                ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="payment-amount">{t('payment.amount')}</Label>
            <Input
              id="payment-amount"
              min="0.01"
              step="0.01"
              type="number"
              {...register('amount', { valueAsNumber: true })}
            />
          </div>
          {mode === 'MANUAL' ? (
            <div className="space-y-2">
              <Label htmlFor="payment-method">{t('payment.method')}</Label>
              <Select id="payment-method" {...register('paymentMethod')}>
                {MANUAL_PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {t(`payment.method.${method}`)}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
        {mode === 'MANUAL' ? (
          <div className="space-y-2">
            <Label htmlFor="payment-date">{t('payment.date')}</Label>
            <Input id="payment-date" type="datetime-local" {...register('paidAt')} />
          </div>
        ) : null}
        {mode === 'MANUAL' ? (
          <div className="space-y-2">
            <Label htmlFor="payment-reference">{t('payment.externalReference')}</Label>
            <Input id="payment-reference" {...register('externalReference')} />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="payment-comment">{t('payment.comment')}</Label>
          <Textarea id="payment-comment" {...register('comment')} />
        </div>
        {mode !== 'MANUAL' ? (
          <div className="rounded-2xl border border-border bg-muted/30 p-5 text-center">
            {sbpPayment &&
            !['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(sbpPayment.status) ? (
              <>
                <p className="font-semibold">
                  {mode === 'CARD'
                    ? 'Ожидаем оплату картой на кассе aQsi'
                    : 'Ожидаем оплату по СБП на кассе aQsi'}
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {formatRubles(sbpPayment.amountKopecks)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sbpDeviceName ?? `Касса aQsi #${String(sbpPayment.deviceId ?? '')}`}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {values.comment?.trim()
                    ? values.comment.trim()
                    : mode === 'CARD'
                      ? 'Оплата картой через aQsi'
                      : 'Оплата через СБП'}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {aqsiStatusText[sbpPayment.status]}
                </p>
              </>
            ) : sbpPayment?.status === 'SUCCEEDED' ? (
              <p className="font-semibold text-green-700">Оплата подтверждена</p>
            ) : sbpPayment && ['FAILED', 'CANCELLED', 'EXPIRED'].includes(sbpPayment.status) ? (
              <>
                <p className="font-semibold text-red-700">Оплата не завершена</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sbpPayment.error?.message ??
                    'Создайте новую попытку и попросите клиента повторить оплату.'}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">
                  {mode === 'CARD' ? 'Оплата картой через aQsi' : 'Оплата по СБП через aQsi'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mode === 'CARD'
                    ? 'Попросите клиента приложить или вставить карту в выбранную кассу.'
                    : 'QR-код появится на выбранной физической кассе aQsi.'}
                </p>
                {sbpDeviceName ? <p className="mt-2 text-sm font-medium">{sbpDeviceName}</p> : null}
              </>
            )}
          </div>
        ) : null}
        {!sbpAvailable && mode === 'MANUAL' ? (
          <p className="text-xs text-muted-foreground">
            СБП станет доступна после настройки API и кассы aQsi на сервере.
          </p>
        ) : null}
        {validationError || error || sbpError ? (
          <p className="text-sm text-red-600">{validationError ?? error ?? sbpError}</p>
        ) : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          {mode === 'MANUAL' ? (
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? t('common.saving') : t('payment.save')}
            </Button>
          ) : sbpPayment?.status === 'SUCCEEDED' ? (
            <Button onClick={onClose} type="button">
              Готово
            </Button>
          ) : sbpPayment && ['FAILED', 'CANCELLED', 'EXPIRED'].includes(sbpPayment.status) ? (
            <Button
              onClick={() => {
                setSbpPayment(undefined);
                attemptKey.current = crypto.randomUUID();
              }}
              type="button"
            >
              Создать новую попытку
            </Button>
          ) : (
            <div className="flex gap-2">
              {sbpPayment ? (
                <Button
                  disabled={sbpBusy}
                  onClick={() => void refreshSbp()}
                  type="button"
                  variant="outline"
                >
                  Проверить оплату
                </Button>
              ) : null}
              {sbpPayment ? (
                <Button
                  disabled={sbpBusy}
                  onClick={() => void cancelSbp()}
                  type="button"
                  variant="ghost"
                >
                  Отменить ожидание
                </Button>
              ) : (
                <Button disabled={sbpBusy} onClick={() => void startAqsi()} type="button">
                  {sbpBusy
                    ? 'Передаём на кассу…'
                    : mode === 'CARD'
                      ? 'Начать оплату картой'
                      : 'Начать оплату по СБП'}
                </Button>
              )}
            </div>
          )}
        </div>
      </form>
    </Dialog>
  );
}
