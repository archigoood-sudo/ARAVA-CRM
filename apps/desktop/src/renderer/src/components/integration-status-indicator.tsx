import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CloudOff, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../lib/desktop-api';
import { queryKeys } from '../lib/query-keys';
import { getSessionToken, useAuthStore } from '../stores/auth-store';

export function IntegrationStatusIndicator() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const status = useQuery({
    enabled: user?.role === 'OWNER' || user?.role === 'ADMIN',
    queryFn: () => getDesktopApi().integration.getStatus(getSessionToken()),
    queryKey: queryKeys.integrationStatus,
    refetchInterval: 20_000,
  });
  if ((user?.role !== 'OWNER' && user?.role !== 'ADMIN') || !status.data?.enabled) return null;
  const pending =
    status.data.pendingCount +
    status.data.processingCount +
    status.data.failedCount +
    status.data.conflictCount;
  const healthy = status.data.connectionState === 'CONNECTED' && pending === 0;
  const Icon = healthy
    ? CheckCircle2
    : status.data.connectionState === 'OFFLINE'
      ? CloudOff
      : RefreshCw;
  return (
    <button
      className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-xs font-medium text-muted-foreground"
      onClick={() => user.role === 'OWNER' && navigate('/settings#integration')}
      title="Интеграция с сайтом"
      type="button"
    >
      <Icon className="size-3.5" />
      {healthy
        ? 'Все изменения синхронизированы'
        : status.data.connectionState === 'AUTH_ERROR'
          ? 'Устройство не авторизовано'
          : status.data.connectionState === 'OFFLINE'
            ? navigator.onLine
              ? 'Сервер временно недоступен'
              : 'Нет подключения'
            : status.data.conflictCount > 0
              ? `Конфликты: ${String(status.data.conflictCount)}`
              : status.data.failedCount > 0
                ? `Ошибки: ${String(status.data.failedCount)}`
                : pending > 0
                  ? `Ожидают отправки: ${String(pending)}`
                  : 'Синхронизация…'}
    </button>
  );
}
