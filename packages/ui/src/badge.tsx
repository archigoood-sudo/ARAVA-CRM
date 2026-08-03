import { type HTMLAttributes } from 'react';

import { cn } from './utils';

export type BadgeProps = HTMLAttributes<HTMLSpanElement>;

export function Badge({ className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent-foreground',
        className,
      )}
      {...props}
    />
  );
}
