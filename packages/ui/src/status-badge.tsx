import { type HTMLAttributes } from 'react';

import { cn } from './utils';

export type StatusTone = 'accent' | 'danger' | 'info' | 'muted' | 'success' | 'warning';

const tones: Record<StatusTone, string> = {
  accent: 'bg-accent-soft text-accent-foreground dark:bg-accent/10 dark:text-accent',
  danger: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  muted: 'bg-muted text-muted-foreground',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
};

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
}

export function StatusBadge({ className, tone = 'muted', ...properties }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
        tones[tone],
        className,
      )}
      {...properties}
    />
  );
}
