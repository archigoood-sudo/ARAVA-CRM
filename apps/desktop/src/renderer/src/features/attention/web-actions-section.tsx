import type { WebActionSummary } from '@arava/shared';
import { formatDate } from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  EmptyState,
  LoadingState,
  Textarea,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2 } from 'lucide-react';
import { useState } from 'react';

import { FreezeDialog } from '../subscriptions/freeze-dialog';
import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const labels: Record<WebActionSummary['status'], string> = {
  CLAIMED: 'Обрабатывается',
  FAILED: 'Ошибка',
  PENDING: 'Ожидает решения',
  REJECTED: 'Отклонена',
  REJECTED_ACK_PENDING: 'Отклонена · отправка результата',
  SUCCEEDED: 'Выполнена',
  SUCCEEDED_ACK_PENDING: 'Выполнена · отправка результата',
};

export function WebActionsSection() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [freezing, setFreezing] = useState<WebActionSummary>();
  const [rejecting, setRejecting] = useState<WebActionSummary>();
  const [reason, setReason] = useState('');
  const actions = useQuery({
    queryFn: () => getDesktopApi().webActions.list(getSessionToken()),
    queryKey: queryKeys.webActions(user?.id),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['web-actions'] });
  };
  const approve = useMutation({
    mutationFn: (days: number) =>
      getDesktopApi().webActions.approve(getSessionToken(), freezing?.id ?? '', { days }),
    onSuccess: async () => {
      setFreezing(undefined);
      await refresh();
    },
  });
  const reject = useMutation({
    mutationFn: () =>
      getDesktopApi().webActions.reject(
        getSessionToken(),
        rejecting?.id ?? '',
        reason.trim() || undefined,
      ),
    onSuccess: async () => {
      setRejecting(undefined);
      setReason('');
      await refresh();
    },
  });
  const visibleActions = actions.data;

  return (
    <Card className="mt-7" data-testid="web-actions-section">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary">
              Интеграция
            </p>
            <h2 className="mt-1 text-xl font-semibold">Заявки с сайта</h2>
            <p className="mt-1 text-sm text-secondary">
              Запросы клиентов, ожидающие решения администратора.
            </p>
          </div>
          <Button onClick={() => void actions.refetch()} size="small" variant="secondary">
            Обновить
          </Button>
        </div>
        {actions.isLoading ? <LoadingState label="Получаем заявки…" /> : null}
        {!actions.isLoading && !visibleActions?.length ? (
          <EmptyState
            icon={Globe2}
            title="Новых заявок нет"
            description="Запросы с сайта появятся здесь после синхронизации."
          />
        ) : null}
        <div className="mt-5 space-y-3">
          {visibleActions?.map((action) => (
            <div className="rounded-2xl border border-border bg-muted/40 p-4" key={action.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{action.studentName}</p>
                  <p className="mt-1 text-sm text-secondary">
                    {action.subscriptionName} · Запрос на заморозку
                  </p>
                  {action.reason ? <p className="mt-2 text-sm">Причина: {action.reason}</p> : null}
                  <p className="mt-2 text-xs text-secondary">
                    {formatDate(action.receivedAt, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <Badge>{labels[action.status]}</Badge>
              </div>
              {action.status === 'PENDING' || action.status === 'CLAIMED' ? (
                <div className="mt-4 flex gap-2">
                  <Button onClick={() => setFreezing(action)} size="small">
                    Одобрить
                  </Button>
                  <Button onClick={() => setRejecting(action)} size="small" variant="outline">
                    Отклонить
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
      <FreezeDialog
        error={approve.error instanceof Error ? approve.error.message : undefined}
        onClose={() => setFreezing(undefined)}
        onSubmit={async ({ days }) => {
          await approve.mutateAsync(days);
        }}
        open={Boolean(freezing)}
      />
      <Dialog
        closeLabel="Закрыть"
        description="Абонемент ученика не будет изменён."
        onClose={() => setRejecting(undefined)}
        open={Boolean(rejecting)}
        title="Отклонить заявку"
      >
        <div className="space-y-4">
          <Textarea
            aria-label="Причина отказа"
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Причина отказа (необязательно)"
            value={reason}
          />
          {reject.error instanceof Error ? (
            <p className="text-sm text-red-600">{reject.error.message}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setRejecting(undefined)} variant="outline">
              Отмена
            </Button>
            <Button disabled={reject.isPending} onClick={() => reject.mutate()}>
              Отклонить
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
