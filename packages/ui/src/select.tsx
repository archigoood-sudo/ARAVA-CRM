import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from './utils';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...properties }, reference) => (
    <select
      className={cn(
        'h-11 w-full appearance-none rounded-xl border border-border bg-surface px-3.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:border-accent dark:focus:ring-accent/10',
        className,
      )}
      ref={reference}
      {...properties}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
