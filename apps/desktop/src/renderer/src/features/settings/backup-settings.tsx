import type { BackupEntry, BackupRestoreSelection } from '@arava/shared';
import { formatDate } from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  EmptyState,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArchiveRestore,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken } from '../../stores/auth-store';

const typeLabels: Record<BackupEntry['type'], string> = {
  AUTOMATIC: 'Автоматическая',
  MANUAL: 'Ручная',
  RESTORE_SAFETY: 'Перед восстановлением',
};

const integrityLabels: Record<BackupEntry['integrity'], string> = {
  INVALID: 'Ошибка проверки',
  UNCHECKED: 'Не проверена',
  VALID: 'Исправна',
};

function bytes(value: number): string {
  if (value < 1024 * 1024) return `${new Intl.NumberFormat('ru-RU').format(value / 1024)} КБ`;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} МБ`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': /u, '')
    : 'Операция не выполнена.';
}

export function BackupSettings() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const [selection, setSelection] = useState<BackupRestoreSelection>();
  const [confirmation, setConfirmation] = useState('');
  const status = useQuery({
    queryFn: () => getDesktopApi().backups.status(getSessionToken()),
    queryKey: queryKeys.backupStatus,
  });
  const history = useQuery({
    queryFn: () => getDesktopApi().backups.list(getSessionToken()),
    queryKey: queryKeys.backups,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.backups }),
      queryClient.invalidateQueries({ queryKey: queryKeys.backupStatus }),
      queryClient.invalidateQueries({ queryKey: ['attention'] }),
    ]);
  };

  const createBackup = useMutation({
    mutationFn: () => getDesktopApi().backups.create(getSessionToken()),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: async (entry) => {
      setNotice(`Резервная копия создана: ${entry.fileName}, ${bytes(entry.size)}.`);
      await refresh();
    },
  });
  const exportBackup = useMutation({
    mutationFn: () => getDesktopApi().backups.export(getSessionToken()),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: async (entry) => {
      if (entry) setNotice(`Копия сохранена: ${entry.location}`);
      await refresh();
    },
  });
  const setAutomatic = useMutation({
    mutationFn: (enabled: boolean) =>
      getDesktopApi().backups.setAutomatic(getSessionToken(), enabled),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: async () => refresh(),
  });
  const chooseFolder = useMutation({
    mutationFn: () => getDesktopApi().backups.selectFolder(getSessionToken()),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: async (result) => {
      if (result) setNotice('Папка резервных копий изменена.');
      await refresh();
    },
  });
  const validate = useMutation({
    mutationFn: (id: string) => getDesktopApi().backups.validate(getSessionToken(), id),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: async (result) => {
      setNotice(result.message);
      await refresh();
    },
  });
  const selectManaged = useMutation({
    mutationFn: (id: string) => getDesktopApi().backups.selectManaged(getSessionToken(), id),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: (result) => {
      setNotice(result.canRestore ? undefined : result.message);
      if (result.canRestore) setSelection(result);
    },
  });
  const selectExternal = useMutation({
    mutationFn: () => getDesktopApi().backups.selectRestoreFile(getSessionToken()),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: (result) => {
      if (!result) return;
      setNotice(result.canRestore ? undefined : result.message);
      if (result.canRestore) setSelection(result);
    },
  });
  const restore = useMutation({
    mutationFn: () =>
      getDesktopApi().backups.restore(
        getSessionToken(),
        selection?.selectionId ?? '',
        confirmation,
      ),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: () => setNotice('Данные восстановлены. ARAVA CRM перезапускается…'),
  });
  const busy =
    createBackup.isPending ||
    exportBackup.isPending ||
    chooseFolder.isPending ||
    validate.isPending ||
    selectManaged.isPending ||
    selectExternal.isPending ||
    restore.isPending;

  return (
    <>
      <Card id="backups">
        <CardHeader>
          <div className="flex items-start justify-between gap-6">
            <div>
              <CardTitle>Резервные копии</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Резервные копии содержат базу данных ARAVA CRM и управляемые медиафайлы: логотип,
                слайды экрана клиента и материалы публикаций.
              </p>
            </div>
            <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent-foreground dark:bg-accent/10 dark:text-accent">
              <HardDrive className="size-5" />
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Автоматические копии
              </p>
              <label className="mt-3 flex items-center gap-3 text-sm font-semibold">
                <Checkbox
                  checked={status.data?.automaticEnabled ?? true}
                  disabled={setAutomatic.isPending}
                  onChange={(event) => setAutomatic.mutate(event.target.checked)}
                />
                {status.data?.automaticEnabled === false ? 'Выключены' : 'Включены'}
              </label>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Последняя успешная копия
              </p>
              <p className="mt-3 text-sm font-semibold">
                {status.data?.lastSuccessfulAt
                  ? formatDate(status.data.lastSuccessfulAt, {
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      month: 'long',
                    })
                  : 'Ещё не создавалась'}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Хранилище
              </p>
              <p className="mt-3 text-sm font-semibold">
                {String(status.data?.count ?? 0)} копий · {bytes(status.data?.totalSize ?? 0)}
              </p>
            </div>
          </div>

          {status.data?.usingLocalFallback ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Выбранная папка была недоступна. Последняя автоматическая копия сохранена в локальную
              резервную папку.
            </div>
          ) : null}
          {status.data?.lastError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
              {status.data.lastError}
            </div>
          ) : null}
          {notice ? (
            <div aria-live="polite" className="rounded-2xl bg-muted px-4 py-3 text-sm">
              {notice}
            </div>
          ) : null}

          <div className="rounded-2xl border border-border bg-background p-4">
            <p className="text-sm font-semibold">Папка хранения</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {status.data?.backupDirectory ?? 'Загрузка…'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => chooseFolder.mutate()} variant="outline">
                <FolderOpen className="size-4" /> Изменить
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void getDesktopApi()
                    .backups.openFolder(getSessionToken())
                    .catch((error: unknown) => setNotice(errorMessage(error)))
                }
                variant="outline"
              >
                <FolderOpen className="size-4" /> Открыть папку
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => createBackup.mutate()}>
              {createBackup.isPending ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {createBackup.isPending ? 'Создание резервной копии…' : 'Создать резервную копию'}
            </Button>
            <Button disabled={busy} onClick={() => exportBackup.mutate()} variant="outline">
              <Download className="size-4" /> Сохранить копию как…
            </Button>
            <Button disabled={busy} onClick={() => selectExternal.mutate()} variant="outline">
              <ArchiveRestore className="size-4" />{' '}
              {selectExternal.isPending ? 'Проверка копии…' : 'Восстановить из копии'}
            </Button>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">История копий</h3>
                <p className="text-xs text-muted-foreground">
                  Автоматически хранится до {String(status.data?.retentionCount ?? 30)} ежедневных
                  копий. Ручные копии не удаляются.
                </p>
              </div>
              <Button onClick={() => void refresh()} size="small" variant="ghost">
                <RefreshCw className="size-4" /> Обновить
              </Button>
            </div>
            {history.data?.length ? (
              <div className="overflow-hidden rounded-2xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата и время</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Размер</TableHead>
                      <TableHead>Состояние</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.data.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <p className="font-medium">
                            {formatDate(entry.createdAt, {
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            })}
                          </p>
                          <p
                            className="max-w-[280px] truncate text-xs text-muted-foreground"
                            title={entry.location}
                          >
                            {entry.fileName}
                          </p>
                        </TableCell>
                        <TableCell>{typeLabels[entry.type]}</TableCell>
                        <TableCell>{bytes(entry.size)}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              entry.integrity === 'VALID'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                                : entry.integrity === 'INVALID'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
                                  : 'bg-muted text-muted-foreground'
                            }
                          >
                            {integrityLabels[entry.integrity]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              disabled={busy}
                              onClick={() => validate.mutate(entry.id)}
                              size="small"
                              variant="ghost"
                            >
                              <ShieldCheck className="size-4" />{' '}
                              {validate.isPending && validate.variables === entry.id
                                ? 'Проверка копии…'
                                : 'Проверить'}
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() => selectManaged.mutate(entry.id)}
                              size="small"
                              variant="outline"
                            >
                              {selectManaged.isPending && selectManaged.variables === entry.id
                                ? 'Подготовка к восстановлению…'
                                : 'Восстановить'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState
                description="Создайте первую копию, чтобы защитить данные студии."
                icon={HardDrive}
                title="Резервных копий пока нет"
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog
        closeLabel="Закрыть"
        description="Текущие данные будут заменены данными из выбранной резервной копии. Перед заменой ARAVA создаст страховочную копию и перезапустится."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              disabled={restore.isPending}
              onClick={() => setSelection(undefined)}
              variant="outline"
            >
              Отмена
            </Button>
            <Button
              disabled={confirmation !== 'ВОССТАНОВИТЬ' || restore.isPending}
              onClick={() => restore.mutate()}
            >
              {restore.isPending ? 'Восстановление данных…' : 'Восстановить и перезапустить'}
            </Button>
          </div>
        }
        onClose={() => setSelection(undefined)}
        open={Boolean(selection)}
        title="Подтвердите восстановление"
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">Копия проверена</p>
              <p className="mt-1 break-all text-xs">{selection?.displayPath}</p>
              {selection?.backup ? (
                <p className="mt-1 text-xs">
                  {formatDate(selection.backup.createdAt, {
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}{' '}
                  · {typeLabels[selection.backup.type]} · {bytes(selection.backup.size)}
                </p>
              ) : null}
              <p className="mt-1 text-xs">{selection?.message}</p>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="restore-confirmation">
              Для подтверждения введите ВОССТАНОВИТЬ
            </label>
            <Input
              autoComplete="off"
              className="mt-2"
              id="restore-confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="ВОССТАНОВИТЬ"
              value={confirmation}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
