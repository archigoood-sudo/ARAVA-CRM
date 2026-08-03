import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, cn } from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Database, Laptop, Moon, Save, Sun } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { useThemeStore, type ThemeMode } from '../../stores/theme-store';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const settingsSchema = z.object({
  workspaceName: z.string().trim().min(2, 'Workspace name is too short').max(80),
});

type SettingsForm = z.infer<typeof settingsSchema>;

const themeChoices: {
  description: string;
  icon: typeof Sun;
  label: string;
  value: ThemeMode;
}[] = [
  { description: 'Bright and focused', icon: Sun, label: 'Light', value: 'light' },
  { description: 'Easy on the eyes', icon: Moon, label: 'Dark', value: 'dark' },
  { description: 'Match your device', icon: Laptop, label: 'System', value: 'system' },
];

export function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const canManageWorkspace = user?.role === 'OWNER' || user?.role === 'ADMIN';
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
      <div className="mb-8">
        <h2 className="text-4xl font-semibold tracking-[-0.045em]">Make ARAVA yours.</h2>
        <p className="mt-2.5 text-base text-muted-foreground">
          Personalize the workspace and review your local application details.
        </p>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <p className="text-sm text-muted-foreground">
              Choose how ARAVA looks across the application.
            </p>
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
            <CardTitle>Workspace</CardTitle>
            <p className="text-sm text-muted-foreground">
              Set the display name for this CRM database.
            </p>
          </CardHeader>
          <CardContent>
            <form className="flex items-end gap-3" onSubmit={submit}>
              <div className="min-w-0 flex-1 space-y-2.5">
                <Label htmlFor="workspaceName">Workspace name</Label>
                <Input
                  disabled={!canManageWorkspace || workspaceQuery.isLoading}
                  id="workspaceName"
                  placeholder="ARAVA Workspace"
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
                {saveWorkspace.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Application data</CardTitle>
            <p className="text-sm text-muted-foreground">
              Technical information for diagnostics and support.
            </p>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border rounded-2xl border border-border bg-background px-5">
              <div className="flex items-center justify-between gap-8 py-4">
                <dt className="flex items-center gap-3 text-sm font-medium">
                  <Database className="size-4 text-muted-foreground" /> Database
                </dt>
                <dd className="max-w-xl truncate font-mono text-xs text-muted-foreground">
                  {systemQuery.data?.databasePath ?? 'Loading…'}
                </dd>
              </div>
              <div className="flex items-center justify-between py-4">
                <dt className="text-sm font-medium">Version</dt>
                <dd className="text-sm text-muted-foreground">
                  {systemQuery.data?.appVersion ?? '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between py-4">
                <dt className="text-sm font-medium">Platform</dt>
                <dd className="text-sm capitalize text-muted-foreground">
                  {systemQuery.data?.platform ?? '—'}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
