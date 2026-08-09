import type { AnalyticsMetric, AnalyticsQuery } from '@arava/shared';
import {
  Card,
  ErrorState,
  Input,
  Label,
  MiniBarChart,
  Money,
  PageHeader,
  Select,
  StatCard,
} from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Banknote,
  CalendarCheck,
  CircleDollarSign,
  PiggyBank,
  TrendingDown,
  UsersRound,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDesktopApi } from '../../lib/desktop-api';
import { getSessionToken } from '../../stores/auth-store';

function dateInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
function Change({ value }: { value: number | undefined }) {
  return (
    <span className={value !== undefined && value < 0 ? 'text-destructive' : 'text-success'}>
      {value === undefined ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString('ru-RU')}%`}
    </span>
  );
}
function MetricCard({
  label,
  metric,
  money = false,
}: {
  label: string;
  metric: AnalyticsMetric | undefined;
  money?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Change value={metric?.changePercent} />
      </div>
      <p className="mt-5 text-3xl font-semibold">
        {money ? (
          <Money amount={metric?.current ?? 0} />
        ) : (
          (metric?.current ?? 0).toLocaleString('ru-RU')
        )}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Предыдущий период:{' '}
        {money ? (
          <Money amount={metric?.previous ?? 0} />
        ) : (
          (metric?.previous ?? 0).toLocaleString('ru-RU')
        )}
      </p>
    </Card>
  );
}

export function AnalyticsPage() {
  const now = new Date();
  const [dateFrom, setDateFrom] = useState(
    dateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
  );
  const [dateTo, setDateTo] = useState(dateInput(now));
  const [branchId, setBranchId] = useState('');
  const query = useMemo<AnalyticsQuery>(
    () => ({
      branchId: branchId || undefined,
      dateFrom: new Date(`${dateFrom}T00:00:00`).toISOString(),
      dateTo: new Date(`${dateTo}T23:59:59`).toISOString(),
    }),
    [branchId, dateFrom, dateTo],
  );
  const analytics = useQuery({
    queryFn: () => getDesktopApi().analytics.get(getSessionToken(), query),
    queryKey: ['analytics', query],
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: ['branches'],
  });
  return (
    <main className="mx-auto w-full max-w-[1540px] animate-fade-in p-9 pb-14">
      <PageHeader
        description="Реальные финансовые и операционные показатели с сопоставлением периодов."
        title="Управленческая аналитика"
      />
      <Card className="mb-5 grid grid-cols-3 gap-3 p-4">
        <Label>
          Филиал
          <Select onChange={(event) => setBranchId(event.target.value)} value={branchId}>
            <option value="">Все филиалы</option>
            {branches.data?.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Label>
        <Label>
          С даты
          <Input
            onChange={(event) => setDateFrom(event.target.value)}
            type="date"
            value={dateFrom}
          />
        </Label>
        <Label>
          По дату
          <Input onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} />
        </Label>
      </Card>
      {analytics.isError ? (
        <ErrorState
          message="Проверьте выбранный период и права доступа."
          retryLabel="Повторить"
          title="Не удалось загрузить аналитику"
        />
      ) : (
        <>
          <section className="grid grid-cols-4 gap-4">
            <StatCard
              icon={CircleDollarSign}
              label="Выручка"
              loading={analytics.isLoading}
              value={<Money amount={analytics.data?.revenue.current ?? 0} />}
            />
            <StatCard
              icon={TrendingDown}
              label="Расходы"
              loading={analytics.isLoading}
              value={<Money amount={analytics.data?.expenses.current ?? 0} />}
            />
            <StatCard
              icon={PiggyBank}
              label="Чистая прибыль"
              loading={analytics.isLoading}
              value={<Money amount={analytics.data?.netProfit.current ?? 0} />}
            />
            <StatCard
              icon={Banknote}
              label="Начислено зарплаты"
              loading={analytics.isLoading}
              value={<Money amount={analytics.data?.payrollAccrued.current ?? 0} />}
            />
          </section>
          <section className="mt-4 grid grid-cols-4 gap-4">
            <MetricCard label="Средний платёж" metric={analytics.data?.averagePayment} money />
            <MetricCard label="Задолженность" metric={analytics.data?.outstandingDebt} money />
            <MetricCard label="Активные ученики" metric={analytics.data?.activeStudents} />
            <MetricCard label="Новые ученики" metric={analytics.data?.newStudents} />
            <MetricCard label="Выбывшие ученики" metric={analytics.data?.churnedStudents} />
            <MetricCard label="Посещаемость, %" metric={analytics.data?.attendancePercentage} />
            <MetricCard label="Заполняемость групп, %" metric={analytics.data?.groupOccupancy} />
            <MetricCard label="Занятий тренеров" metric={analytics.data?.coachWorkload} />
          </section>
          <section className="mt-5 grid grid-cols-2 gap-5">
            <Card className="p-6">
              <div className="mb-6 flex items-center gap-3">
                <span className="rounded-xl bg-accent-soft p-2.5">
                  <CalendarCheck className="size-5" />
                </span>
                <div>
                  <h2 className="font-semibold">Выручка по филиалам</h2>
                  <p className="text-sm text-muted-foreground">
                    Без отменённых платежей и с учётом возвратов
                  </p>
                </div>
              </div>
              <MiniBarChart
                items={
                  analytics.data?.breakdown.map((item) => ({
                    label: item.label,
                    value: item.revenue,
                  })) ?? []
                }
                valueFormatter={(value) => `${(value / 100).toLocaleString('ru-RU')} ₽`}
              />
            </Card>
            <Card className="p-6">
              <div className="mb-6 flex items-center gap-3">
                <span className="rounded-xl bg-accent-soft p-2.5">
                  <UsersRound className="size-5" />
                </span>
                <div>
                  <h2 className="font-semibold">Заполняемость филиалов</h2>
                  <p className="text-sm text-muted-foreground">
                    Средняя доля занятых мест в активных группах
                  </p>
                </div>
              </div>
              <MiniBarChart
                items={
                  analytics.data?.breakdown.map((item) => ({
                    label: item.label,
                    value: item.groupOccupancy,
                  })) ?? []
                }
                valueFormatter={(value) => `${value.toLocaleString('ru-RU')}%`}
              />
            </Card>
          </section>
        </>
      )}
    </main>
  );
}
