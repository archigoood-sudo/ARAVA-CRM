import { zodResolver } from '@hookform/resolvers/zod';
import { t } from '@arava/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  cn,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Database, KeyRound, Laptop, Moon, Save, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { useThemeStore, type ThemeMode } from '../../stores/theme-store';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { BackupSettings } from './backup-settings';

const settingsSchema = z.object({
  workspaceName: z.string().trim().min(2, t('validation.workspaceName')).max(80),
});

type SettingsForm = z.infer<typeof settingsSchema>;

const themeChoices: {
  description: string;
  icon: typeof Sun;
  label: string;
  value: ThemeMode;
}[] = [
  {
    description: t('settings.theme.lightDescription'),
    icon: Sun,
    label: t('settings.theme.light'),
    value: 'light',
  },
  {
    description: t('settings.theme.darkDescription'),
    icon: Moon,
    label: t('settings.theme.dark'),
    value: 'dark',
  },
  {
    description: t('settings.theme.systemDescription'),
    icon: Laptop,
    label: t('settings.theme.system'),
    value: 'system',
  },
];

const platformNames: Record<string, string> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

export function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const canManageWorkspace = user?.permissions.canManageSystemSettings ?? false;
  const [recoveryCode, setRecoveryCode] = useState<string>();
  const queryClient = useQueryClient();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  const workspaceQuery = useQuery({
    queryFn: () => getDesktopApi().settings.get(getSessionToken(), 'general.workspaceName'),
    queryKey: queryKeys.setting('general.workspaceName'),
  });
  const systemQuery = useQuery({
    queryFn: () => getDesktopApi().system.information(getSessionToken()),
    queryKey: queryKeys.system,
  });
  const recoveryStatus = useQuery({
    enabled: user?.role === 'OWNER',
    queryFn: () => getDesktopApi().users.recoveryCodeStatus(getSessionToken()),
    queryKey: ['owner-recovery-code'],
  });
  const createRecoveryCode = useMutation({
    mutationFn: () => getDesktopApi().users.recoveryCodeCreate(getSessionToken()),
    onSuccess: (result) => {
      setRecoveryCode(result.recoveryCode);
      queryClient.setQueryData(['owner-recovery-code'], result);
    },
  });
  const {
    formState: { errors, isDirty },
    handleSubmit,
    register,
    reset,
  } = useForm<SettingsForm>({
    defaultValues: { workspaceName: '' },
    resolver: zodResolver(settingsSchema),
  });

  useEffect(() => {
    if (workspaceQuery.data) reset({ workspaceName: workspaceQuery.data });
  }, [reset, workspaceQuery.data]);

  useEffect(() => {
    if (window.location.hash !== '#backups') return;
    const frame = window.requestAnimationFrame(() =>
      document.querySelector('#backups')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const saveWorkspace = useMutation({
    mutationFn: async ({ workspaceName }: SettingsForm) => {
      await getDesktopApi().settings.set(getSessionToken(), {
        key: 'general.workspaceName',
        value: workspaceName,
      });
      return workspaceName;
    },
    onSuccess: (workspaceName) => {
      queryClient.setQueryData(queryKeys.setting('general.workspaceName'), workspaceName);
      reset({ workspaceName });
    },
  });

  const submit = handleSubmit(async (values) => {
    await saveWorkspace.mutateAsync(values);
  });

  const selectTheme = async (value: ThemeMode) => {
    setTheme(value);
    await getDesktopApi().settings.set(getSessionToken(), { key: 'appearance.theme', value });
  };

  return (
    <main className="mx-auto w-full max-w-5xl p-9 pb-14">
      <PageHeader description={t('settings.pageDescription')} title={t('settings.pageTitle')} />

      <div className="space-y-5">
        {user?.role === 'OWNER' ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.recovery.title')}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('settings.recovery.description')}</p>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-6 rounded-2xl border border-border bg-background p-5">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <KeyRound className="size-4" />
                    {recoveryStatus.data?.configured
                      ? t('settings.recovery.configured')
                      : t('settings.recovery.notConfigured')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('settings.recovery.storeOffline')}
                  </p>
                </div>
                <Button
                  disabled={createRecoveryCode.isPending}
                  onClick={() => {
                    if (window.confirm(t('settings.recovery.confirmReplace')))
                      void createRecoveryCode.mutateAsync();
                  }}
                  variant="outline"
                >
                  {recoveryStatus.data?.configured
                    ? t('settings.recovery.replace')
                    : t('settings.recovery.create')}
                </Button>
              </div>
              {recoveryCode ? (
                <div className="mt-4 rounded-2xl bg-sidebar p-5 text-white">
                  <p className="text-sm text-neutral-300">{t('settings.recovery.once')}</p>
                  <code className="mt-3 block select-all text-center text-lg font-semibold tracking-wider text-accent">
                    {recoveryCode}
                  </code>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Button
                      onClick={() => void navigator.clipboard.writeText(recoveryCode)}
                      variant="outline"
                    >
                      {t('settings.recovery.copy')}
                    </Button>
                    <Button onClick={() => setRecoveryCode(undefined)}>
                      {t('settings.recovery.saved')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {user?.role === 'OWNER' ? <BackupSettings /> : null}

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.appearance')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('settings.appearanceDescription')}</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {themeChoices.map(({ description, icon: Icon, label, value }) => {
                const selected = theme === value;
                return (
                  <button
                    aria-pressed={selected}
                    className={cn(
                      'relative rounded-2xl border bg-background p-4 text-left transition hover:border-neutral-400 dark:hover:border-neutral-600',
                      selected &&
                        'border-neutral-950 ring-1 ring-neutral-950 dark:border-accent dark:ring-accent',
                    )}
                    key={value}
                    onClick={() => selectTheme(value)}
                    type="button"
                  >
                    <div className="flex items-start justify-between">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-surface text-foreground shadow-card">
                        <Icon className="size-[18px]" />
                      </span>
                      {selected ? (
                        <span className="flex size-5 items-center justify-center rounded-full bg-accent text-neutral-950">
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-5 text-sm font-semibold">{label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.workspace')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('settings.workspaceDescription')}</p>
          </CardHeader>
          <CardContent>
            <form className="flex items-end gap-3" onSubmit={submit}>
              <div className="min-w-0 flex-1 space-y-2.5">
                <Label htmlFor="workspaceName">{t('settings.workspaceName')}</Label>
                <Input
                  disabled={!canManageWorkspace || workspaceQuery.isLoading}
                  id="workspaceName"
                  placeholder={t('settings.workspacePlaceholder')}
                  {...register('workspaceName')}
                />
                {errors.workspaceName ? (
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    {errors.workspaceName.message}
                  </p>
                ) : null}
              </div>
              <Button
                disabled={!canManageWorkspace || !isDirty || saveWorkspace.isPending}
                type="submit"
              >
                <Save className="size-4" />
                {saveWorkspace.isPending ? t('common.saving') : t('settings.saveChanges')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.appData')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('settings.appDataDescription')}</p>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border rounded-2xl border border-border bg-background px-5">
              <div className="flex items-center justify-between gap-8 py-4">
                <dt className="flex items-center gap-3 text-sm font-medium">
                  <Database className="size-4 text-muted-foreground" /> {t('settings.database')}
                </dt>
                <dd className="max-w-xl truncate font-mono text-xs text-muted-foreground">
                  {systemQuery.data?.databasePath ?? t('common.loading')}
                </dd>
              </div>
              <div className="flex items-center justify-between py-4">
                <dt className="text-sm font-medium">{t('settings.version')}</dt>
                <dd className="text-sm text-muted-foreground">
                  {systemQuery.data?.appVersion ?? '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between py-4">
                <dt className="text-sm font-medium">{t('settings.platform')}</dt>
                <dd className="text-sm capitalize text-muted-foreground">
                  {systemQuery.data?.platform
                    ? (platformNames[systemQuery.data.platform] ?? systemQuery.data.platform)
                    : '—'}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
