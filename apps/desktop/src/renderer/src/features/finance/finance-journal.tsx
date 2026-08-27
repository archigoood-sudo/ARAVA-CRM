import {
  FINANCE_JOURNAL_EVENT_TYPES,
  PAYMENT_METHODS,
  formatDate,
  t,
  type BranchSummary,
  type FinanceJournalEvent,
  type FinanceJournalEventType,
  type FinanceJournalFilter,
  type FinanceJournalQuery,
  type PaymentMethod,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  ReceiptText,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken } from '../../stores/auth-store';
import {
  financePeriodRange,
  journalPageLabel,
  type FinancePeriodPreset,
} from './finance-journal-model';

const periodLabels: Record<Exclude<FinancePeriodPreset, 'CUSTOM'>, string> = {
  TODAY: 'Сегодня',
  YESTERDAY: 'Вчера',
  SEVEN_DAYS: '7 дней',
  THIRTY_DAYS: '30 дней',
  THIS_MONTH: 'Этот месяц',
  PREVIOUS_MONTH: 'Прошлый месяц',
};

const eventTypeLabels: Record<FinanceJournalEventType, string> = {
  ALL: 'Все операции',
  PAYMENT: 'Оплаты',
  REFUND: 'Возвраты',
};

function JournalDetails({
  event,
  onClose,
  onOpenStudent,
}: {
  event?: FinanceJournalEvent;
  onClose: () => void;
  onOpenStudent: (studentId: string) => void;
}) {
  return (
    <Dialog
      closeLabel="Закрыть детали"
      footer={
        event ? (
          <div className="flex justify-end">
            <Button onClick={() => onOpenStudent(event.studentId)}>Открыть ученика</Button>
          </div>
        ) : null
      }
      onClose={onClose}
      open={Boolean(event)}
      title={event?.kind === 'REFUND' ? 'Детали возврата' : 'Детали оплаты'}
    >
      {event ? (
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Дата и время</dt>
            <dd className="mt-1 font-semibold">
              {formatDate(event.occurredAt, { dateStyle: 'long', timeStyle: 'short' })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Сумма</dt>
            <dd
              className={
                event.kind === 'REFUND'
                  ? 'mt-1 font-semibold text-destructive'
                  : 'mt-1 font-semibold'
              }
            >
              {event.kind === 'REFUND' ? '−' : ''}
              <Money amount={event.amount} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Ученик</dt>
            <dd className="mt-1 font-semibold">{event.studentName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Филиал</dt>
            <dd className="mt-1 font-semibold">{event.branchName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Способ</dt>
            <dd className="mt-1 font-semibold">{t(`payment.method.${event.method}`)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Статус</dt>
            <dd className="mt-1 font-semibold">
              {event.kind === 'REFUND' ? 'Возвращено' : t(`payment.status.${event.status}`)}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Назначение</dt>
            <dd className="mt-1 font-semibold">{event.purpose}</dd>
          </div>
          {event.kind === 'REFUND' && event.originalPaymentAt ? (
            <div className="rounded-2xl bg-muted p-4 sm:col-span-2">
              <dt className="text-muted-foreground">Исходная оплата</dt>
              <dd className="mt-1 font-semibold">
                <Money amount={event.originalPaymentAmount ?? 0} /> ·{' '}
                {formatDate(event.originalPaymentAt, { dateStyle: 'long', timeStyle: 'short' })}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </Dialog>
  );
}

export function FinanceJournal({
  branches,
  onOpenPayment,
}: {
  branches: BranchSummary[];
  onOpenPayment: (paymentId: string) => void;
}) {
  const navigate = useNavigate();
  const [parameters, setParameters] = useSearchParams();
  const defaultRange = useMemo(() => financePeriodRange('THIS_MONTH'), []);
  const [search, setSearch] = useState(parameters.get('search') ?? '');
  const [selected, setSelected] = useState<FinanceJournalEvent>();
  const [exportMessage, setExportMessage] = useState<string>();
  const dateFrom = parameters.get('from') ?? defaultRange.dateFrom;
  const dateTo = parameters.get('to') ?? defaultRange.dateTo;
  const branchId = parameters.get('branch') ?? '';
  const requestedEventType = parameters.get('type');
  const eventType = FINANCE_JOURNAL_EVENT_TYPES.includes(
    requestedEventType as FinanceJournalEventType,
  )
    ? (requestedEventType as FinanceJournalEventType)
    : 'ALL';
  const requestedPage = Number(parameters.get('page') ?? '1');
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const requestedPageSize = Number(parameters.get('size') ?? '50');
  const pageSize = ([25, 50, 100] as const).includes(requestedPageSize as 25 | 50 | 100)
    ? (requestedPageSize as 25 | 50 | 100)
    : 50;
  const requestedMethod = parameters.get('method');
  const selectedMethod = PAYMENT_METHODS.includes(requestedMethod as PaymentMethod)
    ? (requestedMethod as PaymentMethod)
    : undefined;
  const committedSearch = parameters.get('search') ?? '';

  const updateParameters = useCallback(
    (updates: Record<string, string>, resetPage = true) => {
      setParameters(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(updates))
            if (value) next.set(key, value);
            else next.delete(key);
          if (resetPage) next.delete('page');
          next.set('view', 'operations');
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
      if (value !== committedSearch) updateParameters({ search: value });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [committedSearch, search, updateParameters]);

  const query = useMemo<FinanceJournalQuery>(
    () => ({
      branchId: branchId || undefined,
      dateFrom,
      dateTo,
      eventType,
      page,
      pageSize,
      paymentMethod: selectedMethod,
      search: committedSearch || undefined,
    }),
    [branchId, committedSearch, dateFrom, dateTo, eventType, page, pageSize, selectedMethod],
  );
  const journal = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => getDesktopApi().finance.journal(getSessionToken(), query),
    queryKey: queryKeys.financeJournal(query),
  });
  const exportMutation = useMutation({
    mutationFn: (filter: FinanceJournalFilter) =>
      getDesktopApi().finance.exportJournal(getSessionToken(), filter),
    onSuccess: (result) => {
      setExportMessage(
        result.status === 'EMPTY'
          ? 'Нет операций для экспорта'
          : result.status === 'SAVED'
            ? 'Журнал сохранён'
            : undefined,
      );
    },
  });
  const filter: FinanceJournalFilter = {
    branchId: query.branchId,
    dateFrom,
    dateTo,
    eventType,
    paymentMethod: query.paymentMethod,
    search: query.search,
  };
  const applyPreset = (preset: Exclude<FinancePeriodPreset, 'CUSTOM'>) => {
    const range = financePeriodRange(preset);
    updateParameters({ from: range.dateFrom, preset, to: range.dateTo });
  };
  const hasFilters =
    [branchId, selectedMethod, committedSearch].some(Boolean) || eventType !== 'ALL';

  return (
    <section aria-label="Журнал финансовых операций">
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(periodLabels).map(([preset, label]) => (
              <Button
                key={preset}
                onClick={() => applyPreset(preset as Exclude<FinancePeriodPreset, 'CUSTOM'>)}
                size="small"
                variant={parameters.get('preset') === preset ? 'secondary' : 'outline'}
              >
                {label}
              </Button>
            ))}
          </div>
          <Button
            disabled={exportMutation.isPending}
            onClick={() => {
              setExportMessage(undefined);
              exportMutation.mutate(filter);
            }}
            variant="secondary"
          >
            <Download className="size-4" />
            Экспорт
          </Button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Label>
            Дата с
            <Input
              aria-label="Дата с"
              onChange={(event) => updateParameters({ from: event.target.value, preset: 'CUSTOM' })}
              type="date"
              value={dateFrom}
            />
          </Label>
          <Label>
            Дата по
            <Input
              aria-label="Дата по"
              onChange={(event) => updateParameters({ preset: 'CUSTOM', to: event.target.value })}
              type="date"
              value={dateTo}
            />
          </Label>
          <Label>
            Филиал
            <Select
              aria-label="Филиал журнала"
              onChange={(event) => updateParameters({ branch: event.target.value })}
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
            Способ
            <Select
              aria-label="Способ оплаты журнала"
              onChange={(event) => updateParameters({ method: event.target.value })}
              value={selectedMethod ?? ''}
            >
              <option value="">Все способы</option>
              {PAYMENT_METHODS.map((item) => (
                <option key={item} value={item}>
                  {t(`payment.method.${item}`)}
                </option>
              ))}
            </Select>
          </Label>
          <Label>
            Тип
            <Select
              aria-label="Тип финансовой операции"
              onChange={(event) => updateParameters({ type: event.target.value })}
              value={eventType}
            >
              {FINANCE_JOURNAL_EVENT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {eventTypeLabels[item]}
                </option>
              ))}
            </Select>
          </Label>
          <Label>
            Строк на странице
            <Select
              aria-label="Строк на странице"
              onChange={(event) => updateParameters({ size: event.target.value })}
              value={String(pageSize)}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </Select>
          </Label>
        </div>
        <label className="relative mt-3 block">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Поиск по ученику или телефону"
            className="pl-10"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по ученику или телефону"
            value={search}
          />
        </label>
        {exportMessage ? (
          <p className="mt-3 text-sm text-muted-foreground">{exportMessage}</p>
        ) : null}
        {exportMutation.isError ? (
          <p className="mt-3 text-sm text-destructive">Не удалось экспортировать журнал.</p>
        ) : null}
      </Card>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Banknote}
          label="Принято"
          loading={journal.isLoading}
          value={<Money amount={journal.data?.summary.received ?? 0} />}
        />
        <StatCard
          icon={RotateCcw}
          label="Возвращено"
          loading={journal.isLoading}
          value={<Money amount={journal.data?.summary.refunds ?? 0} />}
        />
        <StatCard
          icon={CircleDollarSign}
          label="Чистый приход"
          loading={journal.isLoading}
          value={<Money amount={journal.data?.summary.net ?? 0} />}
        />
        <StatCard
          icon={ReceiptText}
          label="Операций"
          loading={journal.isLoading}
          value={String(journal.data?.summary.operationsCount ?? 0)}
        />
      </div>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>По способам оплаты</CardTitle>
        </CardHeader>
        <CardContent>
          {journal.data?.summary.byMethod.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {journal.data.summary.byMethod.map((item) => (
                <div
                  className="flex items-center justify-between rounded-2xl border border-border px-4 py-3"
                  key={item.method}
                >
                  <span className="text-sm font-medium">{t(`payment.method.${item.method}`)}</span>
                  <Money amount={item.amount} className="font-semibold" />
                </div>
              ))}
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">Оплат по выбранным условиям нет</p>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {journal.isLoading ? <LoadingState label="Загружаем операции…" /> : null}
        {journal.isError ? (
          <ErrorState
            message="Не удалось загрузить финансовые операции. Попробуйте ещё раз."
            onRetry={() => void journal.refetch()}
            retryLabel="Повторить"
            title="Журнал временно недоступен"
          />
        ) : null}
        {!journal.isError && journal.data?.items.length === 0 ? (
          <EmptyState
            description={
              hasFilters
                ? 'Измените поиск или фильтры и попробуйте снова.'
                : 'Выберите другой период или дождитесь первой оплаты.'
            }
            icon={ReceiptText}
            title={
              hasFilters
                ? 'По выбранным фильтрам ничего не найдено'
                : 'За выбранный период операций нет'
            }
          />
        ) : null}
        {journal.data?.items.length ? (
          <div className={journal.isFetching ? 'opacity-70 transition' : 'transition'}>
            <div className="overflow-x-auto">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата и время</TableHead>
                    <TableHead>Ученик</TableHead>
                    <TableHead>Назначение</TableHead>
                    <TableHead>Филиал</TableHead>
                    <TableHead>Способ</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journal.data.items.map((event) => (
                    <TableRow
                      className="cursor-pointer"
                      key={event.id}
                      onClick={() =>
                        event.kind === 'PAYMENT'
                          ? onOpenPayment(event.paymentId)
                          : setSelected(event)
                      }
                    >
                      <TableCell>
                        {formatDate(event.occurredAt, {
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </TableCell>
                      <TableCell>
                        <button
                          className="font-semibold hover:underline"
                          onClick={(click) => {
                            click.stopPropagation();
                            void navigate(`/students/${event.studentId}`);
                          }}
                          type="button"
                        >
                          {event.studentName}
                        </button>
                      </TableCell>
                      <TableCell>{event.purpose}</TableCell>
                      <TableCell>{event.branchName}</TableCell>
                      <TableCell>{t(`payment.method.${event.method}`)}</TableCell>
                      <TableCell>
                        <Badge>{event.kind === 'REFUND' ? 'Возврат' : 'Оплачено'}</Badge>
                      </TableCell>
                      <TableCell
                        className={
                          event.kind === 'REFUND'
                            ? 'text-right font-semibold text-destructive'
                            : 'text-right font-semibold'
                        }
                      >
                        {event.kind === 'REFUND' ? '−' : ''}
                        <Money amount={event.amount} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4">
              <p className="text-sm text-muted-foreground">
                {journalPageLabel(journal.data.page, journal.data.totalPages)} · всего{' '}
                {journal.data.total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  aria-label="Предыдущая страница"
                  disabled={journal.data.page <= 1}
                  onClick={() => updateParameters({ page: String(page - 1) }, false)}
                  size="icon"
                  variant="outline"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  aria-label="Следующая страница"
                  disabled={journal.data.page >= journal.data.totalPages}
                  onClick={() => updateParameters({ page: String(page + 1) }, false)}
                  size="icon"
                  variant="outline"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Card>
      <JournalDetails
        {...(selected ? { event: selected } : {})}
        onClose={() => setSelected(undefined)}
        onOpenStudent={(studentId) => navigate(`/students/${studentId}`)}
      />
    </section>
  );
}
