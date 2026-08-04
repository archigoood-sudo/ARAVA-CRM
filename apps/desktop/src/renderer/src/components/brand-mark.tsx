import { cn } from '@arava/ui';

interface BrandMarkProps {
  compact?: boolean;
  className?: string;
}

export function BrandMark({ className, compact = false }: BrandMarkProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-xl bg-sidebar shadow-lg ring-1 ring-white/10">
        <span className="relative text-lg font-black tracking-[-0.1em] text-white">A</span>
        <span className="absolute bottom-1.5 right-1.5 size-2 rounded-full bg-accent" />
      </span>
      {compact ? null : (
        <div>
          <p className="text-[15px] font-bold tracking-[0.17em] text-white">ARAVA</p>
          <p className="text-[10px] font-medium tracking-[0.3em] text-neutral-500">CRM</p>
        </div>
      )}
    </div>
  );
}
