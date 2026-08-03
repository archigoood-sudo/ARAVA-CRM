import { cn } from '@arava/ui';

interface BrandMarkProps {
  compact?: boolean;
  className?: string;
}

export function BrandMark({ className, compact = false }: BrandMarkProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-xl bg-accent">
        <span className="absolute -right-1 -top-2 size-6 rotate-45 rounded-md bg-white/40" />
        <span className="relative text-lg font-black tracking-[-0.1em] text-neutral-950">A</span>
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
