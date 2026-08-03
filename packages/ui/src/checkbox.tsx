import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './utils';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...properties }, reference) => (
    <input
      className={cn(
        'size-4 rounded border-border accent-[#9CFF2E] outline-none focus:ring-2 focus:ring-accent/40',
        className,
      )}
      ref={reference}
      type="checkbox"
      {...properties}
    />
  ),
);
Checkbox.displayName = 'Checkbox';
