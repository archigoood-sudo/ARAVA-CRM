import { cn } from '@arava/ui';
import { useEffect, useState } from 'react';

interface BrandMarkProps {
  compact?: boolean;
  className?: string;
  logoDataUrl?: string | undefined;
}

export function BrandMark({ className, compact = false, logoDataUrl }: BrandMarkProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => setLogoFailed(false), [logoDataUrl]);
  const showLogo = Boolean(logoDataUrl && !logoFailed);
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {showLogo ? (
        <span className="flex h-12 min-w-0 flex-1 items-center overflow-hidden">
          <img
            alt="Логотип CRM"
            className="max-h-12 max-w-full object-contain object-left"
            onError={() => setLogoFailed(true)}
            src={logoDataUrl}
          />
        </span>
      ) : (
        <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-sidebar shadow-lg ring-1 ring-white/10">
          <span className="relative text-lg font-black tracking-[-0.1em] text-white">A</span>
          <span className="absolute bottom-1.5 right-1.5 size-2 rounded-full bg-accent" />
        </span>
      )}
      {compact || showLogo ? null : (
        <div>
          <p className="text-[15px] font-bold tracking-[0.17em] text-white">ARAVA</p>
          <p className="text-[10px] font-medium tracking-[0.3em] text-neutral-500">CRM</p>
        </div>
      )}
    </div>
  );
}
