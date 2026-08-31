import type { IntegrationConnectionState, IntegrationDiagnosticLevel } from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Cable,
  CheckCircle2,
  CloudCog,
  GitCompareArrows,
  Pencil,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  Stethoscope,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
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
  OFFLINE: 'Сервер временно недоступен',
  PENDING_CHANGES: 'Есть несинхронизированные изменения',
  RECONCILIATION_REQUIRED: 'Требуется первичное согласование',
  SYNC_ERROR: 'Ошибка синхронизации',
  VERSION_UNSUPPORTED: 'Требуется обновление',
};
const resultLabels: Record<string, string> = {
  AUTO_RESOLVED: 'Согласовано автоматически',
  FAILED: 'Ошибка',
  OBSOLETE: 'Устарело',
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
  TRIAL_APPOINTMENT: 'Пробное занятие',
};
const diagnosticOverallLabels = {
  ERROR: 'Обнаружены ошибки',
  HEALTHY: 'Синхронизация работает',
  WARNING: 'Есть предупреждения',
} as const;
const diagnosticLevelLabels: Record<IntegrationDiagnosticLevel, string> = {
  ERROR: 'Ошибка',
  WARNING: 'Предупреждение',
  WORKING: 'Работает',
};
const conflictDiagnosticLabels = {
  AUTO_RESOLVED: 'Разрешён автоматически',
  OBSOLETE: 'Устарел',
  REAL_ERROR: 'Требует диагностики',
} as const;

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

