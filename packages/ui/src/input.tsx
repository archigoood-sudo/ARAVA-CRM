import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './utils';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-neutral-400 focus:ring-4 focus:ring-neutral-950/5 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:border-neutral-600 dark:focus:ring-white/5',
        className,
      )}
      {...props}
    />
  );
});
