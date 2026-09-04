import {
  PAYROLL_TYPES,
  formatDate,
  type PayrollDiagnosticFormat,
  type PayrollRuleInput,
  type PayrollType,
  type PayoutCalculationMode,
  type PayoutCategory,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Label,
  Money,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@arava/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Check, Clock3, CreditCard, Plus, Printer, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { buildTrainerPayrollSheets } from './payroll-sheet';

const payrollLabels: Record<PayrollType, string> = {
  COMBINED: 'Комбинированная',
  FIXED_MONTHLY: 'Фиксированная в месяц',
  FIXED_PER_LESSON: 'Фиксированная за занятие',
  PERCENT_OF_REVENUE: 'Процент от выручки',
  PER_ATTENDEE: 'За каждого ученика',
};
const periodLabels = {
  APPROVED: 'Утверждён',
  CALCULATED: 'Рассчитан',
  CANCELLED: 'Отменён',
  DRAFT: 'Черновик',
  PAID: 'Выплачен',
} as const;
const payoutCategoryLabels: Record<PayoutCategory, string> = {
  MAKEUP: 'Отработка',
  PERSONAL_LESSON: 'Персональное',
  PROMOTIONAL_FREE: 'Промо / бесплатное',
  REGULAR_ATTENDANCE: 'Обычное посещение',
  SINGLE_VISIT: 'Разовое посещение',
  SUBSTITUTION: 'Замена',
  TRIAL: 'Пробное',
};
const payoutModeLabels: Record<PayoutCalculationMode, string> = {
  FIXED_PER_ATTENDANCE: 'за посещение',
  FIXED_PER_LESSON: 'за занятие',
  NO_PAYOUT: 'без выплаты',
  PERCENTAGE: 'процент',
};
function inputDate(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function attendanceCalculation(item: {
  attendeeCount?: number | undefined;
  baseAmount: number;
  type: PayrollType;
}): string {
  if (item.attendeeCount === undefined) return '—';
  if (item.type === 'PER_ATTENDEE')
    return `${String(item.attendeeCount)} × ${String(item.baseAmount / 100)} ₽`;
  if (item.type === 'COMBINED')
    return `${String(item.attendeeCount)} присутствовали · комбинированная ставка`;
  return `${String(item.attendeeCount)} присутствовали`;
}

export function PayrollPage() {
  const user = useAuthStore((state) => state.user);
  const coachOnly = user?.role === 'COACH';
  const canApprove = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const isOwner = user?.role === 'OWNER';
  const client = useQueryClient();
  const now = new Date();
  const [dialog, setDialog] = useState<'rule' | 'period' | 'diagnostic'>();
  const [sheetCoachId, setSheetCoachId] = useState<string>();
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>();
  const [branchId, setBranchId] = useState('');
  const [coachId, setCoachId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [type, setType] = useState<PayrollType>('PER_ATTENDEE');
  const [rate, setRate] = useState('');
  const [secondRate, setSecondRate] = useState('');
  const [validFrom, setValidFrom] = useState(inputDate(now));
  const [validTo, setValidTo] = useState('');
  const [diagnosticFormat, setDiagnosticFormat] = useState<PayrollDiagnosticFormat>('json');
  const [dateFrom, setDateFrom] = useState(
    inputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
  );
  const [dateTo, setDateTo] = useState(inputDate(now));
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: ['branches'],
  });
  const staff = useQuery({
    queryFn: () => getDesktopApi().users.staffOptions(getSessionToken()),
    queryKey: ['staff-options'],
  });
  const groups = useQuery({
    queryFn: () => getDesktopApi().groups.list(getSessionToken(), {}),
    queryKey: ['groups', 'payroll'],
  });
  const rules = useQuery({
    queryFn: () => getDesktopApi().payroll.listRules(getSessionToken()),
    queryKey: ['payroll-rules'],
  });
  const periods = useQuery({
    queryFn: () => getDesktopApi().payroll.listPeriods(getSessionToken()),
    queryKey: ['payroll-periods'],
  });
  const registers = useQuery({
    queryFn: () =>
      coachOnly ? Promise.resolve([]) : getDesktopApi().cash.listRegisters(getSessionToken()),
    queryKey: ['cash-registers', 'payroll'],
  });
  const selected = useQuery({
    enabled: Boolean(selectedPeriodId),
    queryFn: () => getDesktopApi().payroll.getPeriod(getSessionToken(), selectedPeriodId ?? ''),
    queryKey: ['payroll-period', selectedPeriodId],
  });
  const coachView = useQuery({
    enabled: coachOnly,
    queryFn: () => getDesktopApi().payroll.coachView(getSessionToken(), dateFrom, dateTo),
    queryKey: ['payroll-coach', dateFrom, dateTo],
  });
  const trainerSheets = useMemo(() => {
    return buildTrainerPayrollSheets(selected.data?.accruals ?? []);
  }, [selected.data?.accruals]);
  const sheetTrainer = trainerSheets.find(({ coachId }) => coachId === sheetCoachId);
  const sheetAccruals = sheetTrainer?.rows ?? [];
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['payroll-period'] }),
      client.invalidateQueries({ queryKey: ['payroll-periods'] }),
      client.invalidateQueries({ queryKey: ['payroll-rules'] }),
      client.invalidateQueries({ queryKey: ['payroll-coach'] }),
      client.invalidateQueries({ queryKey: ['expenses'] }),
      client.invalidateQueries({ queryKey: ['cash'] }),
    ]);
    if (selectedPeriodId) await selected.refetch();
  };
  const createRule = async () => {
    const rubles = (value: string) => Math.round(Number(value) * 100);
    const input: PayrollRuleInput = {
      branchId,
      coachId,
      groupId: groupId || undefined,
      isActive: true,
      type,
      validFrom,
      validTo: validTo || undefined,
      ...(type === 'FIXED_PER_LESSON' || type === 'COMBINED' ? { fixedAmount: rubles(rate) } : {}),
      ...(type === 'PER_ATTENDEE' ? { amountPerAttendee: rubles(rate) } : {}),
      ...(type === 'COMBINED' ? { amountPerAttendee: rubles(secondRate) } : {}),
      ...(type === 'PERCENT_OF_REVENUE' ? { percent: Number(rate) } : {}),
      ...(type === 'FIXED_MONTHLY' ? { monthlyAmount: rubles(rate) } : {}),
    };
    try {
      await getDesktopApi().payroll.createRule(getSessionToken(), input);
      await refresh();
      setDialog(undefined);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось сохранить правило.'));
    }
  };
  const createPeriod = async () => {
    try {
      const period = await getDesktopApi().payroll.createPeriod(getSessionToken(), {
        branchId: branchId || undefined,
        dateFrom,
        dateTo,
      });
      setSelectedPeriodId(period.id);
      await refresh();
      setDialog(undefined);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось создать расчётный период.'));
    }
  };
  const periodAction = async (action: 'calculate' | 'approve' | 'pay') => {
    if (!selected.data) return;
    try {
      if (action === 'calculate')
        await getDesktopApi().payroll.calculatePeriod(getSessionToken(), selected.data.id);
      else if (action === 'approve')
        await getDesktopApi().payroll.approvePeriod(getSessionToken(), selected.data.id);
      else {
        const register = registers.data?.find(
          (item) =>
            item.isActive && (!selected.data.branchId || item.branchId === selected.data.branchId),
        );
        if (!register) throw new Error('Создайте активную кассу филиала.');
        await getDesktopApi().payroll.payPeriod(getSessionToken(), selected.data.id, {
          cashRegisterId: register.id,
          occurredAt: new Date().toISOString(),
        });
      }
      await refresh();
    } catch (caught) {
      setError(getErrorMessage(caught, 'Операция расчёта не выполнена.'));
    }
  };

  const exportDiagnostic = async () => {
    if (!selected.data) return;
    setInfo(undefined);
    try {
      const result = await getDesktopApi().payroll.exportDiagnostic(
        getSessionToken(),
        selected.data.id,
        diagnosticFormat,
      );
      setDialog(undefined);
      if (result.status === 'EMPTY') setError('По периоду нет данных для диагностики.');
      else if (result.status === 'CANCELLED') setInfo('Сохранение диагностики отменено.');
      else setInfo(`Диагностика сохранена: ${result.lessonCount} записей.`);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось сохранить диагностику.'));
    }
  };

  const deletePeriod = async () => {
    if (!selected.data) return;
    if (!isOwner) return;
    const period = selected.data;
    const coachCount = new Map(period.accruals.map((item) => [item.coachId, item.coachName]));
    const trainerSummary = [...coachCount.values()].join(', ');
    if (period.status !== 'DRAFT' && period.status !== 'CALCULATED') {
      setError(
        `Нельзя удалять период в статусе «${periodLabels[period.status]}». ` +
          'Удаление доступно только для статусов Черновик / Рассчитан.',
      );
      return;
    }
    const confirmed = window.confirm(
      [
        'Вы точно хотите удалить расчётный период?',
        `Период: ${formatDate(period.dateFrom)} — ${formatDate(period.dateTo)}`,
        `Статус: ${periodLabels[period.status]}`,
        `Тренеры: ${trainerSummary || 'не задействованы'}`,
        `Начислений: ${String(period.accruals.length)}`,
        '',
        'Будут удалены только производные данные расчёта:',
        '• PayrollPeriod',
        '• PayrollAccrual',
        '• snapshot/cached-снимки расчёта',
        '',
        'Исходные занятия, посещаемость, платежи и правила не будут изменены.',
      ].join('\n'),
    );
    if (!confirmed) return;
    setError(undefined);
    try {
      const result = await getDesktopApi().payroll.deletePeriod(getSessionToken(), period.id);
      setInfo(
        `Расчёт ${result.periodId} удалён (${String(result.deletedAccrualCount)} начислений).`,
      );
      setSelectedPeriodId(undefined);
      await refresh();
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось удалить расчёт.'));
    }
  };
  if (coachOnly)
    return (
      <main className="mx-auto w-full max-w-[1300px] animate-fade-in p-9 pb-14">
        <PageHeader
          description="Личные начисления по завершённым занятиям. Общие финансовые данные скрыты."
          title="Моя зарплата"
        />
        <Card className="mb-5 grid grid-cols-2 gap-3 p-4">
          <Label>
            С даты
            <Input
              onChange={(event) => setDateFrom(event.target.value)}
              type="date"
              value={dateFrom}
            />
          </Label>
          <Label>
            По дату
            <Input onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} />
          </Label>
        </Card>
        {!coachView.data?.length ? (
          <EmptyState
            description="В выбранном периоде начислений пока нет."
            icon={UsersRound}
            title="Начислений нет"
          />
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Филиал</TableHead>
                  <TableHead>Группа</TableHead>
                  <TableHead>Расчёт</TableHead>
                  <TableHead>Присутствовали</TableHead>
                  <TableHead className="text-right">Начислено</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coachView.data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.lessonStartsAt ? formatDate(item.lessonStartsAt) : '—'}
                    </TableCell>
                    <TableCell>{item.branchName}</TableCell>
                    <TableCell>{item.groupName ?? 'Все группы'}</TableCell>
                    <TableCell>{payrollLabels[item.type]}</TableCell>
                    <TableCell>{attendanceCalculation(item)}</TableCell>
                    <TableCell className="text-right">
                      <Money amount={item.finalAmount} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </main>
    );
  return (
    <main className="mx-auto w-full max-w-[1540px] animate-fade-in p-9 pb-14">
      <PageHeader
        action={
          <div className="flex gap-2">
            <Button onClick={() => setDialog('rule')} variant="outline">
              <Plus className="size-4" />
              Правило
            </Button>
            <Button onClick={() => setDialog('period')}>
              <Calculator className="size-4" />
              Новый расчёт
            </Button>
          </div>
        }
        description="Правила тренеров, начисления по занятиям, утверждение и выплата."
        title="Зарплата тренеров"
      />
      {error ? (
        <p className="mb-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : null}
      {info ? <p className="mb-4 rounded-xl bg-accent/10 p-3 text-sm text-accent">{info}</p> : null}
      <div className="grid grid-cols-[1fr_1.4fr] gap-5">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Расчётные периоды</h2>
          <div className="space-y-3">
            {periods.data?.map((period) => (
              <button
                className={`w-full rounded-2xl border p-4 text-left transition ${selectedPeriodId === period.id ? 'border-accent bg-accent-soft/30' : 'border-border bg-surface hover:border-foreground/20'}`}
                key={period.id}
                onClick={() => setSelectedPeriodId(period.id)}
              >
                <div className="flex justify-between">
                  <span className="font-semibold">
                    {formatDate(period.dateFrom)} — {formatDate(period.dateTo)}
                  </span>
                  <Badge>{periodLabels[period.status]}</Badge>
                </div>
                <div className="mt-3 flex justify-between text-sm text-muted-foreground">
                  <span>
                    {period.branchId
                      ? branches.data?.find((item) => item.id === period.branchId)?.name
                      : 'Все филиалы'}
                  </span>
                  <Money amount={period.totalAmount} />
                </div>
              </button>
            ))}
          </div>
          <h2 className="mb-3 mt-7 text-lg font-semibold">Действующие правила</h2>
          <div className="space-y-3">
            {rules.data?.map((rule) => (
              <Card className="p-4" key={rule.id}>
                <div className="flex justify-between">
                  <div>
                    <p className="font-semibold">{rule.coachName}</p>
                    <p className="text-sm text-muted-foreground">
                      {rule.groupName ?? rule.branchName}
                    </p>
                  </div>
                  <Badge>{payrollLabels[rule.type]}</Badge>
                </div>
              </Card>
            ))}
          </div>
        </section>
        <section>
          {!selected.data ? (
            <EmptyState
              description="Выберите период слева или создайте новый расчёт."
              icon={Calculator}
              title="Детализация расчёта"
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border p-5">
                <div>
                  <h2 className="text-xl font-semibold">
                    {formatDate(selected.data.dateFrom)} — {formatDate(selected.data.dateTo)}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Итого: <Money amount={selected.data.totalAmount} />
                  </p>
                  {selected.data.pendingAttendance.length ? (
                    <p className="mt-1 text-sm font-medium text-amber-600">
                      Посещаемость заполнена не для всех занятий
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {selected.data.status === 'DRAFT' || selected.data.status === 'CALCULATED' ? (
                    <Button onClick={() => void periodAction('calculate')} variant="outline">
                      <Calculator className="size-4" />
                      Рассчитать
                    </Button>
                  ) : null}
                  {selected.data.status === 'CALCULATED' && canApprove ? (
                    <Button
                      disabled={selected.data.unconfiguredPayoutCount > 0}
                      onClick={() => void periodAction('approve')}
                    >
                      <Check className="size-4" />
                      Утвердить
                    </Button>
                  ) : null}
                  {selected.data.status === 'APPROVED' && canApprove ? (
                    <Button onClick={() => void periodAction('pay')}>
                      <CreditCard className="size-4" />
                      Выплатить
                    </Button>
                  ) : null}
                  {isOwner ? (
                    <Button onClick={() => setDialog('diagnostic')} variant="outline">
                      Диагностика расчёта
                    </Button>
                  ) : null}
                  {isOwner ? (
                    <Button onClick={() => void deletePeriod()} variant="outline">
                      Удалить расчёт
                    </Button>
                  ) : null}
                </div>
              </div>
              {trainerSheets.length ? (
                <div className="flex flex-wrap gap-2 border-b border-border p-4">
                  {trainerSheets.map((trainer) => (
                    <Button
                      key={trainer.coachId}
                      onClick={() => setSheetCoachId(trainer.coachId)}
                      size="small"
                      variant="outline"
                    >
                      Расчётный лист · {trainer.coachName} · <Money amount={trainer.total} />
                    </Button>
                  ))}
                </div>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Тренер</TableHead>
                    <TableHead>Группа</TableHead>
                    <TableHead>Основание</TableHead>
                    <TableHead>Участники</TableHead>
                    <TableHead className="text-right">Итого</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.data.accruals.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.lessonStartsAt ? formatDate(item.lessonStartsAt) : '—'}
                      </TableCell>
                      <TableCell>{item.coachName}</TableCell>
                      <TableCell>{item.groupName ?? 'Все группы'}</TableCell>
                      <TableCell>
                        {item.payoutCategory ? (
                          <div>
                            <p>{payoutCategoryLabels[item.payoutCategory]}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.payoutMode ? payoutModeLabels[item.payoutMode] : 'Не настроено'}
                              {item.payoutMode === 'PERCENTAGE'
                                ? ` · ${String(item.payoutPercentage ?? 0).replace('.', ',')}%`
                                : ''}
                            </p>
                          </div>
                        ) : (
                          payrollLabels[item.type]
                        )}
                      </TableCell>
                      <TableCell>{attendanceCalculation(item)}</TableCell>
                      <TableCell className="text-right">
                        <Money amount={item.finalAmount} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {selected.data.pendingAttendance.length ? (
                <div className="border-t border-border bg-amber-50/70 p-5 dark:bg-amber-950/10">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                    <Clock3 className="size-4" />
                    Ожидает посещаемость
                  </div>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Посещаемость не заполнена — зарплата за занятие не рассчитана.
                  </p>
                  <div className="space-y-2">
                    {selected.data.pendingAttendance.map((lesson) => (
                      <Link
                        className="flex items-center justify-between rounded-xl border border-amber-200 bg-surface px-3 py-2 text-sm transition hover:border-amber-400 dark:border-amber-900"
                        key={lesson.occurrenceKey}
                        to={
                          lesson.lessonId
                            ? `/attendance/${lesson.lessonId}`
                            : `/attendance?date=${inputDate(new Date(lesson.startsAt))}&groupId=${lesson.groupId}`
                        }
                      >
                        <span>
                          {formatDate(lesson.startsAt)} · {lesson.groupName}
                        </span>
                        <span className="text-muted-foreground">{lesson.coachName}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
              {selected.data.unconfiguredPayoutCount ? (
                <div className="border-t border-border bg-amber-50/70 p-5 text-sm text-amber-800 dark:bg-amber-950/10 dark:text-amber-300">
                  Для {selected.data.unconfiguredPayoutCount} начислений правило не настроено.
                  Настройте профиль выплат тренера перед утверждением периода.
                </div>
              ) : null}
            </Card>
          )}
        </section>
      </div>
      <Dialog
        closeLabel="Закрыть"
        description={
          dialog === 'rule'
            ? 'Правила не должны пересекаться для одного тренера и группы.'
            : dialog === 'diagnostic'
              ? 'Диагностика не изменяет бизнес-данные и может быть сохранена в файл.'
              : 'Расчёт использует только завершённые занятия.'
        }
        onClose={() => setDialog(undefined)}
        open={Boolean(dialog)}
        title={
          dialog === 'rule'
            ? 'Новое правило зарплаты'
            : dialog === 'diagnostic'
              ? 'Диагностика расчёта'
              : 'Новый расчётный период'
        }
      >
        {dialog === 'rule' ? (
          <div className="grid grid-cols-2 gap-4">
            <Label>
              Филиал
              <Select onChange={(event) => setBranchId(event.target.value)} value={branchId}>
                <option value="">Выберите филиал</option>
                {branches.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Тренер
              <Select onChange={(event) => setCoachId(event.target.value)} value={coachId}>
                <option value="">Выберите тренера</option>
                {staff.data
                  ?.filter((item) => item.role === 'COACH')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fullName}
                    </option>
                  ))}
              </Select>
            </Label>
            <Label>
              Группа
              <Select onChange={(event) => setGroupId(event.target.value)} value={groupId}>
                <option value="">Все группы филиала</option>
                {groups.data
                  ?.filter((item) => !branchId || item.branchId === branchId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </Select>
            </Label>
            <Label>
              Модель
              <Select onChange={(event) => setType(event.target.value as PayrollType)} value={type}>
                {PAYROLL_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {payrollLabels[item]}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              {type === 'PERCENT_OF_REVENUE'
                ? 'Процент'
                : type === 'PER_ATTENDEE'
                  ? 'За ученика, ₽'
                  : type === 'FIXED_MONTHLY'
                    ? 'В месяц, ₽'
                    : 'За занятие, ₽'}
              <Input
                min={type === 'PERCENT_OF_REVENUE' ? 0.01 : 0}
                onChange={(event) => setRate(event.target.value)}
                required
                step="0.01"
                type="number"
                value={rate}
              />
            </Label>
            {type === 'COMBINED' ? (
              <Label>
                За ученика, ₽
                <Input
                  onChange={(event) => setSecondRate(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={secondRate}
                />
              </Label>
            ) : null}
            <Label>
              Действует с
              <Input
                onChange={(event) => setValidFrom(event.target.value)}
                type="date"
                value={validFrom}
              />
            </Label>
            <Label>
              Действует по
              <Input
                onChange={(event) => setValidTo(event.target.value)}
                type="date"
                value={validTo}
              />
            </Label>
          </div>
        ) : dialog === 'diagnostic' ? (
          <div className="grid gap-4">
            <Label>
              Формат отчёта
              <Select
                onChange={(event) =>
                  setDiagnosticFormat(event.target.value as PayrollDiagnosticFormat)
                }
                value={diagnosticFormat}
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
                <option value="txt">TXT</option>
              </Select>
            </Label>
            <p className="text-sm text-muted-foreground">
              В отчёте по каждой записи будут отображены статус, причина, тренер, правило и сумма
              начисления.
            </p>
            <div className="mt-1 flex justify-end gap-2">
              <Button onClick={() => setDialog(undefined)} variant="outline">
                Отмена
              </Button>
              <Button onClick={() => void exportDiagnostic()}>Сохранить диагностику</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Label>
              Филиал
              <Select onChange={(event) => setBranchId(event.target.value)} value={branchId}>
                <option value="">Все филиалы</option>
                {branches.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Label>
            <span />
            <Label>
              С даты
              <Input
                onChange={(event) => setDateFrom(event.target.value)}
                type="date"
                value={dateFrom}
              />
            </Label>
            <Label>
              По дату
              <Input
                onChange={(event) => setDateTo(event.target.value)}
                type="date"
                value={dateTo}
              />
            </Label>
          </div>
        )}
        {dialog !== 'diagnostic' ? (
          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={() => setDialog(undefined)} variant="outline">
              Отмена
            </Button>
            <Button
              disabled={
                dialog === 'rule' &&
                (!branchId || !coachId || !rate || (type === 'COMBINED' && !secondRate))
              }
              onClick={() => void (dialog === 'rule' ? createRule() : createPeriod())}
            >
              Сохранить
            </Button>
          </div>
        ) : null}
      </Dialog>
      <Dialog
        closeLabel="Закрыть"
        description="Детализация canonical начислений выбранного тренера. Утверждённые и выплаченные периоды остаются snapshot."
        onClose={() => setSheetCoachId(undefined)}
        open={Boolean(sheetCoachId && selected.data && sheetTrainer)}
        title="Расчётный лист тренера"
      >
        {selected.data && sheetTrainer ? (
          <section className="payroll-print-sheet space-y-4">
            <header>
              <p className="text-sm text-muted-foreground">ARAVA CRM · Расчётный лист</p>
              <h2 className="text-xl font-semibold">{sheetTrainer.coachName}</h2>
              <p>
                {formatDate(selected.data.dateFrom)} — {formatDate(selected.data.dateTo)} ·{' '}
                {periodLabels[selected.data.status]}
              </p>
            </header>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата и время</TableHead>
                    <TableHead>Группа</TableHead>
                    <TableHead>Категория</TableHead>
                    <TableHead>Фактический тренер</TableHead>
                    <TableHead>Посещения</TableHead>
                    <TableHead>Правило / база</TableHead>
                    <TableHead className="text-right">Начисление</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sheetAccruals.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.lessonStartsAt
                          ? formatDate(item.lessonStartsAt, {
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            })
                          : 'За период'}
                      </TableCell>
                      <TableCell>{item.groupName ?? 'Все группы'}</TableCell>
                      <TableCell>
                        {item.payoutCategory
                          ? payoutCategoryLabels[item.payoutCategory]
                          : payrollLabels[item.type]}
                      </TableCell>
                      <TableCell>{item.coachName}</TableCell>
                      <TableCell>{item.attendeeCount ?? '—'}</TableCell>
                      <TableCell>
                        {item.payoutMode
                          ? payoutModeLabels[item.payoutMode]
                          : item.payoutCategory
                            ? 'Не настроено'
                            : payrollLabels[item.type]}
                        {item.payoutMode === 'FIXED_PER_ATTENDANCE' ||
                        item.payoutMode === 'FIXED_PER_LESSON'
                          ? ` · ${String((item.payoutAmount ?? 0) / 100)} ₽`
                          : ''}
                        {item.payoutMode === 'PERCENTAGE'
                          ? ` · ${String(item.payoutPercentage ?? 0).replace('.', ',')}% от ${String((item.revenueBase ?? 0) / 100)} ₽`
                          : ''}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money amount={item.finalAmount} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <footer className="flex items-center justify-between border-t border-border pt-4 text-lg font-semibold">
              <span>Начислено за период</span>
              <Money amount={sheetTrainer.total} />
            </footer>
            <div className="payroll-print-controls flex justify-end">
              <Button onClick={() => window.print()}>
                <Printer className="size-4" />
                Печать / сохранить PDF
              </Button>
            </div>
          </section>
        ) : null}
      </Dialog>
    </main>
  );
}
