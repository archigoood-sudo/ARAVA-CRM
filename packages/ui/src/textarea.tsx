import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from './utils';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...properties }, reference) => (
    <textarea
      className={cn(
        'min-h-24 w-full resize-y rounded-xl border border-border bg-surface px-3.5 py-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-900/5 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:border-accent dark:focus:ring-accent/10',
        className,
      )}
      ref={reference}
      {...properties}
    />
  ),
);
Textarea.displayName = 'Textarea';
