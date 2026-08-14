import type {
  AttentionCategory,
  AttentionFilters,
  AttentionItem,
  AttentionSeverity,
} from '@arava/shared';
import { formatDate } from '@arava/shared';
import {
  AttentionCard,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Select,
} from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import {
  BellRing,
  CalendarCheck,
  ChevronRight,
  CreditCard,
  DoorClosed,
  HandCoins,
  IdCard,
  RefreshCw,
  UserRoundCog,
  UsersRound,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const categories: { icon: typeof BellRing; label: string; value: AttentionCategory }[] = [
  { icon: UsersRound, label: 'Ученики', value: 'STUDENTS' },
  { icon: CreditCard, label: 'Абонементы', value: 'SUBSCRIPTIONS' },
  { icon: HandCoins, label: 'Оплаты', value: 'PAYMENTS' },
  { icon: CalendarCheck, label: 'Посещаемость', value: 'ATTENDANCE' },
  { icon: HandCoins, label: 'Зарплата', value: 'PAYROLL' },
  { icon: IdCard, label: 'Карты', value: 'CARDS' },
  { icon: CalendarCheck, label: 'Расписание', value: 'SCHEDULE' },
  { icon: DoorClosed, label: 'Залы', value: 'ROOMS' },
  { icon: UserRoundCog, label: 'Замены', value: 'SUBSTITUTIONS' },
];

const severityLabels: Record<AttentionSeverity, string> = {
  CRITICAL: 'Критично',
  INFO: 'Информация',
  WARNING: 'Предупреждение',
};

function tone(severity: AttentionSeverity): 'critical' | 'info' | 'warning' {
  return severity === 'CRITICAL' ? 'critical' : severity === 'INFO' ? 'info' : 'warning';
}

function categoryIcon(category: AttentionCategory) {
  const Icon = categories.find(({ value }) => value === category)?.icon ?? BellRing;
  return <Icon className="size-4" />;
}

function itemMeta(item: AttentionItem) {
  return [
    item.branchName,
    item.dueAt ? formatDate(item.dueAt, { day: 'numeric', month: 'long', year: 'numeric' }) : '',
    severityLabels[item.severity],
  ]
    .filter(Boolean)
    .join(' · ');
}

export function AttentionPage() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [branchId, setBranchId] = useState(searchParams.get('branchId') ?? '');
  const [category, setCategory] = useState<AttentionCategory | ''>(
    (searchParams.get('category') as AttentionCategory | null) ?? '',
  );
  const [severity, setSeverity] = useState<AttentionSeverity | ''>(
    (searchParams.get('severity') as AttentionSeverity | null) ?? '',
  );
  const [relevance, setRelevance] = useState<'ALL' | 'TODAY' | 'UPCOMING'>('ALL');
  const filters = useMemo<AttentionFilters>(
    () => ({
      branchId: branchId || undefined,
      category: category || undefined,
      relevance,
      severity: severity || undefined,
    }),
    [branchId, category, relevance, severity],
  );
  const items = useQuery({
    queryFn: () => getDesktopApi().attention.list(getSessionToken(), filters),
    queryKey: queryKeys.attention(filters),
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const summary = useQuery({
    queryFn: () => getDesktopApi().attention.summary(getSessionToken()),
    queryKey: queryKeys.attentionSummary(user?.id),
  });

  if (user?.role === 'COACH') return <Navigate replace to="/dashboard" />;

  return (
    <main className="mx-auto w-full max-w-[1480px] animate-fade-in p-9 pb-14">
      <PageHeader
        description="Операционные задачи, которые требуют решения сегодня или в ближайшее время."
        eyebrow="Операционный центр"
        title="Требует внимания"
      />

      <Card className="mt-7">
        <CardContent className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-3 p-4">
          <Select
            aria-label="Филиал"
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
          <Select
            aria-label="Категория"
            onChange={(event) => setCategory(event.target.value as AttentionCategory | '')}
            value={category}
          >
            <option value="">Все категории</option>
            {categories.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Важность"
            onChange={(event) => setSeverity(event.target.value as AttentionSeverity | '')}
            value={severity}
          >
            <option value="">Любая важность</option>
            <option value="CRITICAL">Критично</option>
            <option value="WARNING">Предупреждение</option>
            <option value="INFO">Информация</option>
          </Select>
          <Select
            aria-label="Актуальность"
            onChange={(event) => setRelevance(event.target.value as 'ALL' | 'TODAY' | 'UPCOMING')}
            value={relevance}
          >
            <option value="ALL">Все актуальные</option>
            <option value="TODAY">Сегодня и просроченные</option>
            <option value="UPCOMING">Предстоящие</option>
          </Select>
          <Button onClick={() => void items.refetch()} variant="secondary">
            <RefreshCw className="size-4" /> Обновить
          </Button>
        </CardContent>
      </Card>

      {items.isLoading ? (
        <Card className="mt-5">
          <LoadingState label="Проверяем операционные задачи…" />
        </Card>
      ) : null}
      {items.isError ? (
        <Card className="mt-5">
          <ErrorState
            title="Не удалось загрузить центр внимания"
            message="Повторите попытку. Если ошибка сохраняется, проверьте доступ к базе данных."
            retryLabel="Повторить"
            onRetry={() => void items.refetch()}
          />
        </Card>
      ) : null}
      {items.data?.length === 0 ? (
        <Card className="mt-5">
          <EmptyState
            icon={BellRing}
            title="Всё в порядке"
            description="По выбранным фильтрам нет задач, требующих внимания."
          />
        </Card>
      ) : null}

      {items.data?.length ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="h-fit rounded-3xl border border-border bg-surface p-3 shadow-subtle">
            <button
              className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${category === '' ? 'bg-sidebar text-white' : 'hover:bg-muted'}`}
              onClick={() => setCategory('')}
              type="button"
            >
              Все задачи{' '}
              <Badge className={category === '' ? 'bg-white/10 text-white' : ''}>
                {summary.data?.total ?? items.data.length}
              </Badge>
            </button>
            {categories.map(({ icon: Icon, label, value }) => {
              const count =
                summary.data?.categories.find((item) => item.category === value)?.count ?? 0;
              if (!count && category !== value) return null;
              return (
                <button
                  className={`mt-1 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${category === value ? 'bg-accent text-neutral-950' : 'hover:bg-muted'}`}
                  key={value}
                  onClick={() => setCategory(value)}
                  type="button"
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{label}</span>
                  <span className="text-xs font-semibold">{count}</span>
                </button>
              );
            })}
          </aside>
          <section aria-label="Список задач" className="space-y-3">
            {items.data.map((item) => (
              <AttentionCard
                action={
                  <Button
                    onClick={() => navigate(item.actionRoute)}
                    size="small"
                    variant="secondary"
                  >
                    {item.actionLabel}
                    <ChevronRight className="size-4" />
                  </Button>
                }
                description={item.description}
                icon={categoryIcon(item.category)}
                key={item.id}
                meta={itemMeta(item)}
                title={item.title}
                tone={tone(item.severity)}
              />
            ))}
          </section>
        </div>
      ) : null}
    </main>
  );
}
