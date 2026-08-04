import { type ReactNode } from 'react';

import { Avatar } from './avatar';
import { cn } from './utils';

export interface ParticipantRowProps {
  actions?: ReactNode;
  className?: string;
  detail?: ReactNode;
  name: string;
  trailing?: ReactNode;
}

export function ParticipantRow({
  actions,
  className,
  detail,
  name,
  trailing,
}: ParticipantRowProps) {
  return (
    <div
      className={cn(
        'group flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3 transition hover:bg-surface',
        className,
      )}
    >
      <Avatar name={name} size="small" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        {detail ? <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div> : null}
      </div>
      {trailing}
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}
