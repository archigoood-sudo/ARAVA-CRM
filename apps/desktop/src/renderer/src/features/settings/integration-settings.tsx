import type { IntegrationConnectionState } from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cable, CloudCog, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken } from '../../stores/auth-store';

const stateLabels: Record<IntegrationConnectionState, string> = {
  AUTH_ERROR: 'Требуется повторное подключение',
  CONFLICT: 'Требуется согласование изменений',
  CONNECTED: 'Подключено',
  DISABLED: 'Выключено',
  NOT_PAIRED: 'Не подключено',
  OFFLINE: 'Нет соединения',
  PENDING_CHANGES: 'Есть несинхронизированные изменения',
  RECONCILIATION_REQUIRED: 'Требуется первичное согласование',
  SYNC_ERROR: 'Ошибка синхронизации',
  VERSION_UNSUPPORTED: 'Требуется обновление',
};
const resultLabels: Record<string, string> = {
  FAILED: 'Ошибка',
  QUEUED: 'Поставлено в очередь',
  RETRY: 'Повторная попытка',
  SUCCESS: 'Успешно',
  SYNCED: 'Синхронизировано',
};
const entityLabels: Record<string, string> = {
  BRANCH: 'Филиал',
  ATTENDANCE: 'Посещаемость',
  CARD: 'Карта',
  GROUP: 'Группа',
  GROUP_MEMBERSHIP: 'Участник группы',
  LESSON: 'Занятие',
  ROOM: 'Зал',
  SCHEDULE: 'Расписание',
  STUDENT_CONTACT: 'Контакт ученика',
  STUDENT_IDENTITY: 'Ученик',
  STUDENT_NOTE: 'Заметка ученика',
  SUBSCRIPTION: 'Абонемент',
  SUBSCRIPTION_LEDGER: 'Операция абонемента',
  SUBSTITUTION: 'Замена тренера',
  TARIFF: 'Тариф',
  TRAINER: 'Тренер',
};

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': /u, '')
    : 'Операция не выполнена.';
}

function dateTime(value?: string): string {
  return value
    ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
      )
    : 'Ещё не выполнялась';
}

