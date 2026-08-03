import type {
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

import { cn } from './utils';

export function Table({ className, ...properties }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cn('w-full border-collapse text-left text-sm', className)} {...properties} />
  );
}

export function TableHeader({ className, ...properties }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn('border-b border-border bg-background/70', className)} {...properties} />
  );
}

export function TableBody({ className, ...properties }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border', className)} {...properties} />;
}

export function TableRow({ className, ...properties }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition hover:bg-muted/45', className)} {...properties} />;
}

export function TableHead({ className, ...properties }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'h-11 px-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground',
        className,
      )}
      {...properties}
    />
  );
}

export function TableCell({ className, ...properties }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3.5 align-middle', className)} {...properties} />;
}
