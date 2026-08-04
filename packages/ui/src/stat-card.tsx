import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardContent } from './card';
import { cn } from './utils';

export function StatCard({
  className,
  icon: Icon,
  label,
  loading,
  value,
}: {
  className?: string;
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  value: ReactNode;
}) {
  return (
    <Card className={cn('group min-w-0 overflow-hidden', className)}>
      <CardContent className="relative p-5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-foreground transition-transform duration-200 group-hover:-translate-y-0.5 dark:bg-accent/10 dark:text-accent">
          <Icon className="size-[19px]" />
        </span>
        <p className="mt-7 text-3xl font-semibold tracking-[-0.04em]">
          {loading ? '—' : typeof value === 'number' ? value.toLocaleString('ru-RU') : value}
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
