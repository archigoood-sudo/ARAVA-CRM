import type {
  CardAssignInput,
  CardListQuery,
  CardRegisterInput,
  MembershipCardStatus,
  MembershipCardSummary,
} from '@arava/shared';
import { formatDate } from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
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
import {
  Archive,
  Ban,
  CreditCard,
  History,
  Link2,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  Unlink,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import {
  SCANNER_MIN_LENGTH_KEY,
  SCANNER_SETTINGS_EVENT,
} from '../../components/global-card-scanner';

const statusLabels: Record<MembershipCardStatus, string> = {
  ARCHIVED: 'В архиве',
  ASSIGNED: 'Привязана',
  BLOCKED: 'Заблокирована',
  FREE: 'Свободна',
  LOST: 'Утеряна',
};

const historyLabels = {
  ARCHIVED: 'Карта архивирована',
  ASSIGNED: 'Карта привязана',
  BLOCKED: 'Карта заблокирована',
  MARKED_LOST: 'Карта отмечена как утерянная',
  REACTIVATED: 'Карта разблокирована',
  REGISTERED: 'Карта зарегистрирована',
  REPLACED: 'Карта заменена',
  SCANNED: 'Карта отсканирована',
  UNASSIGNED: 'Карта отвязана',
} as const;

const defaultQuery: CardListQuery = {
  page: 1,
  pageSize: 20,
  sortBy: 'createdAt',
  sortDirection: 'desc',
};

export function CardsPage() {
  const user = useAuthStore((state) => state.user);
  if (user?.role === 'COACH') return <Navigate replace to="/dashboard" />;
  return <CardsWorkspace />;
}

function CardsWorkspace() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [searchParameters] = useSearchParams();
  const [query, setQuery] = useState<CardListQuery>({
    ...defaultQuery,
    search: searchParameters.get('barcode') ?? undefined,
  });
  const [registerOpen, setRegisterOpen] = useState(false);
  const [assigning, setAssigning] = useState<MembershipCardSummary>();
  const [historyCard, setHistoryCard] = useState<MembershipCardSummary>();
  const [error, setError] = useState<string>();
  const [scannerMinimum, setScannerMinimum] = useState(() =>
    Number(localStorage.getItem(SCANNER_MIN_LENGTH_KEY) ?? 6),
  );
  const canArchive = user?.role === 'OWNER';
  const cards = useQuery({
    queryFn: () => getDesktopApi().cards.list(getSessionToken(), query),
    queryKey: ['cards', query],
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: ['branches'],
  });
  const students = useQuery({
    queryFn: () => getDesktopApi().students.options(getSessionToken(), query.branchId),
    queryKey: ['students', 'options', query.branchId],
  });
  const history = useQuery({
    enabled: Boolean(historyCard),
    queryFn: () => getDesktopApi().cards.history(getSessionToken(), historyCard?.id ?? ''),
    queryKey: ['cards', 'history', historyCard?.id],
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['cards'] });
  const register = useMutation({
    mutationFn: (input: CardRegisterInput) =>
      getDesktopApi().cards.register(getSessionToken(), input),
    onSuccess: async () => {
      await refresh();
      setRegisterOpen(false);
    },
  });
  const assign = useMutation({
    mutationFn: (input: CardAssignInput) => getDesktopApi().cards.assign(getSessionToken(), input),
    onSuccess: async () => {
      await refresh();
      setAssigning(undefined);
    },
  });
  const action = useMutation({
    mutationFn: async ({
      id,
      kind,
    }: {
      id: string;
      kind: 'archive' | 'block' | 'lost' | 'reactivate' | 'unassign';
    }) => {
      const input = {};
      if (kind === 'archive') return getDesktopApi().cards.archive(getSessionToken(), id, input);
      if (kind === 'block') return getDesktopApi().cards.block(getSessionToken(), id, input);
      if (kind === 'lost') return getDesktopApi().cards.markLost(getSessionToken(), id, input);
      if (kind === 'reactivate')
        return getDesktopApi().cards.reactivate(getSessionToken(), id, input);
      return getDesktopApi().cards.unassign(getSessionToken(), id, input);
    },
    onSuccess: refresh,
  });

  const perform = async (
    card: MembershipCardSummary,
    kind: 'archive' | 'block' | 'lost' | 'reactivate' | 'unassign',
    confirmation: string,
  ) => {
    if (!window.confirm(confirmation)) return;
    setError(undefined);
    try {
      await action.mutateAsync({ id: card.id, kind });
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось изменить состояние карты.'));
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1440px] p-9 pb-14">
      <PageHeader
        action={
          <Button onClick={() => setRegisterOpen(true)}>
            <Plus className="size-4" /> Зарегистрировать карту
          </Button>
        }
        description="Учёт заранее напечатанных пластиковых карт, их привязка и полная история."
        eyebrow="Доступ клиентов"
        title="Карты"
      />

      <Card className="mb-5 flex items-center justify-between gap-5 p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft">
            <ScanLine className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Глобальный сканер включён</p>
            <p className="text-xs text-muted-foreground">
              Быстрое считывание с Enter работает из любого раздела и не перехватывает ввод в
              формах.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm text-muted-foreground">
          Минимум символов
          <Input
            aria-label="Минимальная длина штрихкода"
            className="w-20"
            max={64}
            min={4}
            onChange={(event) => {
              const value = Math.min(64, Math.max(4, Number(event.target.value) || 4));
              setScannerMinimum(value);
              localStorage.setItem(SCANNER_MIN_LENGTH_KEY, String(value));
              window.dispatchEvent(new Event(SCANNER_SETTINGS_EVENT));
            }}
            type="number"
            value={scannerMinimum}
          />
        </label>
      </Card>

      <Card className="mb-5 grid grid-cols-[minmax(260px,1fr)_220px_220px_180px] gap-3 p-4">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Поиск карты или клиента"
            className="pl-9"
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                page: 1,
                search: event.target.value || undefined,
              }))
            }
            placeholder="Штрихкод, имя или телефон"
            value={query.search ?? ''}
          />
        </label>
        <Select
          aria-label="Фильтр по филиалу"
          onChange={(event) =>
            setQuery((current) => ({
              ...current,
              branchId: event.target.value || undefined,
              page: 1,
            }))
          }
          value={query.branchId ?? ''}
        >
          <option value="">Все филиалы</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Фильтр по статусу карты"
          onChange={(event) =>
            setQuery((current) => ({
              ...current,
              page: 1,
              status: (event.target.value || undefined) as MembershipCardStatus | undefined,
            }))
          }
          value={query.status ?? ''}
        >
          <option value="">Все статусы</option>
          {Object.entries(statusLabels).map(([status, label]) => (
            <option key={status} value={status}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Сортировка карт"
          onChange={(event) =>
            setQuery((current) => ({
              ...current,
              sortBy: event.target.value as CardListQuery['sortBy'],
            }))
          }
          value={query.sortBy}
        >
          <option value="createdAt">Сначала новые</option>
          <option value="barcode">По штрихкоду</option>
          <option value="lastScan">По последнему сканированию</option>
        </Select>
      </Card>

      {error ? (
        <p className="mb-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>
      ) : null}
      <Card className="overflow-hidden">
        {cards.isLoading ? <LoadingState label="Загружаем карты…" /> : null}
        {cards.isError ? (
          <ErrorState
            message="Не удалось загрузить карты."
            onRetry={() => void cards.refetch()}
            retryLabel="Повторить"
            title="Ошибка загрузки"
          />
        ) : null}
        {cards.data?.items.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={() => setRegisterOpen(true)}>Зарегистрировать первую карту</Button>
            }
            description="Отсканируйте или введите штрихкод готовой пластиковой карты."
            icon={CreditCard}
            title="Карты пока не зарегистрированы"
          />
        ) : null}
        {cards.data?.items.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Штрихкод</TableHead>
                <TableHead>Клиент</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Выдана / сканирование</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cards.data.items.map((card) => (
                <TableRow key={card.id}>
                  <TableCell>
                    <p className="font-mono text-sm font-semibold tracking-wide">{card.barcode}</p>
                    <p className="mt-1 max-w-52 truncate text-xs text-muted-foreground">
                      {card.notes ?? 'Без заметки'}
                    </p>
                  </TableCell>
                  <TableCell>
                    {card.studentId ? (
                      <Link
                        className="font-semibold hover:underline"
                        to={`/students/${card.studentId}`}
                      >
                        {card.studentName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Не привязана</span>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">{card.branchName ?? '—'}</p>
                  </TableCell>
                  <TableCell>
                    <Badge>{statusLabels[card.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <p>{card.issuedAt ? formatDate(card.issuedAt) : '—'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {card.lastScanAt
                        ? `Скан: ${formatDate(card.lastScanAt, { dateStyle: 'short', timeStyle: 'short' })}`
                        : 'Ещё не сканировалась'}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        aria-label="История карты"
                        onClick={() => setHistoryCard(card)}
                        size="icon"
                        variant="ghost"
                      >
                        <History className="size-4" />
                      </Button>
                      {card.status === 'FREE' ? (
                        <Button
                          aria-label="Привязать карту"
                          onClick={() => setAssigning(card)}
                          size="icon"
                          variant="ghost"
                        >
                          <Link2 className="size-4" />
                        </Button>
                      ) : null}
                      {card.status === 'ASSIGNED' ? (
                        <>
                          <Button
                            aria-label="Отвязать карту"
                            onClick={() =>
                              void perform(card, 'unassign', 'Отвязать карту от клиента?')
                            }
                            size="icon"
                            variant="ghost"
                          >
                            <Unlink className="size-4" />
                          </Button>
                          <Button
                            aria-label="Карта утеряна"
                            onClick={() =>
                              void perform(card, 'lost', 'Отметить карту как утерянную?')
                            }
                            size="icon"
                            variant="ghost"
                          >
                            <ScanLine className="size-4" />
                          </Button>
                          <Button
                            aria-label="Заблокировать карту"
                            onClick={() => void perform(card, 'block', 'Заблокировать карту?')}
                            size="icon"
                            variant="ghost"
                          >
                            <Ban className="size-4" />
                          </Button>
                        </>
                      ) : null}
                      {card.status === 'BLOCKED' || card.status === 'LOST' ? (
                        <Button
                          aria-label="Разблокировать карту"
                          onClick={() => void perform(card, 'reactivate', 'Разблокировать карту?')}
                          size="icon"
                          variant="ghost"
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                      ) : null}
                      {canArchive && card.status !== 'ARCHIVED' ? (
                        <Button
                          aria-label="Архивировать карту"
                          onClick={() =>
                            void perform(
                              card,
                              'archive',
                              'Архивировать карту? Это действие сохранит всю историю.',
                            )
                          }
                          size="icon"
                          variant="ghost"
                        >
                          <Archive className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Card>
      {cards.data && cards.data.totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Всего карт: {cards.data.total}</p>
          <div className="flex gap-2">
            <Button
              disabled={query.page <= 1}
              onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}
              variant="outline"
            >
              Назад
            </Button>
            <span className="px-3 py-2 text-sm">
              {query.page} из {cards.data.totalPages}
            </span>
            <Button
              disabled={query.page >= cards.data.totalPages}
              onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}
              variant="outline"
            >
              Далее
            </Button>
          </div>
        </div>
      ) : null}

      <RegisterCardDialog
        error={error}
        loading={register.isPending}
        onClose={() => setRegisterOpen(false)}
        onSubmit={async (input) => {
          setError(undefined);
          try {
            await register.mutateAsync(input);
          } catch (caught) {
            setError(getErrorMessage(caught, 'Не удалось зарегистрировать карту.'));
          }
        }}
        open={registerOpen}
      />
      <AssignCardDialog
        card={assigning}
        error={error}
        loading={assign.isPending}
        onClose={() => setAssigning(undefined)}
        onSubmit={async (input) => {
          setError(undefined);
          try {
            await assign.mutateAsync(input);
          } catch (caught) {
            setError(getErrorMessage(caught, 'Не удалось привязать карту.'));
          }
        }}
        students={students.data ?? []}
      />
      <Dialog
        closeLabel="Закрыть"
        onClose={() => setHistoryCard(undefined)}
        open={Boolean(historyCard)}
        title={`История карты ${historyCard?.barcode ?? ''}`}
        wide
      >
        {history.isLoading ? <LoadingState label="Загружаем историю…" /> : null}
        <div className="space-y-3">
          {history.data?.map((event) => (
            <article className="rounded-2xl border border-border p-4" key={event.id}>
              <div className="flex justify-between gap-4">
                <p className="font-semibold">{historyLabels[event.eventType]}</p>
                <time className="text-xs text-muted-foreground">
                  {formatDate(event.occurredAt, { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {event.studentName ?? event.performedByName ?? 'Системное событие'}
                {event.relatedCardBarcode ? ` · связанная карта ${event.relatedCardBarcode}` : ''}
              </p>
              {event.comment ? <p className="mt-2 text-sm">{event.comment}</p> : null}
            </article>
          ))}
        </div>
      </Dialog>
    </main>
  );
}

function RegisterCardDialog({
  error,
  loading,
  onClose,
  onSubmit,
  open,
}: {
  error?: string | undefined;
  loading: boolean;
  onClose: () => void;
  onSubmit: (input: CardRegisterInput) => Promise<void>;
  open: boolean;
}) {
  const [barcode, setBarcode] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <Dialog
      closeLabel="Закрыть"
      description="Отсканируйте готовую карту или введите код вручную. Ведущие нули сохраняются."
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="outline">
            Отмена
          </Button>
          <Button
            disabled={loading || barcode.trim().length < 4}
            onClick={() => void onSubmit({ barcode: barcode.trim(), notes: notes || undefined })}
          >
            Зарегистрировать карту
          </Button>
        </div>
      }
      onClose={onClose}
      open={open}
      title="Регистрация пластиковой карты"
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="card-barcode">Штрихкод</Label>
          <Input
            autoFocus
            id="card-barcode"
            onChange={(event) => setBarcode(event.target.value)}
            placeholder="0000001001"
            value={barcode}
          />
        </div>
        <div>
          <Label htmlFor="card-notes">Заметка</Label>
          <Input
            id="card-notes"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Необязательно"
            value={notes}
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </Dialog>
  );
}

function AssignCardDialog({
  card,
  error,
  loading,
  onClose,
  onSubmit,
  students,
}: {
  card?: MembershipCardSummary | undefined;
  error?: string | undefined;
  loading: boolean;
  onClose: () => void;
  onSubmit: (input: CardAssignInput) => Promise<void>;
  students: { firstName: string; id: string; lastName: string }[];
}) {
  const [studentId, setStudentId] = useState('');
  const sortedStudents = useMemo(
    () =>
      [...students].sort((left, right) =>
        `${left.lastName} ${left.firstName}`.localeCompare(`${right.lastName} ${right.firstName}`),
      ),
    [students],
  );
  return (
    <Dialog
      closeLabel="Закрыть"
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="outline">
            Отмена
          </Button>
          <Button
            disabled={loading || !studentId}
            onClick={() =>
              card && void onSubmit({ barcode: card.barcode, registerIfUnknown: false, studentId })
            }
          >
            Привязать
          </Button>
        </div>
      }
      onClose={onClose}
      open={Boolean(card)}
      title={`Привязать карту ${card?.barcode ?? ''}`}
    >
      <div>
        <Label htmlFor="card-student">Клиент</Label>
        <Select
          id="card-student"
          onChange={(event) => setStudentId(event.target.value)}
          value={studentId}
        >
          <option value="">Выберите клиента</option>
          {sortedStudents.map((student) => (
            <option key={student.id} value={student.id}>
              {student.lastName} {student.firstName}
            </option>
          ))}
        </Select>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </div>
    </Dialog>
  );
}
