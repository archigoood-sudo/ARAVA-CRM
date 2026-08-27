import {
  formatDate,
  t,
  type BranchSummary,
  type PaymentInput,
  type AqsiGatewayPayment,
  type StudentSummary,
  type StudentFinanceSummary,
  type SubscriptionAdjustmentInput,
  type SubscriptionCreateInput,
  type SubscriptionFreezeInput,
  type SubscriptionStatus,
  type SubscriptionSummary,
  type SubscriptionUpdateInput,
} from '@arava/shared';
import {
  Badge,
  BalanceIndicator,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  ErrorState,
  LedgerList,
  LoadingState,
  Money,
  Select,
  cn,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CreditCard,
  History,
  Pencil,
  Pause,
  Plus,
  RotateCcw,
  WalletCards,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { PaymentDialog } from '../finance/payment-dialog';
import { PaymentOperationDetailsDialog } from '../finance/payment-operation-details-dialog';
import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { AdjustmentDialog } from './adjustment-dialog';
import { FreezeDialog } from './freeze-dialog';
import { SubscriptionDialog, type SubscriptionSalePaymentPlan } from './subscription-dialog';
import { SubscriptionEditDialog } from './subscription-edit-dialog';

const currentStatuses: SubscriptionStatus[] = ['ACTIVE', 'FROZEN'];

export function StudentFinance({
  branches,
  initialFinance,
  onRequestedActionHandled,
  requestedAttendanceLessonId,
  requestedAction,
  requestedPaymentOperationId,
  requestedSubscriptionPaymentId,
  student,
}: {
  branches: BranchSummary[];
  initialFinance?: StudentFinanceSummary | undefined;
  onRequestedActionHandled?: (() => void) | undefined;
  requestedAttendanceLessonId?: string | undefined;
  requestedAction?: 'payment' | 'subscription' | undefined;
  requestedPaymentOperationId?: string | undefined;
  requestedSubscriptionPaymentId?: string | undefined;
  student: StudentSummary;
}) {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role !== 'COACH';
  const canAdjust = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
  const [financeMenuOpen, setFinanceMenuOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [attendancePayment, setAttendancePayment] = useState<{
    amount: number;
    lessonId: string;
    tariffId: string;
    tariffName: string;
  }>();
  const [subscriptionPayment, setSubscriptionPayment] = useState<{
    amount: number;
    fixedAmount?: boolean;
    subscriptionId: string;
    tariffName: string;
  }>();
  const [subscriptionSale, setSubscriptionSale] = useState<{
    amount: number;
    fixedAmount?: boolean;
    input: SubscriptionCreateInput;
    tariffName: string;
  }>();
  const [successMessage, setSuccessMessage] = useState<string>();
  const [focusedAttendanceLessonId, setFocusedAttendanceLessonId] = useState<string>();
  const [attendanceTariffs, setAttendanceTariffs] = useState<Record<string, string>>({});
  const [freezeId, setFreezeId] = useState<string>();
  const [detailId, setDetailId] = useState<string>();
  const [editId, setEditId] = useState<string>();
  const [paymentOperationId, setPaymentOperationId] = useState<string>();
  const [gatewayPayment, setGatewayPayment] = useState<AqsiGatewayPayment>();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (requestedAction === 'payment') {
      setAttendancePayment(undefined);
      setPaymentOpen(true);
    }
    if (requestedAction === 'subscription') setIssueOpen(true);
    if (requestedAction) onRequestedActionHandled?.();
  }, [onRequestedActionHandled, requestedAction]);
  useEffect(() => {
    if (!requestedPaymentOperationId) return;
    setPaymentOperationId(requestedPaymentOperationId);
    onRequestedActionHandled?.();
  }, [onRequestedActionHandled, requestedPaymentOperationId]);
  const finance = useQuery({
    initialData: initialFinance,
    queryFn: () => getDesktopApi().subscriptions.listStudent(getSessionToken(), student.id),
    queryKey: queryKeys.studentFinance(student.id),
    staleTime: initialFinance ? 30_000 : 0,
  });
  useEffect(() => {
    if (!requestedSubscriptionPaymentId || !finance.data) return;
    const subscription = finance.data.subscriptions.find(
      ({ id }) => id === requestedSubscriptionPaymentId,
    );
    if (!subscription || subscription.debt <= 0) {
      onRequestedActionHandled?.();
      return;
    }
    setSubscriptionPayment({
      amount: subscription.debt,
      fixedAmount: false,
      subscriptionId: subscription.id,
      tariffName: subscription.tariffName,
    });
    setAttendancePayment(undefined);
    setPaymentOpen(true);
    const handledTimer = window.setTimeout(() => onRequestedActionHandled?.(), 0);
    return () => window.clearTimeout(handledTimer);
  }, [finance.data, onRequestedActionHandled, requestedSubscriptionPaymentId]);
  const paymentOperations = useQuery({
    enabled: canManage,
    queryFn: () => getDesktopApi().paymentOperations.listStudent(getSessionToken(), student.id),
    queryKey: ['payment-operations', 'student', student.id, user?.id],
  });
  const selectedPaymentOperation = useQuery({
    enabled: Boolean(paymentOperationId),
    queryFn: () =>
      getDesktopApi().paymentOperations.get(getSessionToken(), paymentOperationId ?? ''),
    queryKey: ['payment-operations', 'detail', paymentOperationId, user?.id],
  });
  const historicalPayment = useQuery({
    enabled: Boolean(selectedPaymentOperation.data?.paymentId),
    queryFn: () =>
      getDesktopApi().payments.get(
        getSessionToken(),
        selectedPaymentOperation.data?.paymentId ?? '',
      ),
    queryKey: ['payments', 'detail', selectedPaymentOperation.data?.paymentId, user?.id],
  });
  const tariffs = useQuery({
    queryFn: () => getDesktopApi().tariffs.list(getSessionToken(), { branchId: student.branchId }),
    queryKey: queryKeys.tariffs({ branchId: student.branchId }),
  });
  const detail = useQuery({
    enabled: Boolean(detailId ?? editId),
    queryFn: () => getDesktopApi().subscriptions.get(getSessionToken(), detailId ?? editId ?? ''),
    queryKey: ['subscriptions', 'detail', detailId ?? editId],
  });
  const issue = useMutation({
    mutationFn: (input: SubscriptionCreateInput) =>
      getDesktopApi().subscriptions.create(getSessionToken(), input),
  });
  const sellSubscription = async (
    input: SubscriptionCreateInput,
    paymentPlan: SubscriptionSalePaymentPlan,
  ) => {
    setError(undefined);
    setSuccessMessage(undefined);
    try {
      setIssueOpen(false);
      if (paymentPlan.mode === 'NONE') {
        const created = await issue.mutateAsync(input);
        await refresh();
        setSuccessMessage('Абонемент выдан с задолженностью');
        setDetailId(created.id);
      } else {
        const tariffName =
          tariffs.data?.find(({ id }) => id === input.tariffId)?.name ?? 'Абонемент';
        setSubscriptionSale({
          amount: paymentPlan.amount,
          fixedAmount: paymentPlan.mode === 'FULL',
          input,
          tariffName,
        });
        setSubscriptionPayment(undefined);
        setAttendancePayment(undefined);
        setPaymentOpen(true);
      }
    } catch (caught) {
      setError(getErrorMessage(caught, t('subscription.errorSave')));
    }
  };
  const update = useMutation({
    mutationFn: (input: SubscriptionUpdateInput) =>
      getDesktopApi().subscriptions.update(getSessionToken(), editId ?? '', input),
  });
  const freeze = useMutation({
    mutationFn: ({ id, input }: { id: string; input: SubscriptionFreezeInput }) =>
      getDesktopApi().subscriptions.freeze(getSessionToken(), id, input),
  });
  const unfreeze = useMutation({
    mutationFn: (id: string) => getDesktopApi().subscriptions.unfreeze(getSessionToken(), id),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => getDesktopApi().subscriptions.cancel(getSessionToken(), id),
  });
  const adjust = useMutation({
    mutationFn: (input: SubscriptionAdjustmentInput) =>
      getDesktopApi().subscriptions.adjust(getSessionToken(), detailId ?? '', input),
  });
  const payment = useMutation({
    mutationFn: (input: PaymentInput) => getDesktopApi().payments.create(getSessionToken(), input),
  });
  const refreshAqsi = useMutation({
    mutationFn: (id: string) =>
      getDesktopApi().paymentOperations.refreshAqsi(getSessionToken(), id),
  });
  const retryFiscalReceipt = useMutation({
    mutationFn: (id: string) =>
      getDesktopApi().paymentOperations.retryFiscalReceipt(getSessionToken(), id),
  });
  useEffect(() => {
    if (!requestedAttendanceLessonId || !finance.data) return;
    const attendance = finance.data.uncoveredAttendances.find(
      ({ lessonId }) => lessonId === requestedAttendanceLessonId,
    );
    onRequestedActionHandled?.();
    if (!attendance) return;
    setFocusedAttendanceLessonId(attendance.lessonId);
    window.requestAnimationFrame(() => {
      document
        .getElementById(`attendance-payment-${attendance.lessonId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    if (attendance.paymentStatus === 'PENDING' || attendance.tariffs.length !== 1) return;
    const tariff = attendance.tariffs[0];
    if (!tariff) return;
    setAttendancePayment({
      amount: tariff.price,
      lessonId: attendance.lessonId,
      tariffId: tariff.id,
      tariffName: tariff.name,
    });
    setPaymentOpen(true);
  }, [finance.data, onRequestedActionHandled, requestedAttendanceLessonId]);
  useEffect(() => {
    const operation = selectedPaymentOperation.data;
    if (
      !operation ||
      !paymentOperationId ||
      !['SBP', 'ACQUIRING'].includes(operation.providerType)
    ) {
      setGatewayPayment(undefined);
      return;
    }
    let cancelled = false;
    setError(undefined);
    void getDesktopApi()
      .paymentOperations.refreshAqsi(getSessionToken(), paymentOperationId)
      .then((result) => {
        if (!cancelled) setGatewayPayment(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(getErrorMessage(caught, 'Не удалось загрузить данные чека.'));
      });
    return () => {
      cancelled = true;
    };
  }, [paymentOperationId, selectedPaymentOperation.data]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.studentFinance(student.id) }),
      queryClient.invalidateQueries({ queryKey: ['subscriptions', 'detail'] }),
      queryClient.invalidateQueries({ queryKey: ['finance'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['student-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['attention'] }),
      queryClient.invalidateQueries({ queryKey: ['trials'] }),
      queryClient.invalidateQueries({ queryKey: ['payment-operations'] }),
    ]);
  };
  const perform = async (
    operation: () => Promise<unknown>,
    fallback: string,
    close?: () => void,
  ) => {
    setError(undefined);
    try {
      await operation();
      await refresh();
      close?.();
    } catch (caught) {
      setError(getErrorMessage(caught, fallback));
    }
  };
  const active =
    finance.data?.subscriptions.filter(({ status }) => currentStatuses.includes(status)) ?? [];
  const upcoming = finance.data?.subscriptions.filter(({ status }) => status === 'PENDING') ?? [];
  const history =
    finance.data?.subscriptions.filter(
      ({ status }) => !currentStatuses.includes(status) && status !== 'PENDING',
    ) ?? [];

  if (finance.isLoading)
    return (
      <Card>
        <LoadingState label={t('common.loading')} />
      </Card>
    );
  if (finance.isError)
    return (
      <Card>
        <ErrorState
          message={t('subscription.errorLoad')}
          onRetry={() => void finance.refetch()}
          retryLabel={t('common.retry')}
          title={t('common.errorTitle')}
        />
      </Card>
    );
  return (
    <section className="mt-5 space-y-5">
      {successMessage ? (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">
          {successMessage}
        </div>
      ) : null}
      {finance.data?.uncoveredAttendances.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Посещения без покрытия</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Эти посещения не были учтены ни одним действующим абонементом.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {finance.data.uncoveredAttendances.map((attendance) => (
              <div
                className={cn(
                  'grid gap-3 rounded-2xl border border-border p-4 text-sm md:grid-cols-[1fr_auto] md:items-center',
                  focusedAttendanceLessonId === attendance.lessonId &&
                    'border-sky-300 bg-sky-50/70 ring-2 ring-sky-100',
                )}
                id={`attendance-payment-${attendance.lessonId}`}
                key={`${attendance.lessonId}:${attendance.startsAt}`}
              >
                <div>
                  <p className="font-medium">
                    {attendance.groupName} ·{' '}
                    {formatDate(attendance.startsAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {attendance.branchName}
                    {attendance.trainerName ? ` · ${attendance.trainerName}` : ''} ·{' '}
                    {attendance.status === 'LATE' ? 'Опоздание' : 'Присутствовал'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {attendance.paymentStatus === 'PENDING' ? (
                    <Badge>Оплата обрабатывается</Badge>
                  ) : attendance.tariffs.length === 0 ? (
                    <Badge>Нет разового тарифа</Badge>
                  ) : (
                    <>
                      {attendance.tariffs.length > 1 ? (
                        <Select
                          aria-label={`Тариф для ${attendance.groupName}`}
                          className="min-w-48"
                          onChange={(event) =>
                            setAttendanceTariffs((current) => ({
                              ...current,
                              [attendance.lessonId]: event.target.value,
                            }))
                          }
                          value={attendanceTariffs[attendance.lessonId] ?? ''}
                        >
                          <option value="">Выберите тариф</option>
                          {attendance.tariffs.map((tariff) => (
                            <option key={tariff.id} value={tariff.id}>
                              {tariff.name} · {formatMoneyForIndicator(tariff.price)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Money
                          amount={attendance.tariffs[0]?.price ?? 0}
                          className="font-semibold text-destructive"
                        />
                      )}
                      <Button
                        disabled={
                          !canManage ||
                          (attendance.tariffs.length > 1 && !attendanceTariffs[attendance.lessonId])
                        }
                        onClick={() => {
                          const tariffId =
                            attendanceTariffs[attendance.lessonId] ?? attendance.tariffId;
                          const tariff = attendance.tariffs.find(({ id }) => id === tariffId);
                          if (!tariff) return;
                          setAttendancePayment({
                            amount: tariff.price,
                            lessonId: attendance.lessonId,
                            tariffId: tariff.id,
                            tariffName: tariff.name,
                          });
                          setError(undefined);
                          setPaymentOpen(true);
                        }}
                        size="small"
                      >
                        Оплатить разовое посещение
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 px-5 py-4">
          <div>
            <CardTitle>{t('subscription.financeSummary')}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {finance.data?.subscriptions.length ?? 0} абонементов · активных {active.length}
            </p>
          </div>
          {canManage ? (
            <Button onClick={() => setFinanceMenuOpen(true)} size="small">
              <WalletCards className="size-4" /> Оплата / абонемент
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {!finance.data?.subscriptions.length ? (
            <EmptyState
              description={t('subscription.emptyDescription')}
              icon={CreditCard}
              title={t('subscription.emptyTitle')}
            />
          ) : (
            <div className="space-y-6">
              <SubscriptionGroup
                items={active}
                onSelect={setDetailId}
                title={t('subscription.active')}
              />
              {upcoming.length ? (
                <SubscriptionGroup
                  items={upcoming}
                  onSelect={setDetailId}
                  title={t('subscription.upcoming')}
                />
              ) : null}
              {history.length ? (
                <SubscriptionGroup
                  items={history}
                  onSelect={setDetailId}
                  title={t('subscription.history')}
                />
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
      {canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer list-none px-5 py-4">
              <span className="font-semibold">{t('payment.operation.title')}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {paymentOperations.data?.length ?? 0} · раскрыть
              </span>
            </summary>
            <CardContent className="border-t border-border px-5 pt-4">
              {paymentOperations.isLoading ? <LoadingState label={t('common.loading')} /> : null}
              {paymentOperations.data?.length ? (
                <div className="divide-y divide-border rounded-xl border border-border">
                  {paymentOperations.data.map((operation) => (
                    <button
                      aria-label={`Открыть детали оплаты: ${operation.purpose}`}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/40"
                      key={operation.id}
                      onClick={() => {
                        setError(undefined);
                        setGatewayPayment(undefined);
                        setPaymentOperationId(operation.id);
                      }}
                      type="button"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{operation.purpose}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(operation.createdAt, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-right">
                        <Money amount={operation.amount} className="text-sm font-semibold" />
                        <Badge>{t(`payment.operation.status.${operation.status}`)}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              ) : paymentOperations.isLoading ? null : (
                <p className="text-sm text-muted-foreground">{t('payment.operation.empty')}</p>
              )}
            </CardContent>
          </details>
        </Card>
      ) : null}
      <Dialog
        closeLabel={t('common.closeDialog')}
        onClose={() => setFinanceMenuOpen(false)}
        open={financeMenuOpen}
        title="Оплата и абонемент"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            className="h-auto justify-start p-4"
            onClick={() => {
              setAttendancePayment(undefined);
              setSubscriptionPayment(undefined);
              setSubscriptionSale(undefined);
              setError(undefined);
              setSuccessMessage(undefined);
              setFinanceMenuOpen(false);
              setPaymentOpen(true);
            }}
            variant="outline"
          >
            <WalletCards className="size-5" /> {t('payment.action.add')}
          </Button>
          <Button
            className="h-auto justify-start p-4"
            onClick={() => {
              setError(undefined);
              setFinanceMenuOpen(false);
              setIssueOpen(true);
            }}
            variant="outline"
          >
            <Plus className="size-5" /> Продать абонемент
          </Button>
        </div>
      </Dialog>
      <SubscriptionDialog
        activeSubscriptionCount={active.length}
        error={error}
        onClose={() => setIssueOpen(false)}
        onSubmit={sellSubscription}
        open={issueOpen}
        student={student}
        tariffs={tariffs.data ?? []}
      />
      <PaymentDialog
        attendancePayment={attendancePayment}
        branches={branches}
        error={error}
        fixedStudent={student}
        onClose={() => {
          setPaymentOpen(false);
          setAttendancePayment(undefined);
          setSubscriptionPayment(undefined);
          setSubscriptionSale(undefined);
        }}
        onSbpCompleted={async () => {
          await refresh();
          setSuccessMessage(
            subscriptionSale
              ? 'Абонемент выдан'
              : attendancePayment
                ? 'Посещение оплачено'
                : 'Оплата принята',
          );
        }}
        onSubmit={(input) => {
          const operation = subscriptionSale
            ? () =>
                issue.mutateAsync({
                  ...subscriptionSale.input,
                  initialPayment: {
                    amount: input.amount,
                    comment: input.comment,
                    externalReference: input.externalReference,
                    paidAt: input.paidAt,
                    paymentMethod: input.paymentMethod,
                  },
                })
            : () => payment.mutateAsync(input);
          return perform(operation, t('payment.errorSave'), () => {
            setSuccessMessage(
              subscriptionSale
                ? 'Абонемент выдан'
                : attendancePayment
                  ? 'Посещение оплачено'
                  : 'Оплата принята',
            );
            setPaymentOpen(false);
            setAttendancePayment(undefined);
            setSubscriptionPayment(undefined);
            setSubscriptionSale(undefined);
          });
        }}
        open={paymentOpen}
        students={[]}
        subscriptions={finance.data?.subscriptions}
        subscriptionPayment={subscriptionPayment}
        subscriptionSale={subscriptionSale}
      />
      <PaymentOperationDetailsDialog
        busy={refreshAqsi.isPending || retryFiscalReceipt.isPending}
        error={error}
        gateway={gatewayPayment}
        onCheck={() => {
          const operation = selectedPaymentOperation.data;
          if (!operation) return;
          setError(undefined);
          const action = gatewayPayment?.fiscalReceipt?.canRetry
            ? retryFiscalReceipt.mutateAsync(operation.id)
            : refreshAqsi.mutateAsync(operation.id);
          void action
            .then((result) => setGatewayPayment(result))
            .catch((caught: unknown) =>
              setError(getErrorMessage(caught, 'Не удалось проверить кассовый чек.')),
            );
        }}
        onClose={() => {
          setPaymentOperationId(undefined);
          setGatewayPayment(undefined);
          setError(undefined);
        }}
        open={Boolean(paymentOperationId)}
        operation={selectedPaymentOperation.data}
        payment={historicalPayment.data}
      />
      <FreezeDialog
        error={error}
        onClose={() => setFreezeId(undefined)}
        onSubmit={(input) =>
          perform(
            () => freeze.mutateAsync({ id: freezeId ?? '', input }),
            t('subscription.errorSave'),
            () => setFreezeId(undefined),
          )
        }
        open={Boolean(freezeId)}
      />
      <Dialog
        closeLabel={t('common.closeDialog')}
        onClose={() => setDetailId(undefined)}
        open={Boolean(detailId)}
        title={detail.data?.tariffName ?? t('subscription.history')}
        wide
      >
        {detail.isLoading ? <LoadingState label={t('common.loading')} /> : null}
        {detail.data ? (
          <div className="grid grid-cols-[1fr_0.85fr] gap-5">
            <div className="space-y-4">
              <div className="rounded-2xl bg-sidebar p-5 text-white">
                <div className="flex items-center justify-between">
                  <Badge>{t(`subscription.status.${detail.data.status}`)}</Badge>
                  <Money amount={detail.data.salePrice} className="text-xl font-semibold" />
                </div>
                <p className="mt-5 text-sm text-neutral-400">
                  {detail.data.lessonLimit === undefined
                    ? t('subscription.lessonsUnlimited', { used: detail.data.lessonsUsed })
                    : t('subscription.lessons', {
                        used: detail.data.lessonsUsed,
                        limit: detail.data.lessonLimit,
                      })}
                </p>
              </div>
              {detail.data.debt > 0 ? (
                <div className="space-y-3">
                  <BalanceIndicator
                    label={t('subscription.debt')}
                    tone="danger"
                    value={formatMoneyForIndicator(detail.data.debt)}
                  />
                  {canManage ? (
                    <Button
                      onClick={() => {
                        setSubscriptionPayment({
                          amount: detail.data.debt,
                          subscriptionId: detail.data.id,
                          tariffName: detail.data.tariffName,
                        });
                        setAttendancePayment(undefined);
                        setDetailId(undefined);
                        setError(undefined);
                        setPaymentOpen(true);
                      }}
                      size="small"
                    >
                      <WalletCards className="size-4" />
                      Принять оплату
                    </Button>
                  ) : null}
                </div>
              ) : (
                <BalanceIndicator
                  label={t('subscription.paid')}
                  tone="success"
                  value={formatMoneyForIndicator(detail.data.paidAmount)}
                />
              )}
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  {detail.data.status === 'ACTIVE' ? (
                    <Button
                      onClick={() => {
                        setFreezeId(detail.data.id);
                        setDetailId(undefined);
                      }}
                      size="small"
                      variant="outline"
                    >
                      <Pause className="size-4" />
                      {t('subscription.action.freeze')}
                    </Button>
                  ) : null}
                  {detail.data.status === 'FROZEN' ? (
                    <Button
                      onClick={() =>
                        void perform(
                          () => unfreeze.mutateAsync(detail.data.id),
                          t('subscription.errorSave'),
                        )
                      }
                      size="small"
                      variant="outline"
                    >
                      <RotateCcw className="size-4" />
                      {t('subscription.action.unfreeze')}
                    </Button>
                  ) : null}
                  {canAdjust ? (
                    <Button onClick={() => setAdjustOpen(true)} size="small" variant="outline">
                      {t('subscription.adjustment')}
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => {
                      setEditId(detail.data.id);
                      setDetailId(undefined);
                    }}
                    size="small"
                    variant="outline"
                  >
                    <Pencil className="size-4" />
                    Изменить абонемент
                  </Button>
                  <Button
                    onClick={() => {
                      if (window.confirm(t('subscription.cancelConfirm')))
                        void perform(
                          () => cancel.mutateAsync(detail.data.id),
                          t('subscription.errorSave'),
                          () => setDetailId(undefined),
                        );
                    }}
                    size="small"
                    variant="ghost"
                  >
                    {t('subscription.action.cancel')}
                  </Button>
                </div>
              ) : null}
            </div>
            <div>
              <div className="mb-5">
                <h3 className="mb-3 text-sm font-semibold">Оплата абонемента</h3>
                <div className="grid grid-cols-3 gap-2">
                  <BalanceIndicator
                    label="Стоимость"
                    tone="neutral"
                    value={formatMoneyForIndicator(detail.data.salePrice)}
                  />
                  <BalanceIndicator
                    label="Оплачено"
                    tone="success"
                    value={formatMoneyForIndicator(detail.data.paidAmount)}
                  />
                  <BalanceIndicator
                    label="Статус"
                    tone={detail.data.debt > 0 ? 'warning' : 'success'}
                    value={paymentStatusLabel(detail.data.paymentStatus)}
                  />
                </div>
                {detail.data.payments.length ? (
                  <div className="mt-3 space-y-2">
                    {detail.data.payments.map((item) => (
                      <div
                        className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm"
                        key={item.id}
                      >
                        <span>
                          {formatDate(item.paidAt, { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                          {t(`payment.method.${item.paymentMethod}`)}
                        </span>
                        <span className="font-semibold">
                          {formatMoneyForIndicator(item.netAmount)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">Платежей ещё нет.</p>
                )}
                {(paymentOperations.data ?? []).some(
                  (operation) => operation.subscriptionId === detail.data.id,
                ) ? (
                  <div className="mt-3 space-y-2">
                    {(paymentOperations.data ?? [])
                      .filter((operation) => operation.subscriptionId === detail.data.id)
                      .map((operation) => (
                        <div
                          className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2 text-sm"
                          key={operation.id}
                        >
                          <span>{operation.purpose}</span>
                          <Badge>{t(`payment.operation.status.${operation.status}`)}</Badge>
                        </div>
                      ))}
                  </div>
                ) : null}
              </div>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <History className="size-4" />
                {t('subscription.ledger')}
              </h3>
              <LedgerList
                items={detail.data.ledger.map((item) => ({
                  caption: item.comment ?? t('common.notProvided'),
                  date: formatDate(item.createdAt, { dateStyle: 'short', timeStyle: 'short' }),
                  delta: item.lessonDelta
                    ? `${item.lessonDelta > 0 ? '−' : '+'}${String(Math.abs(item.lessonDelta))}`
                    : undefined,
                  id: item.id,
                  kind:
                    item.type === 'REVERSAL'
                      ? 'credit'
                      : item.type === 'LESSON_WRITE_OFF'
                        ? 'debit'
                        : 'neutral',
                  title: t(`ledger.type.${item.type}`),
                }))}
              />
            </div>
          </div>
        ) : null}
      </Dialog>
      <SubscriptionEditDialog
        error={error}
        onClose={() => setEditId(undefined)}
        onSubmit={(input) =>
          perform(
            () => update.mutateAsync(input),
            t('subscription.errorSave'),
            () => setEditId(undefined),
          )
        }
        open={Boolean(editId)}
        subscription={detail.data}
        tariffs={tariffs.data ?? []}
      />
      <AdjustmentDialog
        error={error}
        onClose={() => setAdjustOpen(false)}
        onSubmit={(input) =>
          perform(
            () => adjust.mutateAsync(input),
            t('subscription.errorSave'),
            () => setAdjustOpen(false),
          )
        }
        open={adjustOpen}
      />
    </section>
  );
}

function formatMoneyForIndicator(amount: number): string {
  return new Intl.NumberFormat('ru-RU', { currency: 'RUB', style: 'currency' }).format(
    amount / 100,
  );
}

function paymentStatusLabel(status: SubscriptionSummary['paymentStatus']): string {
  return {
    PAID: 'Оплачен',
    PARTIALLY_PAID: 'Частично оплачен',
    REFUNDED: 'Возврат',
    UNPAID: 'Не оплачен',
  }[status];
}

function SubscriptionGroup({
  items,
  onSelect,
  title,
}: {
  items: SubscriptionSummary[];
  onSelect: (id: string) => void;
  title: string;
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <button
            className="rounded-2xl border border-border bg-background p-4 text-left transition hover:-translate-y-0.5 hover:bg-surface hover:shadow-card"
            key={item.id}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <div className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold">{item.tariffName}</span>
                <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="size-3.5" />
                  {item.expiresAt ? formatDate(item.expiresAt) : t('tariff.type.UNLIMITED')}
                </span>
              </span>
              <Badge>{t(`subscription.status.${item.status}`)}</Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <BalanceIndicator
                label={t('subscription.balance')}
                tone={item.lowBalance ? 'warning' : 'neutral'}
                value={item.remainingLessons === undefined ? '∞' : String(item.remainingLessons)}
              />
              <BalanceIndicator
                label={t('subscription.debt')}
                tone={item.debt > 0 ? 'danger' : 'success'}
                value={formatMoneyForIndicator(item.debt)}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
