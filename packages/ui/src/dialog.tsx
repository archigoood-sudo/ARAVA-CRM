import { X } from 'lucide-react';
import { useEffect, type PropsWithChildren, type ReactNode } from 'react';

import { cn } from './utils';

export interface DialogProps extends PropsWithChildren {
  closeLabel: string;
  description?: string;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
  wide?: boolean;
}

export function Dialog({
  children,
  closeLabel,
  description,
  footer,
  onClose,
  open,
  title,
  wide,
}: DialogProps) {
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-neutral-950/45 p-6 backdrop-blur-sm"
      role="dialog"
    >
      <button
        aria-label={closeLabel}
        className="absolute inset-0"
        onClick={onClose}
        type="button"
      />
      <section
        className={cn(
          'relative z-10 max-h-[90vh] w-full animate-soft-rise overflow-y-auto rounded-3xl border border-border bg-surface shadow-elevated',
          wide ? 'max-w-3xl' : 'max-w-xl',
        )}
      >
        <header className="flex items-start justify-between gap-6 border-b border-border px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.025em]">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <button
            aria-label={closeLabel}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="p-6">{children}</div>
        {footer ? <footer className="border-t border-border px-6 py-4">{footer}</footer> : null}
      </section>
    </div>
  );
}
