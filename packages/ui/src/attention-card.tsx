import type { ReactNode } from 'react';

import { cn } from './utils';

const toneStyles = {
  critical: 'border-red-200 bg-red-50/70 dark:border-red-500/20 dark:bg-red-500/5',
  info: 'border-blue-200 bg-blue-50/70 dark:border-blue-500/20 dark:bg-blue-500/5',
  warning: 'border-amber-200 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-500/5',
};

export function AttentionCard({
  action,
  description,
  icon,
  meta,
  title,
  tone,
}: {
  action?: ReactNode;
  description: string;
  icon?: ReactNode;
  meta?: ReactNode;
  title: string;
  tone: keyof typeof toneStyles;
}) {
  return (
    <article className={cn('rounded-2xl border p-4 shadow-subtle', toneStyles[tone])}>
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-foreground shadow-sm dark:bg-white/10">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold tracking-[-0.01em]">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          {meta ? <div className="mt-2 text-xs text-muted-foreground">{meta}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </article>
  );
}
