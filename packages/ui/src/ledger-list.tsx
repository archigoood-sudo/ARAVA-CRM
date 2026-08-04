import { ArrowDownLeft, ArrowUpRight, Snowflake } from 'lucide-react';

import { cn } from './utils';

export interface LedgerListItem {
  caption: string;
  date: string;
  delta?: string | undefined;
  id: string;
  kind: 'credit' | 'debit' | 'neutral';
  title: string;
}

export function LedgerList({ items }: { items: LedgerListItem[] }) {
  return (
    <div className="divide-y divide-border">
      {items.map((item) => {
        const Icon =
          item.kind === 'credit' ? ArrowDownLeft : item.kind === 'debit' ? ArrowUpRight : Snowflake;
        return (
          <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={item.id}>
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-xl',
                item.kind === 'credit' && 'bg-green-50 text-green-600 dark:bg-green-500/10',
                item.kind === 'debit' && 'bg-amber-50 text-amber-600 dark:bg-amber-500/10',
                item.kind === 'neutral' && 'bg-blue-50 text-blue-600 dark:bg-blue-500/10',
              )}
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{item.title}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {item.caption}
              </span>
            </span>
            <span className="text-right">
              {item.delta ? (
                <span className="block text-sm font-semibold tabular-nums">{item.delta}</span>
              ) : null}
              <span className="block text-xs text-muted-foreground">{item.date}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
