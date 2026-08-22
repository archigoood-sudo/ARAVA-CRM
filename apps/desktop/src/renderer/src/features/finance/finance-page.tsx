import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  formatDate,
  t,
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
import { Banknote, CircleDollarSign, CreditCard, Plus, Search, WalletCards } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { PaymentDetailsDialog } from './payment-details-dialog';
import { PaymentDialog } from './payment-dialog';
import { RefundDialog } from './refund-dialog';

function dateInput(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

export function FinancePage() {
  const user = useAuthStore((state) => state.user);
  const canRefund = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const queryClient = useQueryClient();
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
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const employees = useQuery({
    queryFn: () => getDesktopApi().finance.employees(getSessionToken()),
    queryKey: ['finance', 'employees'],
  });
  const students = useQuery({
    queryFn: () =>
      getDesktopApi().students.list(getSessionToken(), {
        page: 1,
        pageSize: 100,
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    queryKey: ['finance', 'student-options'],
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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['payments'] }),
      queryClient.invalidateQueries({ queryKey: ['finance'] }),
      queryClient.invalidateQueries({ queryKey: ['students', 'finance'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
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
          <Button
            onClick={() => {
              setError(undefined);
              setPaymentOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t('payment.action.add')}
          </Button>
        }
        description={t('finance.pageDescription')}
        title={t('finance.pageTitle')}
      />
      <section className="mb-5 grid grid-cols-3 gap-4">
        <StatCard
          icon={Banknote}
          label={t('finance.dailyRevenue')}
          loading={stats.isLoading}
          value={<Money amount={stats.data?.revenueToday ?? 0} />}
        />
        <StatCard
          icon={CircleDollarSign}
          label={t('finance.monthlyRevenue')}
          loading={stats.isLoading}
          value={<Money amount={stats.data?.revenueThisMonth ?? 0} />}
        />
        <StatCard
          icon={WalletCards}
          label={t('finance.outstandingDebt')}
          loading={stats.isLoading}
          value={<Money amount={stats.data?.outstandingDebt ?? 0} />}
        />
      </section>
      <Card className="mb-5 p-4">
        <div className="grid grid-cols-[minmax(240px,1fr)_repeat(3,minmax(160px,0.5fr))] gap-3">
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
            aria-label={t('student.branch')}
            onChange={(event) => setBranchId(event.target.value)}
            value={branchId}
          >
            <option value="">{t('student.filter.allBranches')}</option>
            {branches.data?.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
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
        <div className="mt-3 grid grid-cols-3 gap-3">
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
        students={students.data?.items ?? []}
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
