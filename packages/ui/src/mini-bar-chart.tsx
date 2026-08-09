import { cn } from './utils';

export interface MiniBarChartItem {
  color?: string;
  label: string;
  value: number;
}

export function MiniBarChart({
  className,
  items,
  valueFormatter = (value) => value.toLocaleString('ru-RU'),
}: {
  className?: string;
  items: MiniBarChartItem[];
  valueFormatter?: (value: number) => string;
}) {
  const maximum = Math.max(1, ...items.map(({ value }) => Math.abs(value)));
  return (
    <div className={cn('space-y-4', className)}>
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1.5 flex items-center justify-between gap-4 text-sm">
            <span className="truncate text-muted-foreground">{item.label}</span>
            <span className="font-medium tabular-nums">{valueFormatter(item.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full min-w-1 rounded-full bg-accent transition-[width] duration-500"
              style={{
                backgroundColor: item.color,
                width: `${String(Math.max(2, (Math.abs(item.value) / maximum) * 100))}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
