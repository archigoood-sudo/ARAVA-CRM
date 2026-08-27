import type { WebActionSummary } from '@arava/shared';
import { formatDate } from '@arava/shared';
import { Badge, Button, Card, CardContent, Dialog, LoadingState, Textarea } from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { FreezeDialog } from '../subscriptions/freeze-dialog';
import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const labels: Record<WebActionSummary['status'], string> = {
  CLAIMED: 'Обрабатывается',
  FAILED: 'Ошибка',
  FAILED_ACK_PENDING: 'Ошибка · отправка результата',
  PENDING: 'Ожидает решения',
  REJECTED: 'Отклонена',
  REJECTED_ACK_PENDING: 'Отклонена · отправка результата',
  SUCCEEDED: 'Выполнена',
  SUCCEEDED_ACK_PENDING: 'Выполнена · отправка результата',
};

export function WebActionsSection() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [freezing, setFreezing] =
    useState<Extract<WebActionSummary, { actionType: 'CLIENT_SUBSCRIPTION_FREEZE_REQUEST' }>>();
  const [rejecting, setRejecting] =
    useState<Extract<WebActionSummary, { actionType: 'CLIENT_SUBSCRIPTION_FREEZE_REQUEST' }>>();
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
  const visibleActions = actions.data?.actions;

  return (
    <Card className="mt-5" data-testid="web-actions-section">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary">
              Интеграция
            </p>
            <h2 className="mt-1 text-xl font-semibold">Заявки с сайта</h2>
            <p className="mt-1 text-sm text-secondary">
              Запросы клиентов и результаты автоматической обработки.
            </p>
          </div>
          <Button onClick={() => void actions.refetch()} size="small" variant="secondary">
            Обновить
          </Button>
        </div>
        {actions.isLoading ? <LoadingState label="Получаем заявки…" /> : null}
        {actions.data?.hasAutomaticProcessingWarning ? (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Не удалось обработать часть запросов. Повторим автоматически.
          </p>
        ) : null}
        {!actions.isLoading && !visibleActions?.length ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3">
            <p className="text-sm font-semibold">Новых заявок нет</p>
            <p className="text-xs text-muted-foreground">Проверка выполняется автоматически</p>
          </div>
        ) : null}
        <div className={visibleActions?.length ? 'mt-4 space-y-2' : ''}>
          {visibleActions?.map((action) => (
            <div className="rounded-2xl border border-border bg-muted/40 p-4" key={action.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{action.studentName}</p>
                  {action.actionType === 'CLIENT_SUBSCRIPTION_FREEZE_REQUEST' ? (
                    <>
                      <p className="mt-1 text-sm text-secondary">
                        {action.subscriptionName} · Запрос на заморозку
                      </p>
                      {action.reason ? (
                        <p className="mt-2 text-sm">Причина: {action.reason}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-secondary">
                      Изменение данных клиента
                      {action.requestedFields.length
                        ? ` · ${action.requestedFields
                            .map((field) =>
                              field === 'firstName'
                                ? 'имя'
                                : field === 'lastName'
                                  ? 'фамилия'
                                  : 'телефон',
                            )
                            .join(', ')}`
                        : ''}
                    </p>
                  )}
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
              {action.actionType === 'CLIENT_SUBSCRIPTION_FREEZE_REQUEST' &&
              (action.status === 'PENDING' || action.status === 'CLAIMED') ? (
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
