import {
  formatDate,
  type PayrollAccrualSummary,
  type PayrollPeriodDetail,
  type PayrollPeriodStatus,
  type PayrollType,
  type PayoutCalculationMode,
  type PayoutCategory,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  formatMoney,
  Input,
  Label,
  Money,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Check, CircleAlert, FileDown, Plus, Printer, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken } from '../../stores/auth-store';

const statusLabels: Record<PayrollPeriodStatus, string> = {
  APPROVED: 'УТВЕРЖДЁН',
  CALCULATED: 'РАССЧИТАН',
  CANCELLED: 'ОТМЕНЁН',
  DRAFT: 'ЧЕРНОВИК',
  PAID: 'ВЫПЛАЧЕН',
};
const categoryLabels: Record<PayoutCategory, string> = {
  MAKEUP: 'Отработка',
  PERSONAL_LESSON: 'Персональное',
  PROMOTIONAL_FREE: 'Промо / бесплатное',
  REGULAR_ATTENDANCE: 'Обычное посещение',
  SINGLE_VISIT: 'Разовое посещение',
  SUBSTITUTION: 'Замена',
  TRIAL: 'Пробное',
};
const modeLabels: Record<PayoutCalculationMode, string> = {
  FIXED_PER_ATTENDANCE: 'За посещение',
  FIXED_PER_LESSON: 'За занятие',
  NO_PAYOUT: 'Без выплаты',
  PERCENTAGE: 'Процент от базы',
};
const legacyLabels: Record<PayrollType, string> = {
  COMBINED: 'Комбинированная ставка',
  FIXED_MONTHLY: 'Ежемесячно',
  FIXED_PER_LESSON: 'За занятие',
  PERCENT_OF_REVENUE: 'Процент от выручки',
  PER_ATTENDEE: 'За ученика',
};

function monthDates(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const date = (value: Date) => value.toISOString().slice(0, 10);
  return { from: date(new Date(year, month, 1)), to: date(new Date(year, month + 1, 0)) };
}

function rateLabel(row: PayrollAccrualSummary): string {
  if (row.payoutMode === 'PERCENTAGE')
    return `${String(row.payoutPercentage ?? 0).replace('.', ',')}%`;
  if (row.payoutMode === 'NO_PAYOUT') return '0 ₽';
  if (row.payoutMode) return formatMoney(row.payoutAmount ?? row.baseAmount);
  return row.payoutCategory ? 'Не настроено' : formatMoney(row.baseAmount);
}

function calculationLabel(row: PayrollAccrualSummary): string {
  return row.payoutMode
    ? modeLabels[row.payoutMode]
    : row.payoutCategory
      ? 'Не настроено'
      : legacyLabels[row.type];
}

