import type { ExpenseInput, ExpenseListQuery } from '@arava/shared';
import { formatDate } from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Paperclip, Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken } from '../../stores/auth-store';
import { ExpenseDialog } from './expense-dialog';

const statusLabels = { CANCELLED: 'Отменён', CONFIRMED: 'Подтверждён', DRAFT: 'Черновик' } as const;
function dateInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function ExpensesPage() {
  const client = useQueryClient();
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const [dateFrom, setDateFrom] = useState(dateInput(month));
  const [dateTo, setDateTo] = useState(dateInput(now));
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const query = useMemo<ExpenseListQuery>(
    () => ({
      branchId: branchId || undefined,
      dateFrom: new Date(`${dateFrom}T00:00:00`).toISOString(),
      dateTo: new Date(`${dateTo}T23:59:59`).toISOString(),
      search,
      status: (status || undefined) as ExpenseListQuery['status'],
    }),
    [branchId, dateFrom, dateTo, search, status],
  );
  const expenses = useQuery({
    queryFn: () => getDesktopApi().expenses.list(getSessionToken(), query),
    queryKey: ['expenses', query],
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: ['branches'],
  });
  const categories = useQuery({
    queryFn: () => getDesktopApi().expenseCategories.list(getSessionToken()),
    queryKey: ['expense-categories'],
  });
  const registers = useQuery({
    queryFn: () => getDesktopApi().cash.listRegisters(getSessionToken()),
    queryKey: ['cash-registers'],
  });
  const create = useMutation({
    mutationFn: (input: ExpenseInput) => getDesktopApi().expenses.create(getSessionToken(), input),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['expenses'] });
  const confirm = async (id: string, itemBranchId: string) => {
    const register = registers.data?.find(
      (item) => item.branchId === itemBranchId && item.isActive,
    );
    if (!register) {
      setError('Сначала создайте активную кассу для филиала.');
      return;
    }
    try {
      await getDesktopApi().expenses.confirm(getSessionToken(), id, register.id);
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: ['cash'] })]);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось подтвердить расход.'));
    }
  };
  return (
    <main className="mx-auto w-full max-w-[1540px] animate-fade-in p-9 pb-14">
      <PageHeader
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Добавить расход
          </Button>
        }
        description="Черновики, подтверждение, документы и движение денег по филиалам."
        title="Расходы"
      />
      {error ? (
        <div className="mb-4">
          <ErrorState message={error} retryLabel="Повторить" title="Операция не выполнена" />
        </div>
      ) : null}
      <Card className="mb-5 grid grid-cols-[1fr_repeat(4,180px)] gap-3 p-4">
        <label className="relative">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-10"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поставщик, описание или номер документа"
            value={search}
          />
        </label>
        <Select onChange={(event) => setBranchId(event.target.value)} value={branchId}>
          <option value="">Все филиалы</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
        <Select onChange={(event) => setStatus(event.target.value)} value={status}>
          <option value="">Все статусы</option>
          <option value="DRAFT">Черновики</option>
          <option value="CONFIRMED">Подтверждённые</option>
          <option value="CANCELLED">Отменённые</option>
        </Select>
        <Input
          aria-label="Дата начала"
          onChange={(event) => setDateFrom(event.target.value)}
          type="date"
          value={dateFrom}
        />
        <Input
          aria-label="Дата окончания"
          onChange={(event) => setDateTo(event.target.value)}
          type="date"
          value={dateTo}
        />
      </Card>
      {expenses.isLoading ? (
        <LoadingState label="Загружаем расходы…" />
      ) : expenses.isError ? (
        <ErrorState
          message="Проверьте подключение к локальной базе."
          retryLabel="Повторить"
          title="Не удалось загрузить расходы"
        />
      ) : !expenses.data?.length ? (
        <EmptyState
          description="Добавьте первый расход. До подтверждения он не повлияет на отчёты."
          icon={FileText}
          title="Расходов пока нет"
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Описание</TableHead>
                <TableHead>Филиал</TableHead>
                <TableHead>Категория</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {formatDate(item.spentAt, { day: '2-digit', month: 'short', year: 'numeric' })}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{item.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.vendor ?? item.documentNumber ?? 'Без дополнительных реквизитов'}
                    </p>
                  </TableCell>
                  <TableCell>{item.branchName}</TableCell>
                  <TableCell>{item.categoryName}</TableCell>
                  <TableCell>
                    <Money amount={item.amount} />
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        item.status === 'CONFIRMED'
                          ? 'bg-success/10 text-success'
                          : item.status === 'CANCELLED'
                            ? 'bg-destructive/10 text-destructive'
                            : ''
                      }
                    >
                      {statusLabels[item.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {item.status === 'DRAFT' ? (
                        <Button
                          aria-label="Подтвердить расход"
                          onClick={() => void confirm(item.id, item.branchId)}
                          size="small"
                          variant="secondary"
                        >
                          <Check className="size-4" />
                          Подтвердить
                        </Button>
                      ) : null}
                      {item.attachment ? (
                        <Button
                          aria-label={`Открыть документ расхода: ${item.attachment.fileName}`}
                          onClick={() =>
                            void getDesktopApi().expenses.openAttachment(getSessionToken(), item.id)
                          }
                          size="small"
                          title={item.attachment.fileName}
                          variant="ghost"
                        >
                          <Paperclip className="size-4" />
                        </Button>
                      ) : null}
                      {item.status !== 'CANCELLED' ? (
                        <Button
                          aria-label="Отменить расход"
                          onClick={() =>
                            void getDesktopApi()
                              .expenses.cancel(getSessionToken(), item.id)
                              .then(refresh)
                          }
                          size="small"
                          variant="ghost"
                        >
                          <X className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <ExpenseDialog
        branches={branches.data ?? []}
        categories={categories.data ?? []}
        error={error}
        onClose={() => setOpen(false)}
        onSave={async (input) => {
          try {
            await create.mutateAsync(input);
            await refresh();
            setOpen(false);
          } catch (caught) {
            setError(getErrorMessage(caught, 'Не удалось сохранить расход.'));
            throw caught;
          }
        }}
        open={open}
      />
    </main>
  );
}
