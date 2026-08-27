import {
  FINANCE_DEBT_SORTS,
  FINANCE_DEBT_TYPES,
  formatDate,
  t,
  type BranchSummary,
  type FinanceDebtQuery,
  type FinanceDebtSort,
  type FinanceDebtStudent,
  type FinanceDebtType,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
  Money,
  Select,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@arava/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Search,
  Users,
  WalletCards,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken } from '../../stores/auth-store';

const debtTypeLabels: Record<FinanceDebtType, string> = {
  ALL: 'Все долги',
  ATTENDANCE: 'Посещения',
  SUBSCRIPTION: 'Абонементы',
};

const sortLabels: Record<FinanceDebtSort, string> = {
  AMOUNT: 'Сначала большая сумма',
  NAME: 'По имени',
  OLDEST: 'Сначала самый старый долг',
};

function DebtDetails({
  debt,
  onClose,
  onOpenAttendance,
  onOpenStudent,
  onOpenSubscription,
}: {
  debt: FinanceDebtStudent | undefined;
  onClose: () => void;
  onOpenAttendance: (studentId: string, lessonId: string) => void | Promise<void>;
  onOpenStudent: (studentId: string) => void | Promise<void>;
  onOpenSubscription: (studentId: string, subscriptionId: string) => void | Promise<void>;
}) {
  return (
    <Dialog
      closeLabel="Закрыть детали"
      footer={
        debt ? (
          <Button onClick={() => onOpenStudent(debt.studentId)} variant="outline">
            Открыть ученика
          </Button>
        ) : null
      }
      onClose={onClose}
      open={Boolean(debt)}
      title={debt ? `Задолженность · ${debt.studentName}` : 'Задолженность'}
    >
      {debt ? (
        <div className="space-y-5">
          <div className="grid gap-3 rounded-2xl bg-muted p-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Общий долг</p>
              <Money amount={debt.totalDebt} className="mt-1 block text-lg font-semibold" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Долг с</p>
              <p className="mt-1 font-semibold">
                {formatDate(debt.oldestDebtDate, { dateStyle: 'long' })}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Статус ученика</p>
              <p className="mt-1 font-semibold">{t(`status.${debt.status}`)}</p>
            </div>
          </div>

          {debt.subscriptions.length ? (
            <section>
              <h3 className="mb-3 font-semibold">Абонементы</h3>
              <div className="space-y-3">
                {debt.subscriptions.map((subscription) => (
                  <div className="rounded-2xl border border-border p-4" key={subscription.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{subscription.tariffName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {subscription.branchName} · выдан{' '}
                          {formatDate(subscription.purchasedAt, { dateStyle: 'medium' })}
                          {subscription.expiresAt
                            ? ` · до ${formatDate(subscription.expiresAt, { dateStyle: 'medium' })}`
                            : ''}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Стоимость <Money amount={subscription.salePrice} /> · оплачено{' '}
                          <Money amount={subscription.paidAmount} />
                        </p>
                      </div>
                      <div className="text-right">
                        <Money
                          amount={subscription.debt}
                          className="block font-semibold text-destructive"
                        />
                        <Badge className="mt-2">
                          {t(`subscription.status.${subscription.status}`)}
                        </Badge>
                      </div>
                    </div>
                    {subscription.pendingAmount > 0 ? (
                      <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Оплата ожидает подтверждения: <Money amount={subscription.pendingAmount} />
                      </p>
                    ) : null}
                    <div className="mt-3 flex justify-end">
                      <Button
                        disabled={subscription.pendingAmount > 0}
                        onClick={() => onOpenSubscription(debt.studentId, subscription.id)}
                        size="small"
                      >
                        {subscription.pendingAmount > 0
                          ? 'Оплата обрабатывается'
                          : 'Принять оплату'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {debt.attendances.length ? (
            <section>
              <h3 className="mb-3 font-semibold">Посещения без покрытия</h3>
              <div className="space-y-3">
                {debt.attendances.map((attendance) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-4"
                    key={`${attendance.lessonId}:${attendance.startsAt}`}
                  >
                    <div>
                      <p className="font-semibold">{attendance.groupName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(attendance.startsAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}{' '}
                        · {attendance.branchName} ·{' '}
                        {attendance.status === 'LATE' ? 'Опоздание' : 'Присутствовал'}
                      </p>
                    </div>
                    <div className="text-right">
                      {attendance.amount === undefined ? (
                        <Badge>Стоимость не определена</Badge>
                      ) : (
                        <Money
                          amount={attendance.amount}
                          className="block font-semibold text-destructive"
                        />
                      )}
                      {attendance.pendingAmount > 0 || attendance.paymentStatus === 'PENDING' ? (
                        <p className="mt-1 text-xs text-amber-800">Оплата ожидает подтверждения</p>
                      ) : null}
                      <Button
                        className="mt-2"
                        disabled={attendance.paymentStatus === 'PENDING'}
                        onClick={() => onOpenAttendance(debt.studentId, attendance.lessonId)}
                        size="small"
                        variant="outline"
                      >
                        {attendance.amount === undefined ? 'Выбрать тариф' : 'Оплатить посещение'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

export function FinanceDebts({ branches }: { branches: BranchSummary[] }) {
  const navigate = useNavigate();
  const [parameters, setParameters] = useSearchParams();
  const [search, setSearch] = useState(parameters.get('debtSearch') ?? '');
  const [selected, setSelected] = useState<FinanceDebtStudent>();
  const branchId = parameters.get('debtBranch') ?? '';
  const requestedType = parameters.get('debtType');
  const debtType = FINANCE_DEBT_TYPES.includes(requestedType as FinanceDebtType)
    ? (requestedType as FinanceDebtType)
    : 'ALL';
  const requestedSort = parameters.get('debtSort');
  const sort = FINANCE_DEBT_SORTS.includes(requestedSort as FinanceDebtSort)
    ? (requestedSort as FinanceDebtSort)
    : 'OLDEST';
  const requestedPage = Number(parameters.get('debtPage') ?? '1');
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const requestedPageSize = Number(parameters.get('debtSize') ?? '50');
  const pageSize = ([25, 50, 100] as const).includes(requestedPageSize as 25 | 50 | 100)
    ? (requestedPageSize as 25 | 50 | 100)
    : 50;
  const committedSearch = parameters.get('debtSearch') ?? '';
  const updateParameters = useCallback(
    (updates: Record<string, string>, resetPage = true) => {
      setParameters(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(updates))
            if (value) next.set(key, value);
            else next.delete(key);
          if (resetPage) next.delete('debtPage');
          next.set('view', 'debts');
          return next;
        },
        { replace: true },
      );
    },
    [setParameters],
  );
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const value = search.trim();
      if (value !== committedSearch) updateParameters({ debtSearch: value });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [committedSearch, search, updateParameters]);
  const query = useMemo<FinanceDebtQuery>(
    () => ({
      branchId: branchId || undefined,
      debtType,
      page,
      pageSize,
      search: committedSearch || undefined,
      sort,
    }),
    [branchId, committedSearch, debtType, page, pageSize, sort],
  );
  const debts = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => getDesktopApi().finance.debts(getSessionToken(), query),
    queryKey: queryKeys.financeDebts(query),
  });
  const openStudent = (studentId: string, action?: string) =>
    navigate(`/students/${studentId}${action ? `?${action}` : ''}`);

  return (
    <section className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={CircleDollarSign}
          label="Общая задолженность"
          loading={debts.isLoading}
          value={<Money amount={debts.data?.summary.totalDebt ?? 0} />}
        />
        <StatCard
          icon={Users}
          label="Должников"
          loading={debts.isLoading}
          value={String(debts.data?.summary.debtorsCount ?? 0)}
        />
        <StatCard
          icon={AlertTriangle}
          label="Непрооценённых посещений"
          loading={debts.isLoading}
          value={String(debts.data?.summary.unvaluedAttendanceCount ?? 0)}
        />
        <StatCard
          icon={CalendarClock}
          label="Самый старый долг"
          loading={debts.isLoading}
          value={
            debts.data?.summary.oldestDebtDate
              ? formatDate(debts.data.summary.oldestDebtDate, { dateStyle: 'medium' })
              : '—'
          }
        />
      </section>

      <Card>
        <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5">
          <Label className="xl:col-span-2">
            Поиск
            <span className="relative mt-2 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Поиск должника"
                className="pl-9"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Фамилия, имя или телефон"
                value={search}
              />
            </span>
          </Label>
          <Label>
            Филиал
            <Select
              aria-label="Филиал задолженности"
              className="mt-2"
              onChange={(event) => updateParameters({ debtBranch: event.target.value })}
              value={branchId}
            >
              <option value="">Все доступные филиалы</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </Label>
          <Label>
            Тип долга
            <Select
              aria-label="Тип задолженности"
              className="mt-2"
              onChange={(event) => updateParameters({ debtType: event.target.value })}
              value={debtType}
            >
              {FINANCE_DEBT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {debtTypeLabels[type]}
                </option>
              ))}
            </Select>
          </Label>
          <Label>
            Сортировка
            <Select
              aria-label="Сортировка задолженности"
              className="mt-2"
              onChange={(event) => updateParameters({ debtSort: event.target.value })}
              value={sort}
            >
              {FINANCE_DEBT_SORTS.map((item) => (
                <option key={item} value={item}>
                  {sortLabels[item]}
                </option>
              ))}
            </Select>
          </Label>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {debts.isLoading ? <LoadingState label="Загружаем задолженности…" /> : null}
        {debts.isError ? (
          <ErrorState
            message="Не удалось загрузить задолженности. Попробуйте ещё раз."
            onRetry={() => void debts.refetch()}
            retryLabel="Повторить"
            title="Задолженности временно недоступны"
          />
        ) : null}
        {!debts.isError && debts.data?.items.length === 0 ? (
          <EmptyState
            description="Все текущие оплаты закрыты."
            icon={WalletCards}
            title="Задолженностей нет"
          />
        ) : null}
        {debts.data?.items.length ? (
          <div className={debts.isFetching ? 'opacity-70 transition' : 'transition'}>
            <div className="overflow-x-auto">
              <Table className="min-w-[1050px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Ученик</TableHead>
                    <TableHead>Филиал</TableHead>
                    <TableHead>Долг с</TableHead>
                    <TableHead>Абонементы</TableHead>
                    <TableHead>Посещения</TableHead>
                    <TableHead>Источники</TableHead>
                    <TableHead className="text-right">Общий долг</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {debts.data.items.map((debt) => (
                    <TableRow key={debt.studentId}>
                      <TableCell>
                        <button
                          className="font-semibold hover:underline"
                          onClick={() => openStudent(debt.studentId)}
                          type="button"
                        >
                          {debt.studentName}
                        </button>
                        {debt.status !== 'ACTIVE' ? (
                          <Badge className="ml-2">{t(`status.${debt.status}`)}</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{debt.branchName}</TableCell>
                      <TableCell>
                        {formatDate(debt.oldestDebtDate, { dateStyle: 'medium' })}
                      </TableCell>
                      <TableCell>
                        <Money amount={debt.subscriptionDebt} />
                      </TableCell>
                      <TableCell>
                        <Money amount={debt.attendanceDebt} />
                        {debt.unvaluedAttendanceCount ? (
                          <span className="mt-1 block text-xs text-amber-800">
                            Не оценено: {debt.unvaluedAttendanceCount}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>{debt.debtSourcesCount}</TableCell>
                      <TableCell className="text-right font-semibold text-destructive">
                        <Money amount={debt.totalDebt} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button onClick={() => setSelected(debt)} size="small" variant="outline">
                          Подробнее
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
              <span className="text-sm text-muted-foreground">
                {debts.data.total} учеников · страница {debts.data.page} из{' '}
                {Math.max(1, debts.data.totalPages)}
              </span>
              <div className="flex items-center gap-2">
                <Select
                  aria-label="Строк на странице задолженности"
                  className="w-24"
                  onChange={(event) => updateParameters({ debtSize: event.target.value })}
                  value={String(pageSize)}
                >
                  {[25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </Select>
                <Button
                  aria-label="Предыдущая страница задолженности"
                  disabled={page <= 1}
                  onClick={() => updateParameters({ debtPage: String(page - 1) }, false)}
                  variant="outline"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  aria-label="Следующая страница задолженности"
                  disabled={page >= debts.data.totalPages}
                  onClick={() => updateParameters({ debtPage: String(page + 1) }, false)}
                  variant="outline"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      <DebtDetails
        debt={selected}
        onClose={() => setSelected(undefined)}
        onOpenAttendance={(studentId, lessonId) =>
          openStudent(
            studentId,
            `action=attendance-payment&lessonId=${encodeURIComponent(lessonId)}`,
          )
        }
        onOpenStudent={openStudent}
        onOpenSubscription={(studentId, subscriptionId) =>
          openStudent(
            studentId,
            `action=payment&subscriptionId=${encodeURIComponent(subscriptionId)}`,
          )
        }
      />
    </section>
  );
}
