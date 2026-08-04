import type { HTMLAttributes } from 'react';

import { formatMoney } from './money-format';
import { cn } from './utils';

export interface MoneyProps extends HTMLAttributes<HTMLSpanElement> {
  amount: number;
  currency?: string | undefined;
}

export function Money({ amount, className, currency = 'RUB', ...properties }: MoneyProps) {
  return (
    <span className={cn('tabular-nums', className)} {...properties}>
      {formatMoney(amount, currency)}
    </span>
  );
}
