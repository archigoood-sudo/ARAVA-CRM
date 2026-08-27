import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  formatDate,
  t,
  type FinanceTodayProviderOperation,
  type PaymentInput,
  type PaymentListQuery,
  type PaymentMethod,
  type PaymentStatus,
  type RefundInput,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Money,
  PageHeader,
  Select,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingBag,
  Users,
  WalletCards,
} from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { invalidateFinanceCaches } from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { PaymentDetailsDialog } from './payment-details-dialog';
import { PaymentDialog } from './payment-dialog';
import { financeTodayOperationTone, hasFinanceTodayActivity } from './finance-today-model';
import { RefundDialog } from './refund-dialog';

function dateInput(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function ProviderOperationList({
  emptyLabel,
  items,
  onOpen,
}: {
  emptyLabel: string;
  items: FinanceTodayProviderOperation[];
  onOpen: (item: FinanceTodayProviderOperation) => void;
}) {
  if (items.length === 0) return <p className="py-4 text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button
          className="flex w-full items-start justify-between gap-4 rounded-2xl border border-border bg-white px-4 py-3 text-left transition hover:border-foreground/20 hover:shadow-sm"
          key={item.id}
          onClick={() => onOpen(item)}
          type="button"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{item.studentName}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {item.purpose} · {item.branchName}
            </span>
            {item.failureReason ? (
              <span className="mt-1 block text-xs text-destructive">{item.failureReason}</span>
            ) : null}
          </span>
          <Money amount={item.amount} className="shrink-0 text-sm font-semibold" />
        </button>
      ))}
    </div>
  );
}