function relativeSyncTime(value?: string): string {
  if (!value) return 'Ещё не выполнялась';
  const date = new Date(value);
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'Только что';
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))} мин. назад`;
  return dateTime(value);
}

function statusExplanation(state: IntegrationConnectionState): string {
  const explanations: Record<IntegrationConnectionState, string> = {
    AUTH_ERROR: 'Это устройство больше не авторизовано для синхронизации.',
    CONFLICT: 'Автоматическое согласование части данных завершилось ошибкой.',
    CONNECTED: 'Все изменения синхронизированы.',
    DISABLED: 'Синхронизация выключена в настройках.',
    NOT_PAIRED: 'Подключите устройство к ARAVA-WEB.',
    OFFLINE:
      'Сервер синхронизации временно недоступен. Изменения сохранены локально и будут отправлены позже.',
    PENDING_CHANGES: 'Локальные изменения безопасно ожидают отправки.',
    RECONCILIATION_REQUIRED: 'Требуется безопасно согласовать локальные и серверные данные.',
    SYNC_ERROR: 'Часть изменений не удалось отправить. Можно повторить безопасно.',
    VERSION_UNSUPPORTED: 'Обновите приложение, чтобы продолжить синхронизацию.',
  };
  return explanations[state];
}

export function IntegrationSettings() {
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [notice, setNotice] = useState<string>();
  const [showLog, setShowLog] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState<string>();
  const [editingDisplayName, setEditingDisplayName] = useState('');
  const [revokingDeviceId, setRevokingDeviceId] = useState<string>();
  const [recoveryConfirmationOpen, setRecoveryConfirmationOpen] = useState(false);
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
  const conflicts = useQuery({
    enabled: Boolean(status.data?.isPaired),
    queryFn: () => getDesktopApi().integration.listConflicts(getSessionToken()),
    queryKey: queryKeys.integrationConflicts,
  });
  const aqsiDevices = useQuery({
    enabled: Boolean(status.data?.isPaired),
    queryFn: () => getDesktopApi().paymentOperations.sbpDevices(getSessionToken()),
    queryKey: ['integration', 'aqsi-devices'],
    retry: false,
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
      queryClient.invalidateQueries({ queryKey: queryKeys.integrationConflicts }),
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

  const rename = useMutation({
    mutationFn: () =>
      getDesktopApi().integration.renameDevice(getSessionToken(), editingDeviceId ?? '', {
        deviceId: editingDeviceId ?? '',
        displayName: editingDisplayName.trim(),
      }),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: async () => {
      setNotice('Имя устройства обновлено.');
      setEditingDeviceId(undefined);
      setEditingDisplayName('');
      await refresh();
    },
  });
  const diagnostics = useMutation({
    mutationFn: () => getDesktopApi().integration.diagnose(getSessionToken()),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: () => setNotice(undefined),
  });
  const selectAqsiDevice = useMutation({
    mutationFn: (deviceId: number) =>
      getDesktopApi().paymentOperations.sbpSelectDevice(getSessionToken(), deviceId),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: async (device) => {
      setNotice(`Касса «${device.name}» выбрана для оплаты через СБП.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integration', 'aqsi-devices'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.integrationStatus }),
      ]);
    },
  });
  const revoke = useMutation({
    mutationFn: (deviceId: string) =>
      getDesktopApi().integration.revokeDevice(getSessionToken(), deviceId),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: async () => {
      setRevokingDeviceId(undefined);
      setNotice('Доступ устройства отозван. Для повторной работы потребуется новое подключение.');
      await refresh();
    },
  });
  const recover = useMutation({
    mutationFn: () => getDesktopApi().integration.recoverFromServer(getSessionToken()),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: async (result) => {
      setRecoveryConfirmationOpen(false);
      setNotice(
        `Состояние сервера загружено. Получено изменений: ${String(result.receivedChanges)}. Конфликтов закрыто серверной версией: ${String(result.resolvedConflicts)}. Резервная копия: ${result.backup.fileName} (${result.backup.location}).`,
      );
      await refresh();
    },
  });
  const reconciliation = useMutation({
    mutationFn: () => getDesktopApi().integration.reconciliationPreview(getSessionToken()),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: () => setNotice(undefined),
  });
  const confirmReconciliation = useMutation({
    mutationFn: () => getDesktopApi().integration.confirmReconciliation(getSessionToken()),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: async () => {
      setNotice('Безопасное согласование запущено.');
      await refresh();
    },
  });
  const journal = useMutation({
    mutationFn: () => getDesktopApi().integration.pruneJournal(getSessionToken()),
    onError: (error) => setNotice(errorMessage(error)),
    onSuccess: (result) =>
      setNotice(`Безопасно удалено записей журнала: ${String(result.deleted)}.`),
  });

  const prepare = async () => {
    setNotice(undefined);
    await preview.refetch();
  };

  const formatShortDeviceId = (deviceId: string) => {
    if (deviceId.length <= 18) return deviceId;
    return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
  };

  const startRename = (deviceId: string, currentName: string) => {
    setEditingDeviceId(deviceId);
    setEditingDisplayName(currentName);
    setNotice(undefined);
  };

  const stopRename = () => {
    setEditingDeviceId(undefined);
    setEditingDisplayName('');
    setNotice(undefined);
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
            {status.data ? (
              <p className="mt-2 text-sm font-medium">
                {statusExplanation(status.data.connectionState)}
              </p>
            ) : null}
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

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" data-testid="sync-health">
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs text-muted-foreground">Устройство</p>
            <p className="mt-1 truncate font-semibold">
              {status.data?.currentDeviceName ?? 'Это устройство'}
            </p>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {status.data ? formatShortDeviceId(status.data.deviceId) : '—'}
            </p>
          </div>
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs text-muted-foreground">Ожидают отправки</p>
            <p className="mt-1 text-xl font-semibold">{status.data?.pendingCount ?? 0}</p>
          </div>
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs text-muted-foreground">Отправляются</p>
            <p className="mt-1 text-xl font-semibold">{status.data?.processingCount ?? 0}</p>
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
              {relativeSyncTime(status.data?.lastSuccessfulSync)}
            </p>
          </div>
        </div>

        {status.data?.failedCount ? (
          <div className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  Не удалось отправить {String(status.data.failedCount)} изменений
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Данные сохранены локально. Временные ошибки можно безопасно повторить.
                </p>
              </div>
              <Button
                disabled={action.isPending || status.data.retryableFailedCount === 0}
                onClick={() => action.mutate('sync')}
                size="small"
                variant="outline"
              >
                <RefreshCw className="mr-2 size-4" /> Повторить отправку
              </Button>
            </div>
            {status.data.failedItems.map((item) => (
              <div className="rounded-xl bg-background px-4 py-3 text-sm" key={item.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{item.entityLabel}</span>
                  <span className="text-xs text-muted-foreground">
                    {dateTime(item.lastAttemptAt ?? item.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{item.reason}</p>
              </div>
            ))}
          </div>
        ) : null}

        {status.data?.recoveryBlocked ? (
          <p className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
            Восстановление с сервера недоступно, пока на этом устройстве есть неотправленные
            изменения или ошибки отправки.
          </p>
        ) : null}

        {status.data?.devices.length ? (
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="border-b border-border px-5 py-4">
              <p className="font-semibold">Устройства и синхронизация</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Сервер хранит общий порядок изменений и отдельную позицию каждого устройства.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Устройство</TableHead>
                  <TableHead>Состояние</TableHead>
                  <TableHead>Последняя связь</TableHead>
                  <TableHead>Получено</TableHead>
                  <TableHead>Отправлено</TableHead>
                  <TableHead>Ожидает</TableHead>
                  <TableHead>Конфликты</TableHead>
                  <TableHead>Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.data.devices.map((device) => (
                  <TableRow key={device.deviceId}>
                    <TableCell>
                      <p className="font-medium text-lg">
                        {device.displayName ?? device.name ?? 'Устройство CRM'}
                        {device.deviceId === status.data.deviceId ? (
                          <Badge className="ml-2">Это устройство</Badge>
                        ) : null}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        ID: {formatShortDeviceId(device.deviceId)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge>{device.status === 'ACTIVE' ? 'Активно' : 'Отозвано'}</Badge>
                    </TableCell>
                    <TableCell>{dateTime(device.lastSeenAt)}</TableCell>
                    <TableCell>{dateTime(device.lastInboundSyncAt)}</TableCell>
                    <TableCell>{dateTime(device.lastOutboundSyncAt)}</TableCell>
                    <TableCell>
                      {device.pendingCount}
                      {device.errorCount > 0 ? (
                        <span className="ml-2 text-xs text-destructive">
                          Ошибок: {device.errorCount}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{device.conflictCount}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={device.status === 'REVOKED'}
                          onClick={() =>
                            startRename(
                              device.deviceId,
                              device.displayName ?? device.name ?? 'Устройство CRM',
                            )
                          }
                          size="small"
                          variant="outline"
                        >
                          <Pencil className="mr-2 size-4" /> Переименовать
                        </Button>
                        <Button
                          disabled={
                            device.status === 'REVOKED' || device.deviceId === status.data.deviceId
                          }
                          onClick={() => setRevokingDeviceId(device.deviceId)}
                          size="small"
                          variant="outline"
                        >
                          <ShieldX className="mr-2 size-4" /> Отозвать
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <Dialog
          closeLabel="Закрыть"
          description="Введите имя для отображения этого устройства."
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => stopRename()} variant="outline">
                Отмена
              </Button>
              <Button
                disabled={
                  rename.isPending ||
                  !editingDeviceId ||
                  !editingDisplayName.trim() ||
                  editingDisplayName.trim().length > 64
                }
                onClick={() => rename.mutate()}
              >
                Сохранить
              </Button>
            </div>
          }
          onClose={stopRename}
          open={Boolean(editingDeviceId)}
          title="Переименовать устройство"
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Новый человекочитаемый текст будет показываться в списке устройств на всех CRM после
              синхронизации.
            </p>
            <div className="space-y-2">
              <Label htmlFor="device-display-name">Новое имя</Label>
              <Input
                aria-label="Новое имя устройства"
                id="device-display-name"
                maxLength={64}
                onChange={(event) => setEditingDisplayName(event.target.value)}
                placeholder="Например: Ресепшен"
                value={editingDisplayName}
              />
            </div>
          </div>
        </Dialog>

        <Dialog
          closeLabel="Закрыть"
          description="Устройство немедленно потеряет доступ к отправке и получению изменений. История и конфликты сохранятся."
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => setRevokingDeviceId(undefined)} variant="outline">
                Отмена
              </Button>
              <Button
                disabled={revoke.isPending}
                onClick={() => revokingDeviceId && revoke.mutate(revokingDeviceId)}
              >
                Отозвать устройство
              </Button>
            </div>
          }
          onClose={() => setRevokingDeviceId(undefined)}
          open={Boolean(revokingDeviceId)}
          title="Отозвать устройство?"
        >
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Если на нём остались ожидающие изменения, они не попадут на сервер. Для возобновления
              работы потребуется новое подключение.
            </p>
            {(status.data?.devices.find(({ deviceId }) => deviceId === revokingDeviceId)
              ?.pendingCount ?? 0) > 0 ? (
              <p className="font-semibold text-amber-700">
                Сервер сообщает об ожидающих изменениях:{' '}
                {String(
                  status.data?.devices.find(({ deviceId }) => deviceId === revokingDeviceId)
                    ?.pendingCount ?? 0,
                )}
                . Проверьте это устройство перед отзывом.
              </p>
            ) : null}
          </div>
        </Dialog>

        {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

        <div
          className="rounded-2xl border border-border bg-background p-5"
          data-testid="aqsi-settings"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-semibold">Касса aQsi</p>
              <p className="mt-1 text-sm text-muted-foreground">
                API-ключ хранится только на ARAVA-WEB. CRM получает безопасный список касс.
              </p>
            </div>
            <Badge>
              {aqsiDevices.isSuccess
                ? aqsiDevices.data.selectedDeviceId
                  ? 'Касса выбрана'
                  : 'Касса не выбрана'
                : aqsiDevices.isError
                  ? 'API не настроен или недоступен'
                  : 'Проверка…'}
            </Badge>
          </div>
          {aqsiDevices.data?.devices.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="aqsi-device">Касса для оплаты</Label>
                <Select
                  id="aqsi-device"
                  onChange={(event) => selectAqsiDevice.mutate(Number(event.target.value))}
                  value={String(aqsiDevices.data.selectedDeviceId ?? '')}
                >
                  <option value="">Выберите кассу</option>
                  {aqsiDevices.data.devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.name} · ID {device.deviceId}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                disabled={aqsiDevices.isFetching}
                onClick={() => void aqsiDevices.refetch()}
                variant="outline"
              >
                Обновить список
              </Button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              {aqsiDevices.isError
                ? errorMessage(aqsiDevices.error)
                : 'После настройки AQSI_API_KEY на сервере здесь появятся доступные кассы.'}
            </p>
          )}
        </div>

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
          <Button
            disabled={diagnostics.isPending}
            onClick={() => diagnostics.mutate()}
            variant="outline"
          >
            <Stethoscope className="size-4" />
            {diagnostics.isPending ? 'Выполняется диагностика…' : 'Запустить диагностику'}
          </Button>
          <Button disabled={preview.isFetching} onClick={() => void prepare()} variant="outline">
            <CloudCog className="size-4" /> Первичная синхронизация
          </Button>
          <Button
            disabled={!status.data?.isPaired || reconciliation.isPending}
            onClick={() => reconciliation.mutate()}
            variant="outline"
          >
            <GitCompareArrows className="size-4" /> Сверить данные
          </Button>
          <Button
            disabled={!status.data?.isPaired || journal.isPending}
            onClick={() => journal.mutate()}
            variant="ghost"
          >
            Обслужить журнал
          </Button>
          <Button
            className="border-destructive text-destructive hover:bg-destructive/10"
            disabled={!status.data?.isPaired || status.data.recoveryBlocked || recover.isPending}
            onClick={() => {
              setNotice(undefined);
              setRecoveryConfirmationOpen(true);
            }}
            variant="outline"
          >
            Загрузить состояние с сервера
          </Button>
          <Button onClick={() => setShowLog((value) => !value)} variant="ghost">
            {showLog ? 'Скрыть журнал' : 'Журнал синхронизации'}
          </Button>
        </div>

        <Dialog
          closeLabel="Закрыть"
          description="Это специальное восстановление для нового или тестового компьютера. Обычную синхронизацию используйте для повседневной работы."
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => setRecoveryConfirmationOpen(false)} variant="outline">
                Отмена
              </Button>
              <Button disabled={recover.isPending} onClick={() => recover.mutate()}>
                {recover.isPending ? 'Создаём копию и загружаем…' : 'Подтвердить загрузку'}
              </Button>
            </div>
          }
          onClose={() => setRecoveryConfirmationOpen(false)}
          open={recoveryConfirmationOpen}
          title="Загрузить состояние с сервера?"
        >
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-destructive">
              Локальные синхронизируемые данные этого компьютера будут заменены состоянием сервера.
              Данные на сервере не изменятся.
            </p>
            <p className="text-muted-foreground">
              Перед изменением CRM автоматически создаст полную резервную копию. Устройство,
              авторизация, локальные пользователи и настройки подключения сохранятся. Если найдены
              локальные финансовые или другие несинхронизируемые записи, операция будет безопасно
              заблокирована.
            </p>
          </div>
        </Dialog>

        {conflicts.data?.length ? (
          <div
            className="space-y-3 rounded-2xl border border-border bg-muted/20 p-5"
            data-testid="integration-conflicts"
          >
            <div>
              <h3 className="text-lg font-semibold">Журнал согласования</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                CRM автоматически применяет последнее изменение, принятое сервером. Этот раздел
                нужен только для диагностики — выбирать версию вручную не требуется.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(
                  conflicts.data.reduce<Record<string, number>>((groups, conflict) => {
                    groups[conflict.display.category] =
                      (groups[conflict.display.category] ?? 0) + 1;
                    return groups;
                  }, {}),
                ).map(([category, count]) => (
                  <Badge key={category}>
                    {category} — {String(count)}
                  </Badge>
                ))}
              </div>
            </div>
            {conflicts.data.map((conflict) => (
              <div
                className="rounded-xl border border-border bg-background p-4"
                data-testid={`integration-conflict-${conflict.id}`}
                key={conflict.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {conflict.display.title}
                      {conflict.display.subject ? (
                        <span className="ml-2 font-normal">{conflict.display.subject}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {conflict.sourceDeviceName ?? 'Другое устройство'} ·{' '}
                      {dateTime(conflict.createdAt)}
                    </p>
                  </div>
                  <Badge>{conflictDiagnosticLabels[conflict.diagnosticStatus]}</Badge>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {[
                    {
                      label: conflict.display.canonicalLabel,
                      lines: conflict.display.canonicalLines,
                    },
                    {
                      label: conflict.display.candidateLabel,
                      lines: conflict.display.candidateLines,
                    },
                  ].map(({ label, lines }) => (
                    <div className="rounded-xl border border-border bg-muted/40 p-4" key={label}>
                      <p className="font-semibold">{label}</p>
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {lines.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <details className="mt-3 text-xs text-muted-foreground">
                  <summary>Техническая информация</summary>
                  <div className="mt-2 space-y-1 font-mono">
                    <p>Тип: {conflict.entityType}</p>
                    <p>Ревизия: {conflict.canonicalRevision}</p>
                    <p>Базовая ревизия: {conflict.baseRevision}</p>
                    <p>ID конфликта: {conflict.id}</p>
                    <p>ID устройства: {formatShortDeviceId(conflict.sourceDeviceId)}</p>
                  </div>
                </details>
                {conflict.diagnosticStatus === 'REAL_ERROR' ? (
                  <p className="mt-3 rounded-xl bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    Автоматическое согласование не завершено. CRM повторит безопасную обработку;
                    техническая причина доступна в журнале синхронизации.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {reconciliation.data ? (
          <div
            className="rounded-2xl border border-accent/50 bg-accent/10 p-5"
            data-testid="integration-reconciliation"
          >
            <h3 className="font-semibold">Предварительная сверка</h3>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
              <span>Совпадает: {reconciliation.data.identical.length}</span>
              <span>Только здесь: {reconciliation.data.localOnly.length}</span>
              <span>Только на сервере: {reconciliation.data.serverOnly.length}</span>
              <span>Требуют решения: {reconciliation.data.divergent.length}</span>
              <span>Неоднозначно: {reconciliation.data.ambiguous.length}</span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Сверка ничего не изменила. При подтверждении локальные уникальные записи пойдут через
              обычную очередь, серверные — через входящий журнал, а различающиеся версии станут
              явными конфликтами.
            </p>
            <Button
              className="mt-4"
              disabled={reconciliation.data.ambiguous.length > 0 || confirmReconciliation.isPending}
              onClick={() => confirmReconciliation.mutate()}
            >
              Подтвердить безопасное согласование
            </Button>
          </div>
        ) : null}

        {diagnostics.data ? (
          <div
            className="space-y-4 rounded-2xl border border-border bg-background p-5"
            data-testid="integration-diagnostics"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">
                  {diagnosticOverallLabels[diagnostics.data.overall]}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Проверено {dateTime(diagnostics.data.checkedAt)} · Устройство{' '}
                  {diagnostics.data.device.displayName ??
                    formatShortDeviceId(diagnostics.data.device.deviceId)}
                </p>
              </div>
              <Badge>{diagnosticOverallLabels[diagnostics.data.overall]}</Badge>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {diagnostics.data.checks.map((check) => {
                const Icon =
                  check.status === 'WORKING'
                    ? CheckCircle2
                    : check.status === 'WARNING'
                      ? TriangleAlert
                      : XCircle;
                const color =
                  check.status === 'WORKING'
                    ? 'text-success'
                    : check.status === 'WARNING'
                      ? 'text-amber-600'
                      : 'text-destructive';
                return (
                  <div className="flex gap-3 rounded-xl bg-muted/60 p-3" key={check.id}>
                    <Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${color}`} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{check.label}</p>
                        <span className={`text-xs font-medium ${color}`}>
                          {diagnosticLevelLabels[check.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{check.detail}</p>
                      {check.action ? (
                        <p className="mt-1 text-xs font-medium">Что делать: {check.action}</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

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
            <Button className="mt-4" onClick={() => action.mutate('initial')} variant="outline">
              Подтвердить первичную синхронизацию
            </Button>
          </div>
        ) : null}

        {log.data?.length ? (
          <div className="space-y-3">
            <h3 className="font-semibold">Журнал событий</h3>
            <div className="overflow-hidden rounded-2xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Операция</TableHead>
                    <TableHead>Результат</TableHead>
                    <TableHead>Детали</TableHead>
                    <TableHead>Сущность</TableHead>
                    <TableHead>Кол-во</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {log.data.map((entry) => {
                    const resultLabel = resultLabels[entry.result] ?? entry.result;
                    const entityType = entry.entityType ?? 'общая';
                    const operationLabel =
                      entityLabels[entityType] ?? `${entityType}: ${entry.entityId ?? ''}`;
                    return (
                      <TableRow key={entry.id}>
                        <TableCell>{dateTime(entry.createdAt)}</TableCell>
                        <TableCell>{entry.operation}</TableCell>
                        <TableCell>{resultLabel}</TableCell>
                        <TableCell className="max-w-xs truncate" title={entry.message ?? ''}>
                          {entry.message}
                        </TableCell>
                        <TableCell>{operationLabel}</TableCell>
                        <TableCell>{entry.attemptCount}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
