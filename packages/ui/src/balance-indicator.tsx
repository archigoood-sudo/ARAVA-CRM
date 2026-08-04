import { AlertCircle, CheckCircle2 } from 'lucide-react';

import { cn } from './utils';

export interface BalanceIndicatorProps {
  label: string;
  tone?: 'danger' | 'neutral' | 'success' | 'warning';
  value: string;
}

const tones = {
  danger:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300',
  neutral: 'border-border bg-muted/50 text-foreground',
  success:
    'border-green-200 bg-green-50 text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
};

export function BalanceIndicator({ label, tone = 'neutral', value }: BalanceIndicatorProps) {
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-xs', tones[tone])}>
      <Icon className="size-3.5 shrink-0" />
      <span className="font-medium">{label}</span>
      <span className="ml-auto font-semibold tabular-nums">{value}</span>
    </div>
  );
}