export function FinancePage() {
  const user = useAuthStore((state) => state.user);
  const canRefund = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [branchId, setBranchId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState(dateInput(monthStart));
  const [dateTo, setDateTo] = useState(dateInput(now));
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string>();
  const [refundOpen, setRefundOpen] = useState(false);
  const [error, setError] = useState<string>();
  const today = dateInput(now);
  const paymentQuery = useMemo<PaymentListQuery>(
    () => ({
      branchId: branchId || undefined,
      createdByUserId: employeeId || undefined,
      dateFrom: new Date(`${dateFrom}T00:00:00`).toISOString(),
      dateTo: new Date(`${dateTo}T23:59:59`).toISOString(),
      paymentMethod: (method || undefined) as PaymentMethod | undefined,
      search: deferredSearch,
      status: (status || undefined) as PaymentStatus | undefined,
    }),
    [branchId, dateFrom, dateTo, deferredSearch, employeeId, method, status],
  );
  const payments = useQuery({
    queryFn: () => getDesktopApi().payments.list(getSessionToken(), paymentQuery),
    queryKey: queryKeys.payments(paymentQuery),
  });
  const stats = useQuery({
    queryFn: () => getDesktopApi().finance.stats(getSessionToken(), branchId || undefined),
    queryKey: queryKeys.financeStats(branchId || undefined),
  });
  const todayOverview = useQuery({
    queryFn: () =>
      getDesktopApi().finance.today(getSessionToken(), {
        branchId: branchId || undefined,
        date: today,
      }),
    queryKey: queryKeys.financeToday(today, branchId || undefined),
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const employees = useQuery({
    queryFn: () => getDesktopApi().finance.employees(getSessionToken()),
    queryKey: ['finance', 'employees'],
  });
  const students = useQuery({
    queryFn: () => getDesktopApi().students.options(getSessionToken()),
    queryKey: ['students', 'options'],
  });
  const paymentDetail = useQuery({
    enabled: Boolean(selectedPaymentId),
    queryFn: () => getDesktopApi().payments.get(getSessionToken(), selectedPaymentId ?? ''),
    queryKey: ['payments', 'detail', selectedPaymentId],
  });
  const createPayment = useMutation({
    mutationFn: (input: PaymentInput) => getDesktopApi().payments.create(getSessionToken(), input),
  });
  const refund = useMutation({
    mutationFn: (input: RefundInput) =>
      getDesktopApi().refunds.create(getSessionToken(), selectedPaymentId ?? '', input),
  });
  const cancelPayment = useMutation({
    mutationFn: (id: string) => getDesktopApi().payments.cancel(getSessionToken(), id),
  });
  const refresh = async () => {
    await invalidateFinanceCaches(queryClient);
  };
  const savePayment = async (input: PaymentInput) => {
    setError(undefined);
    try {
      await createPayment.mutateAsync(input);
      await refresh();
      setPaymentOpen(false);
    } catch (caught) {
      setError(getErrorMessage(caught, t('payment.errorSave')));
    }
  };
  const saveRefund = async (input: RefundInput) => {
    setError(undefined);
    try {
      await refund.mutateAsync(input);
      await refresh();
      await paymentDetail.refetch();
      setRefundOpen(false);
    } catch (caught) {
      setError(getErrorMessage(caught, t('refund.error')));
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1540px] animate-fade-in p-9 pb-14">
      <PageHeader
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={todayOverview.isFetching}
              onClick={() => void refresh()}
              variant="secondary"
            >
              <RefreshCw className={`size-4 ${todayOverview.isFetching ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
            <Button
              onClick={() => {
                setError(undefined);
                setPaymentOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t('payment.action.add')}
            </Button>
          </div>
        }
        description={t('finance.pageDescription')}
        title={t('finance.pageTitle')}
      />
      <Card className="mb-5 flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-sm font-semibold">Сегодня</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDate(new Date(), { day: 'numeric', month: 'long', weekday: 'long' })}
          </p>
        </div>
        <Select
          aria-label="Филиал финансовой сводки"
          className="w-full sm:w-[280px]"
          onChange={(event) => setBranchId(event.target.value)}
          value={branchId}
        >
          <option value="">Все доступные филиалы</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
      </Card>
      {todayOverview.isError ? (
        <Card className="mb-5">
          <ErrorState
            message="Не удалось загрузить финансовую сводку. Попробуйте ещё раз."
            onRetry={() => void todayOverview.refetch()}
            retryLabel={t('common.retry')}
            title={t('common.errorTitle')}
          />
        </Card>
      ) : null}
      <section className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Banknote}
          label="Принято сегодня"
          loading={todayOverview.isLoading}
          value={<Money amount={todayOverview.data?.received ?? 0} />}
        />
        <StatCard
          icon={RotateCcw}
          label="Возвраты сегодня"
          loading={todayOverview.isLoading}
          value={<Money amount={todayOverview.data?.refunds ?? 0} />}
        />
        <StatCard
          icon={CircleDollarSign}
          label="Чистый приход"
          loading={todayOverview.isLoading}
          value={<Money amount={todayOverview.data?.net ?? 0} />}
        />
        <StatCard
          icon={ReceiptText}
          label="Успешных операций"
          loading={todayOverview.isLoading}
          value={String(todayOverview.data?.successfulCount ?? 0)}
        />
      </section>
      <section className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ShoppingBag}
          label="Продано абонементов"
          loading={todayOverview.isLoading}
          value={String(todayOverview.data?.subscriptionSales.count ?? 0)}
        />
        <StatCard
          icon={CircleDollarSign}
          label="Абонементов оформлено на"
          loading={todayOverview.isLoading}
          value={<Money amount={todayOverview.data?.subscriptionSales.value ?? 0} />}
        />
        <StatCard
          icon={CreditCard}
          label="Оплачено разовых посещений"
          loading={todayOverview.isLoading}
          value={
            <span className="inline-flex flex-wrap items-baseline gap-2">
              <span>{todayOverview.data?.directAttendance.count ?? 0}</span>
              <span className="text-base font-semibold text-muted-foreground">·</span>
              <Money amount={todayOverview.data?.directAttendance.amount ?? 0} />
            </span>
          }
        />
        <StatCard
          icon={WalletCards}
          label="Текущая задолженность"
          loading={todayOverview.isLoading}
          value={<Money amount={todayOverview.data?.debt.totalAmount ?? 0} />}
        />
      </section>
      <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.55fr)]">
        <Card>
          <CardHeader>
            <CardTitle>По способам оплаты сегодня</CardTitle>
          </CardHeader>
          <CardContent>
            {todayOverview.data?.byMethod.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {todayOverview.data.byMethod.map((item) => (
                  <div
                    className="flex items-center justify-between rounded-2xl border border-border px-4 py-3"
                    key={item.method}
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        {t(`payment.method.${item.method}`)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.count} операций
                      </span>
                    </span>
                    <Money amount={item.amount} className="font-semibold" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Сегодня оплат ещё не было
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Долги</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Учеников с долгом</span>
              <strong>{todayOverview.data?.debt.studentCount ?? 0}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">По абонементам</span>
              <Money amount={todayOverview.data?.debt.subscriptionAmount ?? 0} />
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Посещения без покрытия</span>
              <Money amount={todayOverview.data?.debt.uncoveredAmount ?? 0} />
            </div>
            {(todayOverview.data?.debt.unpricedAttendanceCount ?? 0) > 0 ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {todayOverview.data?.debt.unpricedAttendanceCount} посещений требуют выбора тарифа
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      {(todayOverview.data?.recoveryCount ?? 0) > 0 ? (
        <Card className="mb-5 border-destructive/20 bg-red-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              Требуют внимания: {todayOverview.data?.recoveryCount}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProviderOperationList
              emptyLabel="Проблемных продаж нет"
              items={todayOverview.data?.recovery ?? []}
              onOpen={(item) =>
                navigate(`/students/${item.studentId}?paymentOperationId=${item.id}`)
              }
            />
          </CardContent>
        </Card>
      ) : null}
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="size-5 text-amber-600" />
              Ожидают подтверждения · {todayOverview.data?.pendingCount ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProviderOperationList
              emptyLabel="Ожидающих операций нет"
              items={todayOverview.data?.pending ?? []}
              onOpen={(item) =>
                navigate(`/students/${item.studentId}?paymentOperationId=${item.id}`)
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              Не завершены · {todayOverview.data?.failedCount ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProviderOperationList
              emptyLabel="Незавершённых операций сегодня нет"
              items={todayOverview.data?.failed ?? []}
              onOpen={(item) =>
                navigate(`/students/${item.studentId}?paymentOperationId=${item.id}`)
              }
            />
          </CardContent>
        </Card>
      </div>
      <Card className="mb-5 overflow-hidden">
        <CardHeader>
          <CardTitle>Последние операции сегодня</CardTitle>
        </CardHeader>
        {hasFinanceTodayActivity(todayOverview.data) ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[780px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Время</TableHead>
                  <TableHead>Ученик</TableHead>
                  <TableHead>Назначение</TableHead>
                  <TableHead>Способ</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {todayOverview.data?.recentOperations.map((operation) => (
                  <TableRow
                    className="cursor-pointer"
                    key={operation.id}
                    onClick={() => navigate(`/students/${operation.studentId}`)}
                  >
                    <TableCell>
                      {formatDate(operation.occurredAt, { hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell>
                      <p className="font-semibold">{operation.studentName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{operation.branchName}</p>
                    </TableCell>
                    <TableCell>{operation.purpose}</TableCell>
                    <TableCell>{t(`payment.method.${operation.method}`)}</TableCell>
                    <TableCell>
                      <Badge>
                        {operation.kind === 'REFUND'
                          ? 'Возврат'
                          : t(`payment.status.${operation.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        financeTodayOperationTone(operation) === 'refund' ? 'text-destructive' : ''
                      }`}
                    >
                      {financeTodayOperationTone(operation) === 'refund' ? '−' : ''}
                      <Money amount={operation.amount} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            description="Платежи и возвраты появятся здесь сразу после проведения."
            icon={ReceiptText}
            title="Сегодня оплат ещё не было"
          />
        )}
      </Card>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-lg font-semibold">Журнал платежей</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Поиск и фильтры по выбранному периоду
          </p>
        </div>
        <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
          <Users className="size-4" />
          За месяц: <Money amount={stats.data?.revenueThisMonth ?? 0} />
        </div>
      </div>
      <Card className="mb-5 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_repeat(2,minmax(160px,0.5fr))]">
          <label className="relative">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t('payment.search')}
              className="pl-10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('payment.search')}
              value={search}
            />
          </label>
          <Select
            aria-label={t('payment.method')}
            onChange={(event) => setMethod(event.target.value)}
            value={method}
          >
            <option value="">{t('payment.method')}</option>
            {PAYMENT_METHODS.map((item) => (
              <option key={item} value={item}>
                {t(`payment.method.${item}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('payment.status')}
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="">{t('payment.status')}</option>
            {PAYMENT_STATUSES.map((item) => (
              <option key={item} value={item}>
                {t(`payment.status.${item}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Input
            aria-label={t('finance.dateFrom')}
            onChange={(event) => setDateFrom(event.target.value)}
            type="date"
            value={dateFrom}
          />
          <Input
            aria-label={t('finance.dateTo')}
            onChange={(event) => setDateTo(event.target.value)}
            type="date"
            value={dateTo}
          />
          <Select
            aria-label={t('finance.employee')}
            onChange={(event) => setEmployeeId(event.target.value)}
            value={employeeId}
          >
            <option value="">{t('finance.allEmployees')}</option>
            {employees.data?.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName}
              </option>
            ))}
          </Select>
        </div>
      </Card>
      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-5">
        <Card className="overflow-hidden">
          {payments.isLoading ? <LoadingState label={t('common.loading')} /> : null}
          {payments.isError ? (
            <ErrorState
              message={t('payment.errorLoad')}
              onRetry={() => void payments.refetch()}
              retryLabel={t('common.retry')}
              title={t('common.errorTitle')}
            />
          ) : null}
          {payments.data?.length === 0 ? (
            <EmptyState
              description={t('payment.emptyDescription')}
              icon={CreditCard}
              title={t('payment.emptyTitle')}
            />
          ) : null}
          {payments.data?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('payment.student')}</TableHead>
                  <TableHead>{t('payment.date')}</TableHead>
                  <TableHead>{t('payment.method')}</TableHead>
                  <TableHead>{t('payment.amount')}</TableHead>
                  <TableHead>{t('payment.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.data.map((payment) => (
                  <TableRow
                    className="cursor-pointer"
                    key={payment.id}
                    onClick={() => setSelectedPaymentId(payment.id)}
                  >
                    <TableCell>
                      <p className="font-semibold">{payment.studentName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{payment.branchName}</p>
                    </TableCell>
                    <TableCell>
                      {formatDate(payment.paidAt, { dateStyle: 'medium', timeStyle: 'short' })}
                    </TableCell>
                    <TableCell>{t(`payment.method.${payment.paymentMethod}`)}</TableCell>
                    <TableCell>
                      <Money amount={payment.netAmount} className="font-semibold" />
                    </TableCell>
                    <TableCell>
                      <Badge>{t(`payment.status.${payment.status}`)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('finance.methodBreakdown')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.data?.methodBreakdown.map((item) => (
              <div
                className="flex items-center justify-between rounded-xl border border-border px-3 py-3 text-sm"
                key={item.method}
              >
                <span>{t(`payment.method.${item.method}`)}</span>
                <Money amount={item.amount} className="font-semibold" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <PaymentDialog
        branches={branches.data ?? []}
        error={error}
        onClose={() => setPaymentOpen(false)}
        onSbpCompleted={refresh}
        onSubmit={savePayment}
        open={paymentOpen}
        students={students.data ?? []}
      />
      <PaymentDetailsDialog
        canRefund={canRefund}
        onCancel={() => {
          if (selectedPaymentId && window.confirm(t('payment.cancelConfirm')))
            void (async () => {
              await cancelPayment.mutateAsync(selectedPaymentId);
              await refresh();
              await paymentDetail.refetch();
            })();
        }}
        onClose={() => setSelectedPaymentId(undefined)}
        onRefund={() => {
          setError(undefined);
          setRefundOpen(true);
        }}
        open={Boolean(selectedPaymentId)}
        payment={paymentDetail.data}
      />
      <RefundDialog
        error={error}
        onClose={() => setRefundOpen(false)}
        onSubmit={saveRefund}
        open={refundOpen}
      />
    </main>
  );
}
