import type {
  BranchSummary,
  RoomClosureInput,
  RoomInput,
  RoomRentalInput,
  RoomSummary,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Select,
  Textarea,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Building2,
  CalendarClock,
  Clock3,
  DoorOpen,
  Pencil,
  Plus,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const localInput = (date = new Date()): string => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
};

export function RoomsPage() {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role !== 'COACH';
  const client = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [roomDialog, setRoomDialog] = useState<RoomSummary | 'new' | null>(null);
  const [eventDialog, setEventDialog] = useState<{
    room: RoomSummary;
    type: 'rental' | 'closure';
  } | null>(null);
  const [detailRoom, setDetailRoom] = useState<RoomSummary | null>(null);
  const [error, setError] = useState<string>();
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: ['branches', 'rooms'],
  });
  const rooms = useQuery({
    queryFn: () => getDesktopApi().rooms.list(getSessionToken(), branchId || undefined, canManage),
    queryKey: ['rooms', branchId, canManage],
  });
  useEffect(() => {
    if (!branchId && branches.data?.[0]) setBranchId(branches.data[0].id);
  }, [branchId, branches.data]);
  const selectedBranch = branches.data?.find((branch) => branch.id === branchId);
  const archive = useMutation({
    mutationFn: (id: string) => getDesktopApi().rooms.archive(getSessionToken(), id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['rooms'] }),
  });
  const roomGroups = useMemo(
    () =>
      (branches.data ?? [])
        .map((branch) => ({
          branch,
          rooms: (rooms.data ?? []).filter((room) => room.branchId === branch.id),
        }))
        .filter(({ branch }) => !branchId || branch.id === branchId),
    [branchId, branches.data, rooms.data],
  );
  return (
    <main className="mx-auto w-full max-w-[1500px] animate-fade-in p-9 pb-14">
      <PageHeader
        action={
          canManage && selectedBranch ? (
            <Button
              onClick={() => {
                setError(undefined);
                setRoomDialog('new');
              }}
            >
              <Plus className="size-4" />
              Добавить зал
            </Button>
          ) : undefined
        }
        description="Физические пространства филиалов, их доступность и ближайшие события."
        eyebrow="Пространства студии"
        title="Филиалы и залы"
      />
      <Card className="mb-5 flex items-center gap-3 p-4">
        <Building2 className="size-4 text-muted-foreground" />
        <Select
          className="max-w-sm"
          onChange={(event) => setBranchId(event.target.value)}
          value={branchId}
        >
          <option value="">Все доступные филиалы</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
      </Card>
      {rooms.isLoading ? <LoadingState label="Загружаем залы…" /> : null}
      {rooms.isError ? (
        <ErrorState
          message="Не удалось загрузить залы."
          onRetry={() => void rooms.refetch()}
          retryLabel="Повторить"
          title="Ошибка загрузки"
        />
      ) : null}
      {rooms.data?.length === 0 ? (
        <EmptyState
          description="Добавьте первый зал, чтобы планировать занятия и аренды без пересечений."
          icon={DoorOpen}
          title="Залы ещё не созданы"
        />
      ) : null}
      <div className="space-y-7">
        {roomGroups.map(({ branch, rooms: branchRooms }) => (
          <section key={branch.id}>
            <div className="mb-3 flex items-end justify-between">
              <div>
                <h2 className="text-2xl font-semibold">{branch.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {branch.address ?? 'Адрес не указан'}
                </p>
              </div>
              <Badge>{branchRooms.length} залов</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {branchRooms.map((room) => (
                <Card className="overflow-hidden" key={room.id}>
                  <div className="h-1.5" style={{ background: room.colorKey ?? '#9CFF2E' }} />
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft">
                        <DoorOpen className="size-5" />
                      </span>
                      <Badge
                        className={!room.isActive ? 'bg-muted text-muted-foreground' : undefined}
                      >
                        {room.isActive ? 'Открыт' : 'Закрыт'}
                      </Badge>
                    </div>
                    <h3 className="mt-5 text-xl font-semibold">{room.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {room.capacity
                        ? `До ${String(room.capacity)} человек`
                        : 'Вместимость не указана'}
                      {room.floor ? ` · ${room.floor}` : ''}
                    </p>
                    {room.description ? (
                      <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
                        {room.description}
                      </p>
                    ) : null}
                    {canManage ? (
                      <div className="mt-5 flex flex-wrap gap-2">
                        {room.isActive ? (
                          <Button
                            onClick={() => setEventDialog({ room, type: 'rental' })}
                            size="small"
                            variant="outline"
                          >
                            <CalendarClock className="size-4" />
                            Аренда
                          </Button>
                        ) : null}
                        <Button onClick={() => setDetailRoom(room)} size="small" variant="outline">
                          <Clock3 className="size-4" />
                          Расписание
                        </Button>
                        {room.isActive ? (
                          <Button
                            onClick={() => setEventDialog({ room, type: 'closure' })}
                            size="small"
                            variant="outline"
                          >
                            <Wrench className="size-4" />
                            Закрыть
                          </Button>
                        ) : null}
                        <Button
                          aria-label={`Редактировать ${room.name}`}
                          onClick={() => setRoomDialog(room)}
                          size="icon"
                          variant="ghost"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        {room.archivedAt ? null : (
                          <Button
                            aria-label={`Архивировать ${room.name}`}
                            onClick={() => void archive.mutateAsync(room.id)}
                            size="icon"
                            variant="ghost"
                          >
                            <Archive className="size-4" />
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
      <RoomDialog
        branch={selectedBranch}
        error={error}
        onClose={() => setRoomDialog(null)}
        onError={setError}
        onSaved={async () => {
          await client.invalidateQueries({ queryKey: ['rooms'] });
          setRoomDialog(null);
        }}
        open={roomDialog !== null}
        room={roomDialog === 'new' ? null : roomDialog}
      />
      <RoomEventDialog
        event={eventDialog}
        onClose={() => setEventDialog(null)}
        onError={setError}
        onSaved={async () => {
          await client.invalidateQueries({ queryKey: ['rentals'] });
          await client.invalidateQueries({ queryKey: ['closures'] });
          setEventDialog(null);
        }}
      />
      <RoomDetailDialog onClose={() => setDetailRoom(null)} room={detailRoom} />
      {error && !roomDialog && !eventDialog ? (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      ) : null}
    </main>
  );
}

function RoomDetailDialog({ onClose, room }: { onClose: () => void; room: RoomSummary | null }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const range = useMemo(() => {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(`${date}T23:59:59.999`);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [date]);
  const availability = useQuery({
    enabled: Boolean(room),
    queryFn: () => getDesktopApi().rooms.availability(getSessionToken(), room?.id ?? '', date),
    queryKey: ['room-availability', room?.id, date],
  });
  const utilization = useQuery({
    enabled: Boolean(room),
    queryFn: () =>
      getDesktopApi().rooms.utilization(getSessionToken(), room?.id ?? '', range.start, range.end),
    queryKey: ['room-utilization', room?.id, date],
  });
  return (
    <Dialog
      closeLabel="Закрыть"
      onClose={onClose}
      open={Boolean(room)}
      title={room ? `Расписание: ${room.name}` : 'Расписание зала'}
      wide
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <Input
            className="max-w-48"
            onChange={(event) => setDate(event.target.value)}
            type="date"
            value={date}
          />
          <div className="flex gap-3 text-sm">
            <Badge>Занятий: {utilization.data?.lessons ?? 0}</Badge>
            <Badge>Аренд: {utilization.data?.rentals ?? 0}</Badge>
            <Badge>Занято: {(utilization.data?.totalOccupiedHours ?? 0).toFixed(1)} ч</Badge>
          </div>
        </div>
        <div className="space-y-2">
          {availability.isLoading ? <LoadingState label="Считаем свободные окна…" /> : null}
          {availability.data?.map((item, index) => (
            <div
              className={`flex items-center justify-between rounded-xl border p-3 ${item.kind === 'FREE' ? 'border-emerald-100 bg-emerald-50' : item.kind === 'CLOSURE' ? 'border-amber-200 bg-amber-50' : 'border-border bg-muted/40'}`}
              key={`${item.startAt}-${String(index)}`}
            >
              <span className="font-medium">{item.title}</span>
              <span className="text-sm text-muted-foreground">
                {new Date(item.startAt).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                –
                {new Date(item.endAt).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          ))}
          {availability.data?.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">На выбранную дату событий нет.</p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Свободные окна показаны внутри диапазона календаря 08:00–23:00. Процент загрузки не
          рассчитывается, пока рабочие часы студии не настроены.
        </p>
      </div>
    </Dialog>
  );
}

function RoomDialog({
  branch,
  error,
  onClose,
  onError,
  onSaved,
  open,
  room,
}: {
  branch?: BranchSummary | undefined;
  error?: string | undefined;
  onClose: () => void;
  onError: (value?: string) => void;
  onSaved: () => Promise<void>;
  open: boolean;
  room: RoomSummary | null;
}) {
  const [form, setForm] = useState<RoomInput>({
    branchId: branch?.id ?? '',
    isActive: true,
    name: '',
    sortOrder: 0,
  });
  useEffect(() => {
    if (open)
      setForm(room ?? { branchId: branch?.id ?? '', isActive: true, name: '', sortOrder: 0 });
  }, [branch?.id, open, room]);
  const submit = async () => {
    try {
      onError(undefined);
      if (room) await getDesktopApi().rooms.update(getSessionToken(), room.id, form);
      else await getDesktopApi().rooms.create(getSessionToken(), form);
      await onSaved();
    } catch (caught) {
      onError(getErrorMessage(caught, 'Не удалось сохранить зал.'));
    }
  };
  return (
    <Dialog
      closeLabel="Закрыть"
      onClose={onClose}
      open={open}
      title={room ? 'Редактировать зал' : 'Новый зал'}
      wide
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Название">
          <Input
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            value={form.name}
          />
        </Field>
        <Field label="Вместимость">
          <Input
            min={1}
            onChange={(event) =>
              setForm({
                ...form,
                capacity: event.target.value ? Number(event.target.value) : undefined,
              })
            }
            type="number"
            value={form.capacity ?? ''}
          />
        </Field>
        <Field label="Этаж">
          <Input
            onChange={(event) => setForm({ ...form, floor: event.target.value || undefined })}
            value={form.floor ?? ''}
          />
        </Field>
        <Field label="Площадь, м²">
          <Input
            min={1}
            onChange={(event) =>
              setForm({
                ...form,
                areaSquareMeters: event.target.value ? Number(event.target.value) : undefined,
              })
            }
            type="number"
            value={form.areaSquareMeters ?? ''}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Описание">
            <Textarea
              onChange={(event) =>
                setForm({ ...form, description: event.target.value || undefined })
              }
              value={form.description ?? ''}
            />
          </Field>
        </div>
        <label className="col-span-2 flex items-center gap-3 rounded-xl bg-muted/50 p-3 text-sm font-medium">
          <Checkbox
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          />
          Зал открыт для новых занятий и аренд
        </label>
        {error ? <p className="col-span-2 text-sm text-red-600">{error}</p> : null}
        <div className="col-span-2 flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            Отмена
          </Button>
          <Button disabled={!form.name.trim() || !form.branchId} onClick={() => void submit()}>
            Сохранить
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RoomEventDialog({
  event,
  onClose,
  onError,
  onSaved,
}: {
  event: { room: RoomSummary; type: 'rental' | 'closure' } | null;
  onClose: () => void;
  onError: (value?: string) => void;
  onSaved: () => Promise<void>;
}) {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const [startAt, setStartAt] = useState(localInput(start));
  const [endAt, setEndAt] = useState(localInput(new Date(start.getTime() + 3_600_000)));
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [affected, setAffected] = useState<string[]>([]);
  useEffect(() => {
    if (event) {
      setName('');
      setComment('');
      setAffected([]);
    }
  }, [event]);
  const submit = async () => {
    if (!event) return;
    try {
      onError(undefined);
      if (event.type === 'rental') {
        const input: RoomRentalInput = {
          branchId: event.room.branchId,
          clientName: name || undefined,
          comment: comment || undefined,
          endAt: new Date(endAt).toISOString(),
          roomId: event.room.id,
          startAt: new Date(startAt).toISOString(),
        };
        await getDesktopApi().rentals.create(getSessionToken(), input);
      } else {
        const input: RoomClosureInput = {
          comment: comment || undefined,
          endAt: new Date(endAt).toISOString(),
          reason: name,
          roomId: event.room.id,
          startAt: new Date(startAt).toISOString(),
        };
        const preview = await getDesktopApi().closures.preview(getSessionToken(), input);
        if (preview.affected.length && affected.length === 0) {
          setAffected(
            preview.affected.map(
              (item) =>
                `${new Date(item.startAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — ${item.title}`,
            ),
          );
          return;
        }
        await getDesktopApi().closures.create(getSessionToken(), input);
      }
      await onSaved();
    } catch (caught) {
      onError(getErrorMessage(caught, 'Не удалось сохранить событие.'));
    }
  };
  return (
    <Dialog
      closeLabel="Закрыть"
      onClose={onClose}
      open={Boolean(event)}
      title={event?.type === 'rental' ? 'Аренда зала' : 'Временно закрыть зал'}
      wide
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Начало">
          <Input
            onChange={(e) => setStartAt(e.target.value)}
            type="datetime-local"
            value={startAt}
          />
        </Field>
        <Field label="Окончание">
          <Input onChange={(e) => setEndAt(e.target.value)} type="datetime-local" value={endAt} />
        </Field>
        <div className="col-span-2">
          <Field label={event?.type === 'rental' ? 'Клиент' : 'Причина'}>
            <Input
              onChange={(e) => setName(e.target.value)}
              placeholder={
                event?.type === 'closure' ? 'Например, технические работы' : 'Имя или организация'
              }
              value={name}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Комментарий">
            <Textarea onChange={(e) => setComment(e.target.value)} value={comment} />
          </Field>
        </div>
        {affected.length ? (
          <div className="col-span-2 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="font-semibold">Закрытие затронет событий: {affected.length}</p>
            {affected.map((item) => (
              <p className="mt-1 text-sm" key={item}>
                {item}
              </p>
            ))}
            <p className="mt-3 text-xs text-muted-foreground">
              События не будут удалены или перемещены автоматически.
            </p>
          </div>
        ) : null}
        <div className="col-span-2 flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            Отмена
          </Button>
          <Button
            disabled={event?.type === 'closure' && !name.trim()}
            onClick={() => void submit()}
          >
            {affected.length ? 'Подтвердить закрытие' : 'Сохранить'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