export function IntegrationSettings() {
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [notice, setNotice] = useState<string>();
  const [showLog, setShowLog] = useState(false);
  const status = useQuery({
    queryFn: () => getDesktopApi().integration.getStatus(getSessionToken()),
    queryKey: queryKeys.integrationStatus,
    refetchInterval: 15_000,
  });
  const log = useQuery({
    enabled: showLog,
    queryFn: () => getDesktopApi().integration.listLog(getSessionToken()),
    queryKey: queryKeys.integrationLog,
  });
  const preview = useQuery({
    enabled: false,
    queryFn: () => getDesktopApi().integration.prepareInitialSync(getSessionToken()),
    queryKey: queryKeys.integrationPreview,
  });

  useEffect(() => {
    if (!status.data) return;
    setBaseUrl(status.data.baseUrl);
    setEnabled(status.data.enabled);
  }, [status.data]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.integrationStatus }),
      queryClient.invalidateQueries({ queryKey: queryKeys.integrationLog }),
      queryClient.invalidateQueries({ queryKey: ['attention'] }),
    ]);
  };
  const action = useMutation({
    mutationFn: async (kind: 'save' | 'pair' | 'test' | 'sync' | 'initial') => {
      if (kind === 'save')
        return getDesktopApi().integration.updateSettings(getSessionToken(), { baseUrl, enabled });
      if (kind === 'pair')
        return getDesktopApi().integration.pair(getSessionToken(), {
          baseUrl,
          enabled: true,
          pairingCode,
        });
      if (kind === 'test') return getDesktopApi().integration.testConnection(getSessionToken());
      if (kind === 'sync') return getDesktopApi().integration.syncNow(getSessionToken());
      return getDesktopApi().integration.confirmInitialSync(getSessionToken());
    },
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: async (_, kind) => {
      setPairingCode('');
      setNotice(
        kind === 'pair'
          ? 'Устройство подключено к сайту.'
          : kind === 'sync'
            ? 'Синхронизация завершена.'
            : kind === 'initial'
              ? 'Первичная синхронизация поставлена в очередь.'
              : kind === 'test'
                ? 'Соединение с сайтом установлено.'
                : 'Настройки сохранены.',
      );
      await refresh();
    },
  });

  const prepare = async () => {
    setNotice(undefined);
    await preview.refetch();
  };

  return (
    <Card id="integration">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Интеграция с сайтом</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Безопасная фоновая передача изменений. CRM продолжает работать без интернета.
            </p>
          </div>
          <Badge>{status.data ? stateLabels[status.data.connectionState] : 'Проверка…'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 rounded-2xl border border-border bg-background p-5 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="integration-url">Адрес API сайта</Label>
            <Input
              id="integration-url"
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://example.ru"
              value={baseUrl}
            />
            <p className="text-xs text-muted-foreground">
              В рабочем режиме используется HTTPS. HTTP разрешён только для локальной разработки.
            </p>
          </div>
          <label className="flex items-center gap-3 text-sm font-medium">
            <Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Включить интеграцию
          </label>
          <Button
            disabled={action.isPending}
            onClick={() => action.mutate('save')}
            variant="outline"
          >
            Сохранить настройки
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs text-muted-foreground">Устройство</p>
            <p className="mt-1 truncate font-mono text-xs">{status.data?.deviceId ?? '—'}</p>
          </div>
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs text-muted-foreground">Ожидают отправки</p>
            <p className="mt-1 text-xl font-semibold">{status.data?.pendingCount ?? 0}</p>
          </div>
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs text-muted-foreground">Ошибки</p>
            <p className="mt-1 text-xl font-semibold">{status.data?.failedCount ?? 0}</p>
          </div>
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs text-muted-foreground">Конфликты</p>
            <p className="mt-1 text-xl font-semibold">{status.data?.conflictCount ?? 0}</p>
          </div>
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs text-muted-foreground">Последняя синхронизация</p>
            <p className="mt-1 text-sm font-semibold">
              {dateTime(status.data?.lastSuccessfulSync)}
            </p>
          </div>
        </div>

        {status.data?.devices.length ? (
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="border-b border-border px-5 py-4">
              <p className="font-semibold">Подключённые устройства</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Сервер хранит общий порядок изменений и отдельную позицию каждого устройства.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Устройство</TableHead>
                  <TableHead>Получено</TableHead>
                  <TableHead>Отправлено</TableHead>
                  <TableHead>Ожидает</TableHead>
                  <TableHead>Конфликты</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.data.devices.map((device) => (
                  <TableRow key={device.deviceId}>
                    <TableCell>
                      <p className="font-medium">{device.name ?? 'Устройство CRM'}</p>
                      <p className="font-mono text-xs text-muted-foreground">{device.deviceId}</p>
                    </TableCell>
                    <TableCell>{dateTime(device.lastInboundSyncAt)}</TableCell>
                    <TableCell>{dateTime(device.lastOutboundSyncAt)}</TableCell>
                    <TableCell>{device.pendingCount}</TableCell>
                    <TableCell>{device.conflictCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {!status.data?.isPaired ? (
          <div className="rounded-2xl border border-border p-5">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="size-4" /> Подключение устройства
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Введите одноразовый код, созданный на сервере ARAVA. Пароль владельца не передаётся.
            </p>
            <div className="mt-4 flex gap-3">
              <Input
                aria-label="Код подключения"
                className="max-w-sm"
                onChange={(event) => setPairingCode(event.target.value)}
                placeholder="Код подключения"
                value={pairingCode}
              />
              <Button
                disabled={action.isPending || pairingCode.trim().length < 6 || !baseUrl}
                onClick={() => action.mutate('pair')}
              >
                <Cable className="size-4" /> Подключить
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button
            disabled={action.isPending || !status.data?.isPaired}
            onClick={() => action.mutate('test')}
            variant="outline"
          >
            Проверить соединение
          </Button>
          <Button
            disabled={action.isPending || !status.data?.isPaired}
            onClick={() => action.mutate('sync')}
          >
            <RefreshCw className="size-4" /> Синхронизировать сейчас
          </Button>
          <Button disabled={preview.isFetching} onClick={() => void prepare()} variant="outline">
            <CloudCog className="size-4" /> Первичная синхронизация
          </Button>
          <Button onClick={() => setShowLog((value) => !value)} variant="ghost">
            {showLog ? 'Скрыть журнал' : 'Журнал синхронизации'}
          </Button>
        </div>

        {preview.data ? (
          <div className="rounded-2xl border border-accent/50 bg-accent/10 p-5">
            <p className="font-semibold">Данные для первичной синхронизации</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <span>Филиалы: {preview.data.branches}</span>
              <span>Залы: {preview.data.rooms}</span>
              <span>Тренеры: {preview.data.trainers}</span>
              <span>Группы: {preview.data.groups}</span>
              <span>Ученики: {preview.data.students}</span>
              <span>Членства: {preview.data.memberships}</span>
              <span>Занятия: {preview.data.lessons}</span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Занятия: последние 30 дней и следующие 180 дней. Пароли, сессии, аудит, платежи и
              возвраты не отправляются. Перед объединением двух уже заполненных баз потребуется
              отдельное согласование.
            </p>
            {preview.data.requiresReconciliation ? (
              <p className="mt-3 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                На устройстве уже есть локальные и полученные данные. Проверьте состояние перед
                первичной синхронизацией.
              </p>
            ) : null}
            <Button
              className="mt-4"
              disabled={action.isPending || !status.data?.isPaired}
              onClick={() => {
                if (window.confirm('Поставить выбранные данные в очередь первичной синхронизации?'))
                  action.mutate('initial');
              }}
            >
              Подтвердить первичную синхронизацию
            </Button>
          </div>
        ) : null}

        {notice || status.data?.lastError ? (
          <p className="rounded-xl bg-muted px-4 py-3 text-sm">
            {notice ?? status.data?.lastError}
          </p>
        ) : null}

        {showLog ? (
          <div className="overflow-hidden rounded-2xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Время</TableHead>
                  <TableHead>Объект</TableHead>
                  <TableHead>Результат</TableHead>
                  <TableHead>Попытка</TableHead>
                  <TableHead>Сообщение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(log.data ?? []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{dateTime(entry.createdAt)}</TableCell>
                    <TableCell>
                      {entry.entityType
                        ? (entityLabels[entry.entityType] ?? 'Объект')
                        : entry.operation === 'HEALTH'
                          ? 'Проверка соединения'
                          : entry.operation === 'PAIR'
                            ? 'Подключение устройства'
                            : entry.operation === 'INITIAL_SYNC'
                              ? 'Первичная синхронизация'
                              : 'Система'}
                    </TableCell>
                    <TableCell>{resultLabels[entry.result] ?? 'Неизвестный результат'}</TableCell>
                    <TableCell>{entry.attemptCount}</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {entry.message ?? entry.errorCode ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
