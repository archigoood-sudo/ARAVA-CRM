import { PAYROLL_TYPES, formatDate, type PayrollRuleInput, type PayrollType } from '@arava/shared';
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
import { Calculator, Check, CreditCard, Plus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

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
function inputDate(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function PayrollPage() {
  const user = useAuthStore((state) => state.user);
  const coachOnly = user?.role === 'COACH';
  const canApprove = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const client = useQueryClient();
  const now = new Date();
  const [dialog, setDialog] = useState<'rule' | 'period'>();
  const [error, setError] = useState<string>();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>();
  const [branchId, setBranchId] = useState('');
  const [coachId, setCoachId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [type, setType] = useState<PayrollType>('FIXED_PER_LESSON');
  const [rate, setRate] = useState('');
  const [secondRate, setSecondRate] = useState('');
  const [validFrom, setValidFrom] = useState(inputDate(now));
  const [validTo, setValidTo] = useState('');
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
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['payroll'] }),
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
                  <TableHead>Филиал</TableHead>
                  <TableHead>Группа</TableHead>
                  <TableHead>Расчёт</TableHead>
                  <TableHead className="text-right">Начислено</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coachView.data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.branchName}</TableCell>
                    <TableCell>{item.groupName ?? 'Все группы'}</TableCell>
                    <TableCell>{payrollLabels[item.type]}</TableCell>
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
                </div>
                <div className="flex gap-2">
                  {selected.data.status === 'DRAFT' || selected.data.status === 'CALCULATED' ? (
                    <Button onClick={() => void periodAction('calculate')} variant="outline">
                      <Calculator className="size-4" />
                      Рассчитать
                    </Button>
                  ) : null}
                  {selected.data.status === 'CALCULATED' && canApprove ? (
                    <Button onClick={() => void periodAction('approve')}>
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
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
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
                      <TableCell>{item.coachName}</TableCell>
                      <TableCell>{item.groupName ?? 'Все группы'}</TableCell>
                      <TableCell>{payrollLabels[item.type]}</TableCell>
                      <TableCell>{item.attendeeCount ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <Money amount={item.finalAmount} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </section>
      </div>
      <Dialog
        closeLabel="Закрыть"
        description={
          dialog === 'rule'
            ? 'Правила не должны пересекаться для одного тренера и группы.'
            : 'Расчёт использует только завершённые занятия.'
        }
        onClose={() => setDialog(undefined)}
        open={Boolean(dialog)}
        title={dialog === 'rule' ? 'Новое правило зарплаты' : 'Новый расчётный период'}
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
              <Input onChange={(event) => setRate(event.target.value)} type="number" value={rate} />
            </Label>
            {type === 'COMBINED' ? (
              <Label>
                За ученика, ₽
                <Input
                  onChange={(event) => setSecondRate(event.target.value)}
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
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => setDialog(undefined)} variant="outline">
            Отмена
          </Button>
          <Button onClick={() => void (dialog === 'rule' ? createRule() : createPeriod())}>
            Сохранить
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
