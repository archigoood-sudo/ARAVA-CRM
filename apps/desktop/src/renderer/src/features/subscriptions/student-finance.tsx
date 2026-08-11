import {
  formatDate,
  t,
  type BranchSummary,
  type PaymentInput,
  type StudentSummary,
  type SubscriptionAdjustmentInput,
  type SubscriptionCreateInput,
  type SubscriptionFreezeInput,
  type SubscriptionStatus,
  type SubscriptionSummary,
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
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CreditCard,
  History,
  Pause,
  Plus,
  RotateCcw,
  WalletCards,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { PaymentDialog } from '../finance/payment-dialog';
import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { AdjustmentDialog } from './adjustment-dialog';
import { FreezeDialog } from './freeze-dialog';
import { SubscriptionDialog } from './subscription-dialog';

const currentStatuses: SubscriptionStatus[] = ['ACTIVE', 'FROZEN'];

export function StudentFinance({
  branches,
  onRequestedActionHandled,
  requestedAction,
  student,
}: {
  branches: BranchSummary[];
  onRequestedActionHandled?: (() => void) | undefined;
  requestedAction?: 'payment' | 'subscription' | undefined;
  student: StudentSummary;
}) {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role !== 'COACH';
  const canAdjust = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [freezeId, setFreezeId] = useState<string>();
  const [detailId, setDetailId] = useState<string>();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (requestedAction === 'payment') setPaymentOpen(true);
    if (requestedAction === 'subscription') setIssueOpen(true);
    if (requestedAction) onRequestedActionHandled?.();
  }, [onRequestedActionHandled, requestedAction]);
  const finance = useQuery({
    queryFn: () => getDesktopApi().subscriptions.listStudent(getSessionToken(), student.id),
    queryKey: queryKeys.studentFinance(student.id),
  });
  const tariffs = useQuery({
    queryFn: () => getDesktopApi().tariffs.list(getSessionToken(), { branchId: student.branchId }),
    queryKey: queryKeys.tariffs({ branchId: student.branchId }),
  });
  const detail = useQuery({
    enabled: Boolean(detailId),
    queryFn: () => getDesktopApi().subscriptions.get(getSessionToken(), detailId ?? ''),
    queryKey: ['subscriptions', 'detail', detailId],
  });
  const issue = useMutation({
    mutationFn: (input: SubscriptionCreateInput) =>
      getDesktopApi().subscriptions.create(getSessionToken(), input),
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
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.studentFinance(student.id) }),
      queryClient.invalidateQueries({ queryKey: ['subscriptions', 'detail'] }),
      queryClient.invalidateQueries({ queryKey: ['finance'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['student-profile'] }),
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
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">{t('subscription.active')}</p>
            <p className="mt-2 text-3xl font-semibold">{finance.data?.activeSubscriptions ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">{t('subscription.debt')}</p>
            <Money
              amount={finance.data?.totalDebt ?? 0}
              className="mt-2 block text-3xl font-semibold"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">{t('subscription.balance')}</p>
            <p className="mt-2 text-3xl font-semibold">
              {active.reduce((sum, item) => sum + (item.remainingLessons ?? 0), 0)}
            </p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{t('subscription.financeSummary')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('subscription.createDescription')}
            </p>
          </div>
          {canManage ? (
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setError(undefined);
                  setPaymentOpen(true);
                }}
                size="small"
                variant="outline"
              >
                <WalletCards className="size-4" />
                {t('payment.action.add')}
              </Button>
              <Button
                onClick={() => {
                  setError(undefined);
                  setIssueOpen(true);
                }}
                size="small"
              >
                <Plus className="size-4" />
                {t('subscription.action.issue')}
              </Button>
            </div>
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
      <SubscriptionDialog
        error={error}
        onClose={() => setIssueOpen(false)}
        onSubmit={(input) =>
          perform(
            () => issue.mutateAsync(input),
            t('subscription.errorSave'),
            () => setIssueOpen(false),
          )
        }
        open={issueOpen}
        student={student}
        tariffs={tariffs.data ?? []}
      />
      <PaymentDialog
        branches={branches}
        error={error}
        fixedStudent={student}
        onClose={() => setPaymentOpen(false)}
        onSubmit={(input) =>
          perform(
            () => payment.mutateAsync(input),
            t('payment.errorSave'),
            () => setPaymentOpen(false),
          )
        }
        open={paymentOpen}
        students={[]}
        subscriptions={finance.data?.subscriptions}
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
                <BalanceIndicator
                  label={t('subscription.debt')}
                  tone="danger"
                  value={formatMoneyForIndicator(detail.data.debt)}
                />
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
