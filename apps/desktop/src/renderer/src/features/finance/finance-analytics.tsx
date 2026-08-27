import {
  formatDate,
  t,
  type BranchSummary,
  type FinanceAnalyticsOverview,
  type FinanceAnalyticsQuery,
} from '@arava/shared';
import {
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
  Money,
  Select,
  StatCard,
} from '@arava/ui';
import {
  Banknote,
  CalendarRange,
  CreditCard,
  ReceiptText,
  RotateCcw,
  ShoppingBag,
  WalletCards,
} from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken } from '../../stores/auth-store';
import {
  financeAnalyticsChange,
  financeAnalyticsPeriod,
  type FinanceAnalyticsPreset,
} from './finance-analytics-model';

const presetLabels: Record<FinanceAnalyticsPreset, string> = {
  CUSTOM: 'Произвольный период',
  PREVIOUS_MONTH: 'Прошлый месяц',
  SEVEN_DAYS: '7 дней',
  THIRTY_DAYS: '30 дней',
  THIS_MONTH: 'Этот месяц',
  THREE_MONTHS: '3 месяца',
};

function Comparison({ current, previous }: { current: number; previous: number }) {
  const change = financeAnalyticsChange(current, previous);
  if (change === undefined)
    return <span className="text-xs text-muted-foreground">В прошлом периоде оплат не было</span>;
  return (
    <span className={change < 0 ? 'text-xs text-destructive' : 'text-xs text-emerald-700'}>
      {change > 0 ? '+' : ''}
      {change}% к предыдущему периоду
    </span>
  );
}

