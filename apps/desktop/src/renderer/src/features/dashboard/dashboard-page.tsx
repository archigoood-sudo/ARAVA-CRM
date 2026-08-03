import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  ContactRound,
  MoreHorizontal,
  Plus,
  Sparkles,
  Target,
} from 'lucide-react';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { useAuthStore } from '../../stores/auth-store';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  maximumFractionDigits: 0,
  style: 'currency',
});

const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: 'compact',
});

const statMetadata = [
  {
    accent: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
    icon: ContactRound,
    key: 'contacts',
    label: 'Total contacts',
  },
  {
    accent: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
    icon: Building2,
    key: 'companies',
    label: 'Companies',
  },
  {
    accent: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
    icon: Target,
    key: 'openOpportunities',
    label: 'Open opportunities',
  },
  {
    accent: 'bg-accent-soft text-accent-foreground dark:bg-accent/10 dark:text-accent',
    icon: CircleDollarSign,
    key: 'pipelineValue',
    label: 'Pipeline value',
  },
] as const;

const pipelineStages = [
  { color: 'bg-neutral-900 dark:bg-neutral-200', label: 'Lead', value: 34 },
  { color: 'bg-blue-500', label: 'Qualified', value: 26 },
  { color: 'bg-violet-500', label: 'Proposal', value: 22 },
  { color: 'bg-accent', label: 'Negotiation', value: 18 },
];

function formatStatValue(key: (typeof statMetadata)[number]['key'], value: number): string {
  if (key === 'pipelineValue') return currencyFormatter.format(value);
  return compactNumberFormatter.format(value);
}

function getFirstName(name: string | undefined): string {
  return name?.split(' ')[0] ?? 'there';
}

export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const statsQuery = useQuery({
    queryFn: () => getDesktopApi().dashboard.stats(),
    queryKey: queryKeys.dashboard,
  });
  const activityQuery = useQuery({
    queryFn: () => getDesktopApi().activity.list(),
    queryKey: queryKeys.activity,
  });

  return (
    <main className="mx-auto w-full max-w-[1540px] p-9 pb-14">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Badge>
              <Sparkles className="mr-1 size-3" />
              Workspace ready
            </Badge>
          </div>
          <h2 className="text-4xl font-semibold tracking-[-0.045em]">
            Good morning, {getFirstName(user?.name)}.
          </h2>
          <p className="mt-2.5 text-base text-muted-foreground">
            Here is a clear view of your customer workspace today.
          </p>
        </div>
        <Button disabled title="Contact management arrives in the next milestone">
          <Plus className="size-4" strokeWidth={2.5} />
          Add contact
        </Button>
      </div>

      <section aria-label="CRM summary" className="grid grid-cols-4 gap-4">
        {statMetadata.map(({ accent, icon: Icon, key, label }) => {
          const value = statsQuery.data?.[key] ?? 0;
          return (
            <Card className="min-w-0" key={key}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <span className={`flex size-10 items-center justify-center rounded-xl ${accent}`}>
                    <Icon className="size-[19px]" />
                  </span>
                  <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <ArrowUpRight className="size-3.5" />
                    Ready
                  </span>
                </div>
                <p className="mt-7 text-3xl font-semibold tracking-[-0.04em]">
                  {statsQuery.isLoading ? '—' : formatStatValue(key, value)}
                </p>
                <p className="mt-1.5 text-sm text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="mt-5 grid grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)] gap-5">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Pipeline overview</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Distribution across active stages
              </p>
            </div>
            <button
              aria-label="Pipeline options"
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
              type="button"
            >
              <MoreHorizontal className="size-5" />
            </button>
          </CardHeader>
          <CardContent>
            <div className="rounded-2xl bg-background p-5">
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                {pipelineStages.map((stage) => (
                  <div
                    className={`${stage.color} first:rounded-l-full last:rounded-r-full`}
                    key={stage.label}
                    style={{ width: `${String(stage.value)}%` }}
                  />
                ))}
              </div>
              <div className="mt-6 grid grid-cols-4 gap-4">
                {pipelineStages.map((stage) => (
                  <div key={stage.label}>
                    <div className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${stage.color}`} />
                      <span className="text-xs font-medium text-muted-foreground">
                        {stage.label}
                      </span>
                    </div>
                    <p className="mt-2 text-xl font-semibold tracking-tight">{stage.value}%</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-medium text-muted-foreground">Average deal size</p>
                <div className="mt-2 flex items-end justify-between">
                  <p className="text-2xl font-semibold tracking-tight">$0</p>
                  <span className="flex items-center text-xs font-semibold text-muted-foreground">
                    <ArrowDownRight className="mr-1 size-3.5" /> New workspace
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-medium text-muted-foreground">Win rate</p>
                <div className="mt-2 flex items-end justify-between">
                  <p className="text-2xl font-semibold tracking-tight">—</p>
                  <span className="text-xs font-semibold text-muted-foreground">
                    No closed deals yet
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Recent activity</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Latest workspace events</p>
            </div>
            <span className="size-2 rounded-full bg-accent shadow-[0_0_0_5px_rgba(156,255,46,0.12)]" />
          </CardHeader>
          <CardContent>
            {activityQuery.isLoading ? (
              <div className="space-y-4">
                {[0, 1, 2].map((item) => (
                  <div className="h-16 animate-pulse rounded-xl bg-muted" key={item} />
                ))}
              </div>
            ) : null}

            {activityQuery.isError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                Activity could not be loaded. Restart ARAVA CRM and try again.
              </div>
            ) : null}

            <div className="space-y-1">
              {activityQuery.data?.map((activity) => (
                <article className="flex gap-3 rounded-xl px-2 py-3" key={activity.id}>
                  <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-foreground dark:bg-accent/10 dark:text-accent">
                    <Sparkles className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{activity.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {activity.detail}
                    </p>
                    <time className="mt-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {new Intl.DateTimeFormat('en', {
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        month: 'short',
                      }).format(new Date(activity.createdAt))}
                    </time>
                  </div>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
