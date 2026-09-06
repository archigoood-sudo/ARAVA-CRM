import { formatDate, type PayrollPeriodStatus } from '@arava/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Money } from '@arava/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const statusLabels: Record<PayrollPeriodStatus, string> = {
  APPROVED: 'УТВЕРЖДЁН',
  CALCULATED: 'РАССЧИТАН',
  CANCELLED: 'ОТМЕНЁН',
  DRAFT: 'ЧЕРНОВИК',
  PAID: 'ВЫПЛАЧЕН',
};

export function LegacyPayrollPage() {
  const { periodId = '' } = useParams();
  const actor = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const period = useQuery({
    enabled: actor?.role === 'OWNER' && Boolean(periodId),
    queryKey: ['legacy-payroll-period', periodId],
    queryFn: () => getDesktopApi().payroll.getPeriod(getSessionToken(), periodId),
  });
  const remove = useMutation({
    mutationFn: () => getDesktopApi().payroll.deletePeriod(getSessionToken(), periodId),
    onSuccess: () => navigate('/attention', { replace: true }),
  });

  if (actor?.role !== 'OWNER')
    return (
      <main className="mx-auto w-full max-w-3xl p-9">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Старые расчёты доступны только владельцу.
          </CardContent>
        </Card>
      </main>
    );

  const data = period.data;
  const trainers = data
    ? [...new Set(data.accruals.map((row) => row.coachName).filter(Boolean))]
    : [];
  const canDelete = data?.status === 'DRAFT' || data?.status === 'CALCULATED';
  return (
    <main className="mx-auto w-full max-w-3xl animate-fade-in p-9 pb-16">
      <Button onClick={() => navigate('/attention')} variant="outline">
        <ArrowLeft className="size-4" /> К списку задач
      </Button>
      <Card className="mt-5">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Старый расчёт зарплаты</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Совместимый просмотр расчёта, созданного до перехода зарплаты в карточку тренера.
            </p>
          </div>
          {data ? <Badge>{statusLabels[data.status]}</Badge> : null}
        </CardHeader>
        <CardContent>
          {period.isLoading ? (
            <p className="text-sm text-muted-foreground">Загружаем расчёт…</p>
          ) : null}
          {period.isError ? (
            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
              {getErrorMessage(period.error, 'Не удалось открыть старый расчёт.')}
            </p>
          ) : null}
          {data ? (
            <>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Период</dt>
                  <dd className="font-semibold">
                    {formatDate(data.dateFrom)} — {formatDate(data.dateTo)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Филиал</dt>
                  <dd className="font-semibold">{data.branchId ?? 'Все филиалы'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Начислений</dt>
                  <dd className="font-semibold">{data.accruals.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Итого</dt>
                  <dd className="font-semibold">
                    <Money amount={data.totalAmount} />
                  </dd>
                </div>
              </dl>
              <div className="mt-5 rounded-xl bg-muted p-4 text-sm">
                <p className="font-semibold">Тренеры в расчёте</p>
                <p className="mt-1 text-muted-foreground">
                  {trainers.join(', ') || 'Нет начислений'}
                </p>
              </div>
              {canDelete ? (
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <div className="flex gap-2">
                    <CircleAlert className="size-4 shrink-0" />
                    <p>
                      Удаляются только этот расчёт и его начисления. Занятия, посещаемость, платежи,
                      абонементы и правила выплат сохраняются.
                    </p>
                  </div>
                  <Button
                    className="mt-4"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Удалить старый расчёт и все его начисления? Исходные данные не будут удалены.',
                        )
                      )
                        remove.mutate();
                    }}
                    variant="outline"
                  >
                    <Trash2 className="size-4" /> Удалить старый расчёт
                  </Button>
                  {remove.isError ? (
                    <p className="mt-3 text-red-800">
                      {getErrorMessage(remove.error, 'Не удалось удалить расчёт.')}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-5 flex gap-2 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
                  <CircleAlert className="size-4 shrink-0" />
                  {data.status === 'PAID'
                    ? 'Расчёт связан с проведённой выплатой и не может быть удалён.'
                    : 'Утверждённый расчёт является финансовым snapshot и не может быть удалён.'}
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
