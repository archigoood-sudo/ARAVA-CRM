import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from './utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    defaultVariants: {
      size: 'default',
      variant: 'primary',
    },
    variants: {
      size: {
        default: 'h-11 px-5 text-sm',
        icon: 'size-10',
        large: 'h-12 px-6 text-base',
        small: 'h-9 px-3 text-sm',
      },
      variant: {
        ghost: 'bg-transparent text-foreground hover:bg-muted',
        outline: 'border border-border bg-surface text-foreground hover:bg-muted',
        primary: 'bg-accent text-neutral-950 shadow-accent hover:bg-accent-strong',
        secondary:
          'bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950',
      },
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, size, type = 'button', variant, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ className, size, variant }))}
      type={type}
      {...props}
    />
  );
});
