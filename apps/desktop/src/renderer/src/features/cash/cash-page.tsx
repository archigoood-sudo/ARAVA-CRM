import { formatDate, type CashRegisterType } from '@arava/shared';
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
import { ArrowLeftRight, Landmark, Plus, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

function isoNow() {
  return new Date().toISOString();
}
export function CashPage() {
  const client = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canCorrect = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const [dialog, setDialog] = useState<'register' | 'transfer' | 'correction'>();
  const [error, setError] = useState<string>();
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [type, setType] = useState<CashRegisterType>('CASH');
  const [opening, setOpening] = useState('0');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const registers = useQuery({
    queryFn: () => getDesktopApi().cash.listRegisters(getSessionToken()),
    queryKey: ['cash-registers'],
  });
  const transactions = useQuery({
    queryFn: () =>
      getDesktopApi().cash.listTransactions(getSessionToken(), {
        dateFrom: new Date(Date.now() - 90 * 86_400_000).toISOString(),
        dateTo: isoNow(),
      }),
    queryKey: ['cash-transactions'],
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: ['branches'],
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['cash-registers'] }),
      client.invalidateQueries({ queryKey: ['cash-transactions'] }),
      client.invalidateQueries({ queryKey: ['analytics'] }),
    ]);
  };
  const close = () => {
    setDialog(undefined);
    setError(undefined);
    setAmount('');
    setReason('');
  };
  const createRegister = async () => {
    try {
      await getDesktopApi().cash.createRegister(getSessionToken(), {
        branchId,
        isActive: true,
        name,
        openingBalance: Math.round(Number(opening) * 100),
        type,
      });
      await refresh();
      close();
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось создать кассу.'));
    }
  };
  const transfer = async () => {
    try {
      await getDesktopApi().cash.transfer(getSessionToken(), {
        amount: Math.round(Number(amount) * 100),
        fromCashRegisterId: fromId,
        occurredAt: isoNow(),
        reason,
        toCashRegisterId: toId,
      });
      await refresh();
      close();
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось выполнить перевод.'));
    }
  };
  const correct = async () => {
    try {
      await getDesktopApi().cash.correct(getSessionToken(), {
        amount: Math.round(Number(amount) * 100),
        cashRegisterId: fromId,
        occurredAt: isoNow(),
        reason,
      });
      await refresh();
      close();
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось выполнить корректировку.'));
    }
  };
  return (
    <main className="mx-auto w-full max-w-[1540px] animate-fade-in p-9 pb-14">
      <PageHeader
        action={
          <div className="flex gap-2">
            <Button onClick={() => setDialog('transfer')} variant="outline">
              <ArrowLeftRight className="size-4" />
              Перевод
            </Button>
            {canCorrect ? (
              <Button onClick={() => setDialog('correction')} variant="outline">
                <SlidersHorizontal className="size-4" />
                Корректировка
              </Button>
            ) : null}
            <Button onClick={() => setDialog('register')}>
              <Plus className="size-4" />
              Новая касса
            </Button>
          </div>
        }
        description="Остатки рассчитываются из неизменяемой истории поступлений и списаний."
        title="Кассы и счета"
      />
      {!registers.data?.length ? (
        <EmptyState
          description="Создайте кассу филиала. Для новых платежей касса также создаётся автоматически."
          icon={Landmark}
          title="Касс пока нет"
        />
      ) : (
        <section className="mb-6 grid grid-cols-3 gap-4">
          {registers.data.map((register) => (
            <Card className="p-5" key={register.id}>
              <div className="flex items-start justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft">
                  <Landmark className="size-5" />
                </span>
                <Badge>
                  {register.type === 'CASH'
                    ? 'Наличные'
                    : register.type === 'BANK'
                      ? 'Банк'
                      : 'Онлайн'}
                </Badge>
              </div>
              <p className="mt-6 text-3xl font-semibold">
                <Money amount={register.balance} />
              </p>
              <p className="mt-1 font-medium">{register.name}</p>
              <p className="text-sm text-muted-foreground">{register.branchName}</p>
            </Card>
          ))}
        </section>
      )}
      <Card className="overflow-hidden">
        <div className="border-b border-border p-5">
          <h2 className="text-lg font-semibold">История операций</h2>
          <p className="text-sm text-muted-foreground">Последние 90 дней</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Касса</TableHead>
              <TableHead>Операция</TableHead>
              <TableHead>Источник</TableHead>
              <TableHead>Комментарий</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.data?.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  {formatDate(item.occurredAt, { day: '2-digit', month: 'short', year: 'numeric' })}
                </TableCell>
                <TableCell>{item.cashRegisterName}</TableCell>
                <TableCell>
                  {item.type === 'INCOME'
                    ? 'Поступление'
                    : item.type === 'EXPENSE'
                      ? 'Списание'
                      : item.type === 'CORRECTION'
                        ? 'Корректировка'
                        : 'Перевод'}
                </TableCell>
                <TableCell>
                  {item.sourceType === 'PAYMENT'
                    ? 'Оплата'
                    : item.sourceType === 'REFUND'
                      ? 'Возврат'
                      : item.sourceType === 'EXPENSE'
                        ? 'Расход'
                        : item.sourceType === 'PAYROLL'
                          ? 'Зарплата'
                          : 'Вручную'}
                </TableCell>
                <TableCell>{item.comment ?? '—'}</TableCell>
                <TableCell
                  className={`text-right font-semibold ${item.type === 'INCOME' || (item.type === 'CORRECTION' && item.amount > 0) ? 'text-success' : ''}`}
                >
                  {item.type === 'EXPENSE' ? '−' : item.type === 'INCOME' ? '+' : ''}
                  <Money amount={Math.abs(item.amount)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog
        closeLabel="Закрыть"
        description={
          dialog === 'register'
            ? 'Касса привязана к одному филиалу.'
            : dialog === 'transfer'
              ? 'Обе проводки будут созданы атомарно.'
              : 'Укажите обязательную причину. Операция попадёт в аудит.'
        }
        onClose={close}
        open={Boolean(dialog)}
        title={
          dialog === 'register'
            ? 'Новая касса'
            : dialog === 'transfer'
              ? 'Перевод между кассами'
              : 'Корректировка остатка'
        }
      >
        {dialog === 'register' ? (
          <div className="space-y-4">
            <Label>
              Название
              <Input onChange={(event) => setName(event.target.value)} value={name} />
            </Label>
            <Label>
              Филиал
              <Select onChange={(event) => setBranchId(event.target.value)} value={branchId}>
                <option value="">Выберите филиал</option>
                {branches.data?.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Тип
              <Select
                onChange={(event) => setType(event.target.value as CashRegisterType)}
                value={type}
              >
                <option value="CASH">Наличные</option>
                <option value="BANK">Банк</option>
                <option value="ONLINE">Онлайн</option>
              </Select>
            </Label>
            <Label>
              Начальный остаток, ₽
              <Input
                onChange={(event) => setOpening(event.target.value)}
                type="number"
                value={opening}
              />
            </Label>
          </div>
        ) : (
          <div className="space-y-4">
            <Label>
              {dialog === 'transfer' ? 'Из кассы' : 'Касса'}
              <Select onChange={(event) => setFromId(event.target.value)} value={fromId}>
                <option value="">Выберите кассу</option>
                {registers.data?.map((register) => (
                  <option key={register.id} value={register.id}>
                    {register.name} · {register.branchName}
                  </option>
                ))}
              </Select>
            </Label>
            {dialog === 'transfer' ? (
              <Label>
                В кассу
                <Select onChange={(event) => setToId(event.target.value)} value={toId}>
                  <option value="">Выберите кассу</option>
                  {registers.data?.map((register) => (
                    <option key={register.id} value={register.id}>
                      {register.name} · {register.branchName}
                    </option>
                  ))}
                </Select>
              </Label>
            ) : null}
            <Label>
              Сумма, ₽
              <Input
                onChange={(event) => setAmount(event.target.value)}
                step="0.01"
                type="number"
                value={amount}
              />
            </Label>
            <Label>
              Причина
              <Input onChange={(event) => setReason(event.target.value)} value={reason} />
            </Label>
          </div>
        )}
        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={close} variant="outline">
            Отмена
          </Button>
          <Button
            onClick={() =>
              void (dialog === 'register'
                ? createRegister()
                : dialog === 'transfer'
                  ? transfer()
                  : correct())
            }
          >
            Сохранить
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
