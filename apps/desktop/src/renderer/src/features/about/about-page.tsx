import { t, type DesktopUpdateState } from '@arava/shared';
import { Button, Card, CardContent, PageHeader } from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Database, Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';

import { BrandMark } from '../../components/brand-mark';
import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const details = [
  { icon: Database, text: t('about.localData') },
  { icon: ShieldCheck, text: t('about.architecture') },
];

export function AboutPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const system = useQuery({
    queryFn: () => getDesktopApi().system.information(getSessionToken()),
    queryKey: queryKeys.system,
  });
  const updateKey = queryKeys.updates(user?.id);
  const updates = useQuery({
    queryFn: () => getDesktopApi().updates.getState(getSessionToken()),
    queryKey: updateKey,
  });
  const updateAction = useMutation({
    mutationFn: async (action: 'CHECK' | 'DOWNLOAD' | 'INSTALL') => {
      if (action === 'CHECK') return getDesktopApi().updates.check(getSessionToken());
      if (action === 'DOWNLOAD') return getDesktopApi().updates.download(getSessionToken());
      await getDesktopApi().updates.install(getSessionToken());
      return undefined;
    },
    onSuccess: (state) => {
      if (state) queryClient.setQueryData(updateKey, state);
    },
  });
  useEffect(
    () =>
      getDesktopApi().updates.onStateChanged((state) => {
        queryClient.setQueryData(queryKeys.updates(user?.id), state);
      }),
    [queryClient, user?.id],
  );
  const buildCommit = system.data?.buildCommit ?? '—';
  const buildDate = system.data?.buildDate
    ? new Date(system.data.buildDate).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';
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
          <div className="mb-6 rounded-2xl border border-border bg-sidebar p-5 text-white">
            <p className="text-lg">
              {t('about.version')} {system.data?.appVersion ?? '—'}
            </p>
            <p className="mt-2 text-sm text-neutral-300">
              {t('about.build')} {buildCommit}
            </p>
            <p className="mt-1 text-sm text-neutral-300">
              {t('about.buildDate')} {buildDate}
            </p>
          </div>
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
          <UpdateCard
            isOwner={user?.role === 'OWNER'}
            loading={updateAction.isPending}
            onAction={(action) => updateAction.mutate(action)}
            state={updates.data}
          />
          <p className="mt-8 text-xs text-muted-foreground">{t('about.copyright')}</p>
        </CardContent>
      </Card>
    </main>
  );
}

interface UpdateCardProps {
  isOwner: boolean;
  loading: boolean;
  onAction: (action: 'CHECK' | 'DOWNLOAD' | 'INSTALL') => void;
  state?: DesktopUpdateState | undefined;
}

function UpdateCard({ isOwner, loading, onAction, state }: UpdateCardProps) {
  const action =
    state?.status === 'AVAILABLE'
      ? 'DOWNLOAD'
      : state?.status === 'DOWNLOADED'
        ? 'INSTALL'
        : 'CHECK';
  const actionLabel =
    action === 'DOWNLOAD'
      ? 'Скачать обновление'
      : action === 'INSTALL'
        ? 'Перезапустить и установить'
        : 'Проверить обновления';
  const busy = loading || state?.status === 'CHECKING' || state?.status === 'DOWNLOADING';

  return (
    <section className="mt-6 rounded-2xl border border-border bg-background p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-semibold">Обновления приложения</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {state?.message ?? 'Получаем состояние обновлений…'}
          </p>
          {state?.status === 'DOWNLOADING' && state.progress !== undefined ? (
            <p className="mt-2 text-sm font-medium">Загружено: {state.progress}%</p>
          ) : null}
          {state?.checkedAt ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Последняя проверка: {new Date(state.checkedAt).toLocaleString('ru-RU')}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Обновления автоматически проверяются после запуска и каждые несколько часов.
          </p>
        </div>
        {isOwner && state?.status !== 'UNSUPPORTED' ? (
          <Button disabled={busy} onClick={() => onAction(action)} variant="outline">
            {action === 'DOWNLOAD' ? (
              <Download className="size-4" />
            ) : (
              <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} />
            )}
            {actionLabel}
          </Button>
        ) : null}
      </div>
      {!isOwner && state?.status === 'AVAILABLE' ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Установку обновления может запустить владелец.
        </p>
      ) : null}
      {updateActionErrorText(loading, state) ? (
        <p className="mt-3 text-sm text-destructive">{updateActionErrorText(loading, state)}</p>
      ) : null}
    </section>
  );
}

function updateActionErrorText(loading: boolean, state?: DesktopUpdateState): string | undefined {
  if (loading || state?.status !== 'ERROR') return undefined;
  return 'Можно повторить попытку. Текущая версия продолжит работать.';
}