function SalarySheet({
  period,
  trainerName,
}: {
  period: PayrollPeriodDetail;
  trainerName: string;
}) {
  const lessonRows = period.accruals.filter((row) => row.lessonId);
  const attendeeCount = lessonRows.reduce((sum, row) => sum + (row.attendeeCount ?? 0), 0);
  const lessonTotal = lessonRows.reduce((sum, row) => sum + row.calculatedAmount, 0);
  const adjustments = period.accruals.reduce((sum, row) => sum + row.manualAdjustment, 0);
  return (
    <section className="payroll-print-document mt-5 rounded-2xl border border-border bg-white p-7 text-black shadow-sm print:mt-0 print:border-0 print:p-0 print:shadow-none">
      <style>{`@media print { @page { size: A4; margin: 12mm; } body * { visibility: hidden !important; } .payroll-print-document, .payroll-print-document * { visibility: visible !important; } .payroll-print-document { position: absolute; inset: 0; width: 100%; margin: 0 !important; } .payroll-print-document thead { display: table-header-group; } .payroll-print-document tr { break-inside: avoid; } .payroll-print-document .sheet-total { break-inside: avoid; } }`}</style>
      <header className="border-b-2 border-black pb-4">
        <p className="text-sm font-semibold uppercase tracking-[0.18em]">
          ARAVA CRM · Студия танца
        </p>
        <div className="mt-3 flex items-start justify-between gap-5">
          <div>
            <h2 className="text-2xl font-bold">Расчётный лист тренера</h2>
            <p className="mt-1 text-sm">№ {period.sheetNumber ?? 'формируется'}</p>
          </div>
          <Badge className="border border-black bg-white text-black">
            {statusLabels[period.status]}
          </Badge>
        </div>
        <dl className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-neutral-600">Тренер</dt>
            <dd className="font-semibold">{period.trainerName ?? trainerName}</dd>
          </div>
          <div>
            <dt className="text-neutral-600">Расчётный период</dt>
            <dd className="font-semibold">
              {formatDate(period.dateFrom)} — {formatDate(period.dateTo)}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-600">Дата формирования</dt>
            <dd>{formatDate(period.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-neutral-600">Статус</dt>
            <dd>{statusLabels[period.status]}</dd>
          </div>
        </dl>
      </header>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[840px] border-collapse text-xs">
          <thead>
            <tr className="border-y border-black text-left">
              <th className="p-2">№</th>
              <th className="p-2">Дата / время</th>
              <th className="p-2">Группа</th>
              <th className="p-2">Категория</th>
              <th className="p-2 text-center">Ученики</th>
              <th className="p-2">Вид расчёта</th>
              <th className="p-2">Ставка</th>
              <th className="p-2">База</th>
              <th className="p-2 text-right">Сумма</th>
              <th className="p-2">Примечание</th>
            </tr>
          </thead>
          <tbody>
            {lessonRows.map((row, index) => (
              <tr className="border-b border-neutral-300 align-top" key={row.id}>
                <td className="p-2">{index + 1}</td>
                <td className="p-2 whitespace-nowrap">
                  {row.lessonStartsAt
                    ? formatDate(row.lessonStartsAt, { dateStyle: 'short', timeStyle: 'short' })
                    : '—'}
                </td>
                <td className="p-2">{row.groupName ?? '—'}</td>
                <td className="p-2">
                  {row.payoutCategory ? categoryLabels[row.payoutCategory] : '—'}
                </td>
                <td className="p-2 text-center">{row.attendeeCount ?? 0}</td>
                <td className="p-2">{calculationLabel(row)}</td>
                <td className="p-2 whitespace-nowrap">{rateLabel(row)}</td>
                <td className="p-2 whitespace-nowrap">
                  {row.revenueBase === undefined ? '—' : formatMoney(row.revenueBase)}
                </td>
                <td className="p-2 text-right whitespace-nowrap">{formatMoney(row.finalAmount)}</td>
                <td className="p-2">
                  {row.manualAdditionReason ? (
                    <>Добавлено вручную: {row.manualAdditionReason}</>
                  ) : (
                    (row.comment ?? '—')
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="sheet-total ml-auto mt-5 max-w-md border-t-2 border-black pt-3 text-sm">
        <div className="flex justify-between">
          <span>Учтено занятий</span>
          <b>{lessonRows.length}</b>
        </div>
        <div className="mt-2 flex justify-between">
          <span>Учитываемых посещений</span>
          <b>{attendeeCount}</b>
        </div>
        <div className="mt-2 flex justify-between">
          <span>Начислено по занятиям</span>
          <b>{formatMoney(lessonTotal)}</b>
        </div>
        {adjustments !== 0 ? (
          <div className="mt-2 flex justify-between">
            <span>Ручные корректировки</span>
            <b>{formatMoney(adjustments)}</b>
          </div>
        ) : null}
        <div className="mt-3 flex justify-between border-t border-black pt-3 text-base">
          <b>Итого к выплате</b>
          <b>{formatMoney(period.totalAmount)}</b>
        </div>
      </section>
      <section className="sheet-total mt-12 grid gap-7 text-sm">
        <div>
          <p>Расчёт составил</p>
          <div className="mt-8 grid grid-cols-2 gap-8">
            <span className="border-t border-black pt-1 text-center text-xs">подпись</span>
            <span className="border-t border-black pt-1 text-center text-xs">ФИО</span>
          </div>
        </div>
        <div>
          <p>Тренер</p>
          <div className="mt-8 grid grid-cols-2 gap-8">
            <span className="border-t border-black pt-1 text-center text-xs">подпись</span>
            <span className="border-t border-black pt-1 text-center text-xs">ФИО</span>
          </div>
        </div>
        <div>
          <p>Выплату получил</p>
          <div className="mt-8 grid grid-cols-2 gap-8">
            <span className="border-t border-black pt-1 text-center text-xs">подпись</span>
            <span className="border-t border-black pt-1 text-center text-xs">ФИО</span>
          </div>
          <p className="mt-7">Дата получения: «___» __________ 20___ г.</p>
        </div>
      </section>
    </section>
  );
}

export function TrainerSalaryCard({
  trainerId,
  trainerName,
  isOwner,
}: {
  trainerId: string;
  trainerName: string;
  isOwner: boolean;
}) {
  const client = useQueryClient();
  const current = monthDates();
  const [dateFrom, setDateFrom] = useState(current.from);
  const [dateTo, setDateTo] = useState(current.to);
  const [selectedId, setSelectedId] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedLessonId, setSelectedLessonId] = useState<string>();
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string>();
  const history = useQuery({
    queryKey: ['trainer-payroll-history', trainerId],
    queryFn: () => getDesktopApi().payroll.listPeriods(getSessionToken()),
  });
  const periods = useMemo(
    () => (history.data ?? []).filter((period) => period.trainerId === trainerId),
    [history.data, trainerId],
  );
  const selected = useQuery({
    enabled: Boolean(selectedId),
    queryKey: ['trainer-payroll-period', selectedId],
    queryFn: () => getDesktopApi().payroll.getPeriod(getSessionToken(), selectedId ?? ''),
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['trainer-payroll-history', trainerId] }),
      client.invalidateQueries({ queryKey: ['trainers', 'profile', trainerId] }),
      selectedId
        ? client.invalidateQueries({ queryKey: ['trainer-payroll-period', selectedId] })
        : Promise.resolve(),
    ]);
  };
  const calculate = useMutation({
    mutationFn: async () => {
      const period = await getDesktopApi().payroll.createPeriod(getSessionToken(), {
        dateFrom,
        dateTo,
        trainerId,
      });
      await getDesktopApi().payroll.calculatePeriod(getSessionToken(), period.id);
      return period.id;
    },
    onSuccess: async (id) => {
      setSelectedId(id);
      await refresh();
    },
    onError: (error) => setMessage(getErrorMessage(error, 'Не удалось рассчитать зарплату.')),
  });
  const approve = useMutation({
    mutationFn: () => getDesktopApi().payroll.approvePeriod(getSessionToken(), selectedId ?? ''),
    onSuccess: refresh,
    onError: (error) => setMessage(getErrorMessage(error, 'Не удалось утвердить расчёт.')),
  });
  const cancel = useMutation({
    mutationFn: () => getDesktopApi().payroll.deletePeriod(getSessionToken(), selectedId ?? ''),
    onSuccess: async () => {
      setSelectedId(undefined);
      await refresh();
    },
    onError: (error) => setMessage(getErrorMessage(error, 'Не удалось отменить расчёт.')),
  });
  const candidates = useQuery({
    enabled: addOpen && Boolean(selectedId),
    queryKey: ['trainer-payroll-candidates', selectedId],
    queryFn: () => getDesktopApi().payroll.listCandidates(getSessionToken(), selectedId ?? ''),
  });
  const addLesson = useMutation({
    mutationFn: () =>
      getDesktopApi().payroll.addLesson(getSessionToken(), selectedId ?? '', {
        lessonId: selectedLessonId ?? '',
        reason,
      }),
    onSuccess: async () => {
      setAddOpen(false);
      setSelectedLessonId(undefined);
      setReason('');
      await Promise.all([
        refresh(),
        client.invalidateQueries({ queryKey: ['trainer-payroll-candidates', selectedId] }),
      ]);
    },
    onError: (error) => setMessage(getErrorMessage(error, 'Не удалось добавить занятие.')),
  });
  const diagnostic = useMutation({
    mutationFn: () =>
      getDesktopApi().payroll.exportDiagnostic(getSessionToken(), selectedId ?? '', 'json'),
    onSuccess: (result) =>
      setMessage(
        result.status === 'SAVED'
          ? `Диагностика сохранена: ${String(result.lessonCount)} строк.`
          : 'Сохранение диагностики отменено.',
      ),
    onError: (error) => setMessage(getErrorMessage(error, 'Не удалось сохранить диагностику.')),
  });
  const period = selected.data;
  return (
    <>
      <Card className="border-neutral-800 bg-sidebar text-white">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Зарплата</CardTitle>
            <p className="mt-1 text-sm text-neutral-400">
              Расчётный лист формируется только для этого тренера.
            </p>
          </div>
          {isOwner ? (
            <Button onClick={() => calculate.mutate()} disabled={calculate.isPending}>
              <Calculator className="size-4" /> Рассчитать зарплату
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label>
              С даты
              <Input
                className="mt-1 text-black"
                onChange={(event) => setDateFrom(event.target.value)}
                type="date"
                value={dateFrom}
              />
            </Label>
            <Label>
              По дату
              <Input
                className="mt-1 text-black"
                onChange={(event) => setDateTo(event.target.value)}
                type="date"
                value={dateTo}
              />
            </Label>
          </div>
          {message ? <p className="mt-4 rounded-xl bg-white/10 p-3 text-sm">{message}</p> : null}
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              История расчётов
            </p>
            <div className="mt-3 space-y-2">
              {periods.length ? (
                periods.map((item) => (
                  <button
                    className="flex w-full items-center justify-between rounded-xl bg-white/5 px-3 py-3 text-left hover:bg-white/10"
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span>
                      <b>
                        {formatDate(item.dateFrom)} — {formatDate(item.dateTo)}
                      </b>
                      <span className="ml-2 text-xs text-neutral-400">
                        {item.sheetNumber ?? 'Лист формируется'}
                      </span>
                    </span>
                    <span className="text-right">
                      <Badge className="bg-white/10 text-white">{statusLabels[item.status]}</Badge>
                      <Money amount={item.totalAmount} className="mt-1 block text-sm" />
                    </span>
                  </button>
                ))
              ) : (
                <p className="text-sm text-neutral-400">Расчётов пока нет.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      {period ? (
        <Card className="mt-5">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Предпросмотр расчёта</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {period.trainerName ?? trainerName} · {formatDate(period.dateFrom)} —{' '}
                {formatDate(period.dateTo)}
              </p>
            </div>
            <Badge>{statusLabels[period.status]}</Badge>
          </CardHeader>
          <CardContent>
            {period.unconfiguredPayoutCount ? (
              <div className="mb-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <CircleAlert className="size-4 shrink-0" />
                Есть строки «Не настроено». Утверждение заблокировано до настройки выплаты.
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => window.print()} variant="outline">
                <Printer className="size-4" /> Печать / PDF
              </Button>
              <Button onClick={() => diagnostic.mutate()} variant="outline">
                <FileDown className="size-4" /> Диагностика
              </Button>
              {isOwner && period.status === 'CALCULATED' ? (
                <>
                  <Button onClick={() => setAddOpen(true)} variant="outline">
                    <Plus className="size-4" /> Добавить занятие
                  </Button>
                  <Button
                    disabled={approve.isPending || Boolean(period.unconfiguredPayoutCount)}
                    onClick={() => approve.mutate()}
                  >
                    <Check className="size-4" /> Утвердить
                  </Button>
                  <Button
                    disabled={cancel.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Отменить расчёт? Будут удалены только расчётный лист и начисления. Исходные занятия и посещаемость сохранятся.',
                        )
                      )
                        cancel.mutate();
                    }}
                    variant="outline"
                  >
                    <Trash2 className="size-4" /> Отменить расчёт
                  </Button>
                </>
              ) : null}
            </div>
            <SalarySheet period={period} trainerName={trainerName} />
          </CardContent>
        </Card>
      ) : null}
      <Dialog
        closeLabel="Закрыть"
        description="Выберите только фактически проведённое занятие этого тренера и укажите причину."
        onClose={() => setAddOpen(false)}
        open={addOpen}
        title="Добавить занятие"
      >
        <div className="max-h-[52vh] space-y-2 overflow-y-auto">
          {candidates.data?.map((item) => (
            <button
              className={`w-full rounded-xl border p-3 text-left ${selectedLessonId === item.id ? 'border-accent bg-accent-soft/30' : 'border-border'}`}
              disabled={!item.canAdd}
              key={item.id}
              onClick={() => setSelectedLessonId(item.id)}
            >
              <p className="font-semibold">
                {formatDate(item.startsAt, { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                {item.groupName}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.status} · {item.attendanceCount} присутствий · {categoryLabels[item.category]}
              </p>
              <p className="mt-1 text-xs">{item.exclusionReason}</p>
            </button>
          ))}
        </div>
        <Label className="mt-4 block">
          Почему добавлено вручную?
          <Input
            className="mt-1"
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </Label>
        <Button
          className="mt-4"
          disabled={!selectedLessonId || reason.trim().length < 2 || addLesson.isPending}
          onClick={() => addLesson.mutate()}
        >
          Добавить в расчёт
        </Button>
      </Dialog>
    </>
  );
}
