import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  LoadingState,
} from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus, ShieldCheck, Sparkles, UserRoundCheck, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const statMetadata = [
  {
    accent: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
    icon: UsersRound,
    key: 'students',
    label: 'Current students',
  },
  {
    accent: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
    icon: Building2,
    key: 'branches',
    label: 'Active branches',
  },
  {
    accent: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
    icon: UserRoundCheck,
    key: 'trialStudents',
    label: 'Trial students',
  },
  {
    accent: 'bg-accent-soft text-accent-foreground dark:bg-accent/10 dark:text-accent',
    icon: ShieldCheck,
    key: 'users',
    label: 'Enabled users',
  },
] as const;

export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const stats = useQuery({
    queryFn: () => getDesktopApi().dashboard.stats(getSessionToken()),
    queryKey: queryKeys.dashboard,
  });
  const activity = useQuery({
    queryFn: () => getDesktopApi().activity.list(getSessionToken()),
    queryKey: queryKeys.activity,
  });
  const firstName = user?.fullName.split(' ')[0] ?? 'there';
  return (
    <main className="mx-auto w-full max-w-[1540px] p-9 pb-14">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <Badge>
            <Sparkles className="mr-1 size-3" />
            Sprint 1 workspace
          </Badge>
          <h2 className="mt-3 text-4xl font-semibold tracking-[-0.045em]">
            Good morning, {firstName}.
          </h2>
          <p className="mt-2.5 text-base text-muted-foreground">
            Here is a clear view of your studio community today.
          </p>
        </div>
        {user?.role !== 'COACH' ? (
          <Button onClick={() => navigate('/students')}>
            <Plus className="size-4" />
            Add student
          </Button>
        ) : null}
      </div>
      {stats.isError ? (
        <Card>
          <ErrorState
            message="Dashboard metrics could not be loaded."
            onRetry={() => void stats.refetch()}
          />
        </Card>
      ) : (
        <section aria-label="Studio summary" className="grid grid-cols-4 gap-4">
          {statMetadata.map(({ accent, icon: Icon, key, label }) => (
            <Card className="min-w-0" key={key}>
              <CardContent className="p-5">
                <span className={`flex size-10 items-center justify-center rounded-xl ${accent}`}>
                  <Icon className="size-[19px]" />
                </span>
                <p className="mt-7 text-3xl font-semibold tracking-[-0.04em]">
                  {stats.isLoading ? '—' : (stats.data?.[key] ?? 0)}
                </p>
                <p className="mt-1.5 text-sm text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
      <section className="mt-5 grid grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)] gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Workspace focus</CardTitle>
            <p className="text-sm text-muted-foreground">Your operational foundation is ready.</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <button
                className="rounded-2xl border border-border bg-background p-6 text-left transition hover:border-neutral-400"
                onClick={() => navigate('/students')}
                type="button"
              >
                <UsersRound className="size-5 text-accent-foreground dark:text-accent" />
                <p className="mt-5 font-semibold">Student directory</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Search profiles and keep family contacts close.
                </p>
              </button>
              <button
                className="rounded-2xl border border-border bg-background p-6 text-left transition hover:border-neutral-400"
                onClick={() => navigate('/branches')}
                type="button"
              >
                <Building2 className="size-5 text-accent-foreground dark:text-accent" />
                <p className="mt-5 font-semibold">Branch network</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Organize locations and access boundaries.
                </p>
              </button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <p className="text-sm text-muted-foreground">Latest local workspace events.</p>
          </CardHeader>
          <CardContent>
            {activity.isLoading ? <LoadingState /> : null}
            {activity.data?.map((item) => (
              <article
                className="flex gap-3 border-b border-border py-4 last:border-0"
                key={item.id}
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-foreground">
                  <Sparkles className="size-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                </div>
              </article>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