function DailyChart({ overview }: { overview: FinanceAnalyticsOverview }) {
  const maximum = Math.max(1, ...overview.daily.map(({ net }) => Math.abs(net)));
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-semibold">Чистый приход по дням</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Оплаты минус возвраты в дату операции
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {formatDate(overview.dateFrom, { dateStyle: 'medium' })} —{' '}
            {formatDate(overview.dateTo, { dateStyle: 'medium' })}
          </span>
        </div>
        <div className="space-y-2">
          {overview.daily.map((point) => (
            <div
              className="grid grid-cols-[72px_minmax(120px,1fr)_110px] items-center gap-3"
              key={point.date}
            >
              <span className="text-xs text-muted-foreground">
                {formatDate(point.date, { day: '2-digit', month: '2-digit' })}
              </span>
              <div className="relative h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${point.net < 0 ? 'bg-destructive' : 'bg-accent'}`}
                  style={{ width: `${String((Math.abs(point.net) / maximum) * 100)}%` }}
                />
              </div>
              <Money amount={point.net} className="text-right text-sm font-semibold" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function FinanceAnalytics({ branches }: { branches: BranchSummary[] }) {
  const navigate = useNavigate();
  const [parameters, setParameters] = useSearchParams();
  const requestedPreset = parameters.get('analyticsPreset') as FinanceAnalyticsPreset | null;
  const preset = requestedPreset && presetLabels[requestedPreset] ? requestedPreset : 'THIS_MONTH';
  const defaultRange = useMemo(() => financeAnalyticsPeriod('THIS_MONTH'), []);
  const dateFrom = parameters.get('analyticsFrom') ?? defaultRange.dateFrom;
  const dateTo = parameters.get('analyticsTo') ?? defaultRange.dateTo;
  const branchId = parameters.get('analyticsBranch') ?? '';
  const query: FinanceAnalyticsQuery = {
    ...(branchId ? { branchId } : {}),
    dateFrom,
    dateTo,
  };
  const analytics = useQuery({
    queryFn: () => getDesktopApi().finance.analytics(getSessionToken(), query),
    queryKey: queryKeys.financeAnalytics(query),
  });
  const update = (values: Record<string, string>) =>
    setParameters((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values))
        if (value) next.set(key, value);
        else next.delete(key);
      return next;
    });
  const selectPreset = (value: FinanceAnalyticsPreset) => {
    if (value === 'CUSTOM') {
      update({ analyticsPreset: value });
      return;
    }
    const range = financeAnalyticsPeriod(value);
    update({
      analyticsFrom: range.dateFrom,
      analyticsPreset: value,
      analyticsTo: range.dateTo,
    });
  };
  const openJournal = (eventType = 'ALL') =>
    navigate(
      `/finance?view=operations&from=${dateFrom}&to=${dateTo}&type=${eventType}${branchId ? `&branch=${branchId}` : ''}`,
    );

  return (
    <section className="space-y-5" data-testid="finance-analytics">
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <Label>
            Период
            <Select
              aria-label="Период аналитики"
              className="mt-2"
              onChange={(event) => selectPreset(event.target.value as FinanceAnalyticsPreset)}
              value={preset}
            >
              {Object.entries(presetLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Label>
          <Label>
            С
            <Input
              aria-label="Начало периода аналитики"
              className="mt-2"
              onChange={(event) =>
                update({ analyticsFrom: event.target.value, analyticsPreset: 'CUSTOM' })
              }
              type="date"
              value={dateFrom}
            />
          </Label>
          <Label>
            По
            <Input
              aria-label="Конец периода аналитики"
              className="mt-2"
              onChange={(event) =>
                update({ analyticsPreset: 'CUSTOM', analyticsTo: event.target.value })
              }
              type="date"
              value={dateTo}
            />
          </Label>
          <Label>
            Филиал
            <Select
              aria-label="Филиал аналитики"
              className="mt-2"
              onChange={(event) => update({ analyticsBranch: event.target.value })}
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
        </CardContent>
      </Card>

      {analytics.isLoading ? <LoadingState label="Собираем финансовую аналитику…" /> : null}
      {analytics.isError ? (
        <ErrorState
          message="Не удалось загрузить финансовую аналитику."
          onRetry={() => void analytics.refetch()}
          retryLabel="Повторить"
          title="Аналитика временно недоступна"
        />
      ) : null}
      {analytics.data ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              icon={Banknote}
              label="Получено"
              value={
                <button className="text-left" onClick={() => openJournal('PAYMENT')} type="button">
                  <Money amount={analytics.data.current.received} />
                  <span className="mt-1 block">
                    <Comparison
                      current={analytics.data.current.received}
                      previous={analytics.data.previous.received}
                    />
                  </span>
                </button>
              }
            />
            <StatCard
              icon={RotateCcw}
              label="Возвращено"
              value={
                <button className="text-left" onClick={() => openJournal('REFUND')} type="button">
                  <Money amount={analytics.data.current.refunds} />
                </button>
              }
            />
            <StatCard
              icon={ReceiptText}
              label="Чистый приход"
              value={
                <span>
                  <Money amount={analytics.data.current.net} />
                  <span className="mt-1 block">
                    <Comparison
                      current={analytics.data.current.net}
                      previous={analytics.data.previous.net}
                    />
                  </span>
                </span>
              }
            />
            <StatCard
              icon={CreditCard}
              label="Средний платёж"
              value={<Money amount={analytics.data.current.averagePayment} />}
            />
            <StatCard
              icon={ShoppingBag}
              label="Продано абонементов"
              value={`${String(analytics.data.current.subscriptionSales.count)} · ${analytics.data.current.subscriptionSales.value.toLocaleString('ru-RU')} ₽`}
            />
            <StatCard
              icon={WalletCards}
              label="Текущая задолженность"
              value={
                <button
                  className="text-left"
                  onClick={() => navigate('/finance?view=debts')}
                  type="button"
                >
                  <Money amount={analytics.data.aging.currentDebt} />
                </button>
              }
            />
          </section>

          {analytics.data.current.paymentCount === 0 && analytics.data.current.refunds === 0 ? (
            <EmptyState
              description="Выберите другой период или филиал."
              icon={CalendarRange}
              title="За выбранный период финансовых операций нет"
            />
          ) : (
            <DailyChart overview={analytics.data} />
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold">Способы оплаты</h3>
                <div className="mt-4 space-y-3">
                  {analytics.data.byMethod.map((method) => (
                    <div className="flex items-center justify-between gap-4" key={method.method}>
                      <span className="text-sm">{t(`payment.method.${method.method}`)}</span>
                      <span className="text-right text-sm font-semibold">
                        <Money amount={method.amount} /> · {method.count}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  Разовых посещений: {analytics.data.current.directAttendance.count} на{' '}
                  <Money amount={analytics.data.current.directAttendance.amount} />
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold">Возраст текущей задолженности</h3>
                <div className="mt-4 space-y-3">
                  {analytics.data.aging.buckets.map((bucket) => (
                    <div className="flex items-center justify-between gap-4" key={bucket.key}>
                      <span className="text-sm">
                        {bucket.key === 'DAYS_0_7'
                          ? '0–7 дней'
                          : bucket.key === 'DAYS_8_30'
                            ? '8–30 дней'
                            : '31+ дней'}
                      </span>
                      <span className="text-right text-sm font-semibold">
                        <Money amount={bucket.amount} /> · {bucket.debtorCount}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  Непрооценённых посещений: {analytics.data.aging.unvaluedAttendanceCount}
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </section>
  );
}
