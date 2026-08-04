import { type ReactNode } from 'react';

import { cn } from './utils';

export interface WeekCalendarItem {
  color?: string | undefined;
  content: ReactNode;
  id: string;
  weekday: number;
}

export interface WeekCalendarProps {
  days: readonly string[];
  emptyLabel: string;
  items: WeekCalendarItem[];
}

export function WeekCalendar({ days, emptyLabel, items }: WeekCalendarProps) {
  return (
    <div className="grid min-w-[980px] grid-cols-7 overflow-hidden rounded-[20px] border border-border bg-surface shadow-card">
      {days.map((day, index) => {
        const dayItems = items.filter(({ weekday }) => weekday === index + 1);
        return (
          <section className={cn('min-h-80 border-r border-border last:border-r-0')} key={day}>
            <header className="border-b border-border bg-muted/40 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {day}
            </header>
            <div className="space-y-2 p-2">
              {dayItems.length ? (
                dayItems.map((item) => (
                  <article
                    className="rounded-xl border border-border bg-background p-3 text-xs shadow-sm"
                    key={item.id}
                    style={{ borderLeftColor: item.color ?? '#9CFF2E', borderLeftWidth: 3 }}
                  >
                    {item.content}
                  </article>
                ))
              ) : (
                <p className="px-1 py-5 text-center text-[11px] text-muted-foreground">
                  {emptyLabel}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
