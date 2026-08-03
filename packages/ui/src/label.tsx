import { forwardRef, type LabelHTMLAttributes } from 'react';

import { cn } from './utils';

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn('text-sm font-semibold leading-none text-foreground', className)}
      {...props}
    />
  );
});
