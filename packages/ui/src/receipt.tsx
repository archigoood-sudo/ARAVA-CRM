import type { ReactNode } from 'react';

import { cn } from './utils';

export interface ReceiptRow {
  label: string;
  value: ReactNode;
}

export function Receipt({
  footer,
  rows,
  title,
}: {
  footer?: ReactNode;
  rows: ReceiptRow[];
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-background">
      <div className="border-b border-dashed border-border px-5 py-4">
        <h3 className="text-lg font-semibold tracking-[-0.02em]">{title}</h3>
      </div>
      <dl className="space-y-3 px-5 py-4">
        {rows.map((row) => (
          <div className="flex items-start justify-between gap-5 text-sm" key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
      {footer ? (
        <div className={cn('border-t border-dashed border-border px-5 py-4')}>{footer}</div>
      ) : null}
    </section>
  );
}
