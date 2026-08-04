import { t } from '@arava/shared';
import { Card, CardContent, PageHeader } from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Database, ShieldCheck } from 'lucide-react';

import { BrandMark } from '../../components/brand-mark';
import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken } from '../../stores/auth-store';

const details = [
  { icon: Database, text: t('about.localData') },
  { icon: ShieldCheck, text: t('about.architecture') },
];

export function AboutPage() {
  const system = useQuery({
    queryFn: () => getDesktopApi().system.information(getSessionToken()),
    queryKey: queryKeys.system,
  });
  return (
    <main className="mx-auto w-full max-w-5xl p-9 pb-14">
      <PageHeader description={t('about.description')} title={t('about.title')} />
      <Card className="overflow-hidden">
        <div className="flex items-center gap-5 border-b border-border bg-sidebar px-8 py-9 text-white">
          <BrandMark />
          <div className="ml-auto flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs text-neutral-300">
            <CheckCircle2 className="size-3.5 text-accent" />
            {t('about.version')} {system.data?.appVersion ?? '—'}
          </div>
        </div>
        <CardContent className="p-8">
          <div className="grid grid-cols-2 gap-4">
            {details.map(({ icon: Icon, text }) => (
              <div className="rounded-2xl border border-border bg-background p-5" key={text}>
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-foreground dark:bg-accent/10 dark:text-accent">
                  <Icon className="size-[18px]" />
                </span>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-xs text-muted-foreground">{t('about.copyright')}</p>
        </CardContent>
      </Card>
    </main>
  );
}
