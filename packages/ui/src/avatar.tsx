import type { HTMLAttributes } from 'react';

import { cn } from './utils';

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: 'large' | 'medium' | 'small';
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase('ru-RU'))
    .join('');
}

export function Avatar({ className, name, size = 'medium', ...properties }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-sidebar font-bold text-white ring-1 ring-white/10 dark:bg-accent dark:text-neutral-950',
        size === 'small' && 'size-9 rounded-xl text-xs',
        size === 'medium' && 'size-11 rounded-2xl text-sm',
        size === 'large' && 'size-20 rounded-[22px] text-2xl',
        className,
      )}
      {...properties}
    >
      {initials(name)}
    </span>
  );
}
