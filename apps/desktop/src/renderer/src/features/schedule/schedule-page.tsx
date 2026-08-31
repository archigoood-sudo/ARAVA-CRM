import {
  formatDate,
  formatWeekday,
  t,
  type LessonGenerateInput,
  type LessonInput,
  type LessonListQuery,
  type RoomSummary,
  type WeeklyScheduleInput,
  type WeeklyScheduleQuery,
  type WeeklyScheduleSummary,
} from '@arava/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  WeekCalendar,
  Dialog,
  Label,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus,
  CalendarX,
  CheckCheck,
  Clock3,
  Pencil,
  Plus,
  UserRoundCheck,
  ChevronLeft,
  ChevronRight,
  Copy,
  PartyPopper,
  Printer,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { localDateInputValue } from '../../lib/local-date';
import { invalidateLessonCaches } from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { LessonDialog } from './lesson-dialog';
import {
  buildRoomWeekPrintModel,
  buildRoomWeekSections,
  roomWeekDateKeys,
} from './room-week-model';
import { ScheduleDialog } from './schedule-dialog';

function calendarRange(view: 'day' | 'month' | 'week', selectedDate: string): LessonListQuery {
  const from = new Date(`${selectedDate}T12:00:00`);
  from.setHours(0, 0, 0, 0);
  if (view === 'week') from.setDate(from.getDate() - ((from.getDay() || 7) - 1));
  if (view === 'month') from.setDate(1);
  const to = new Date(from);
  if (view === 'week') to.setDate(to.getDate() + 6);
  if (view === 'month') to.setMonth(to.getMonth() + 1, 0);
  to.setHours(23, 59, 59, 999);
  return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
}

export function SchedulePage() {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role !== 'COACH';
  const navigate = useNavigate();
  const client = useQueryClient();
  const [filter, setFilter] = useState<WeeklyScheduleQuery>({});
  const [calendarView, setCalendarView] = useState<'day' | 'month' | 'week'>('week');
  const [selectedDate, setSelectedDate] = useState(localDateInputValue());
  const [copyOpen, setCopyOpen] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState(
    localDateInputValue(new Date(Date.now() + 86_400_000)),
  );
  const [exceptionTitle, setExceptionTitle] = useState('Праздничный день');
  const [exceptionType, setExceptionType] = useState<'CUSTOM' | 'DAY_OFF' | 'HOLIDAY' | 'VACATION'>(
    'HOLIDAY',
  );
  const [scheduleDialog, setScheduleDialog] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<WeeklyScheduleSummary | null>(null);
  const [lessonDialog, setLessonDialog] = useState(false);
  const [printRoom, setPrintRoom] = useState<RoomSummary | null>(null);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [generation, setGeneration] = useState<LessonGenerateInput>({
    dateFrom: localDateInputValue(),
    dateTo: localDateInputValue(new Date(Date.now() + 30 * 86_400_000)),
  });
  const lessonQuery = useMemo(
    () => ({
      ...calendarRange(calendarView, selectedDate),
      branchId: filter.branchId,
      coachId: filter.coachId,
      groupId: filter.groupId,
      roomId: filter.roomId,
    }),
    [calendarView, filter.branchId, filter.coachId, filter.groupId, filter.roomId, selectedDate],
  );
  const schedules = useQuery({
    queryFn: () => getDesktopApi().schedules.list(getSessionToken(), filter),
    queryKey: queryKeys.schedules(filter),
  });
  const lessons = useQuery({
    queryFn: () => getDesktopApi().lessons.list(getSessionToken(), lessonQuery),
    queryKey: queryKeys.lessons(lessonQuery),
  });
  const printOccurrences = useQuery({
    enabled: Boolean(printRoom),
    queryFn: async () => {
      const days = await Promise.all(
        roomWeekDateKeys(selectedDate).map((date) =>
          getDesktopApi().attendance.today(getSessionToken(), date),
        ),
      );
      return days.flatMap(({ lessons: dayLessons }) => dayLessons);
    },
    queryKey: ['schedule-room-print-occurrences', selectedDate],
  });
  const groups = useQuery({
    queryFn: () => getDesktopApi().groups.list(getSessionToken(), {}),
    queryKey: queryKeys.groups({}),
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const staff = useQuery({
    queryFn: () => getDesktopApi().users.staffOptions(getSessionToken()),
    queryKey: queryKeys.staffOptions,
  });
  const rooms = useQuery({
    queryFn: () => getDesktopApi().rooms.list(getSessionToken()),
    queryKey: ['rooms'],
  });
  const calendarEventsQuery = useMemo(
    () => ({
      branchId: filter.branchId,
      dateFrom: lessonQuery.dateFrom,
      dateTo: lessonQuery.dateTo,
      roomId: filter.roomId,
    }),
    [filter.branchId, filter.roomId, lessonQuery.dateFrom, lessonQuery.dateTo],
  );
  const rentals = useQuery({
    queryFn: () => getDesktopApi().rentals.list(getSessionToken(), calendarEventsQuery),
    queryKey: ['rentals', calendarEventsQuery],
    enabled: user?.role !== 'COACH',
  });
  const closures = useQuery({
    queryFn: () => getDesktopApi().closures.list(getSessionToken(), calendarEventsQuery),
    queryKey: ['closures', calendarEventsQuery],
  });
  const saveSchedule = useMutation({
    mutationFn: (input: WeeklyScheduleInput) =>
      editingSchedule
        ? getDesktopApi().schedules.update(getSessionToken(), editingSchedule.id, input)
        : getDesktopApi().schedules.create(getSessionToken(), input),
  });
  const deactivateSchedule = useMutation({
    mutationFn: (id: string) => getDesktopApi().schedules.deactivate(getSessionToken(), id),
  });
  const saveLesson = useMutation({
    mutationFn: (input: LessonInput) => getDesktopApi().lessons.create(getSessionToken(), input),
  });
  const generate = useMutation({
    mutationFn: (input: LessonGenerateInput) =>
      getDesktopApi().lessons.generate(getSessionToken(), input),
  });
  const submitSchedule = async (input: WeeklyScheduleInput) => {
    setError(undefined);
    try {
      await saveSchedule.mutateAsync(input);
      await client.invalidateQueries({ queryKey: ['schedules'] });
      setScheduleDialog(false);
    } catch (caught) {
      setError(getErrorMessage(caught, t('schedule.errorSave')));
    }
  };
  const submitLesson = async (input: LessonInput) => {
    setError(undefined);
    try {
      await saveLesson.mutateAsync(input);
      await invalidateLessonCaches(client);
      setLessonDialog(false);
    } catch (caught) {
      setError(getErrorMessage(caught, t('schedule.errorSave')));
    }
  };
  const runGeneration = async () => {
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await generate.mutateAsync(generation);
      setMessage(t('schedule.generated', { created: result.created, skipped: result.skipped }));
      await invalidateLessonCaches(client);
    } catch (caught) {
      setError(getErrorMessage(caught, t('schedule.errorSave')));
    }
  };
  const visibleRooms = useMemo(
    () =>
      (rooms.data ?? []).filter(
        (room) =>
          (!filter.branchId || room.branchId === filter.branchId) &&
          (!filter.roomId || room.id === filter.roomId),
      ),
    [filter.branchId, filter.roomId, rooms.data],
  );
  const roomSections = useMemo(
    () => buildRoomWeekSections(visibleRooms, schedules.data ?? []),
    [schedules.data, visibleRooms],
  );
  const knownRoomIds = useMemo(() => new Set((rooms.data ?? []).map(({ id }) => id)), [rooms.data]);
  const unassignedSchedules = useMemo(
    () =>
      filter.roomId
        ? []
        : (schedules.data ?? []).filter(
            (schedule) => !schedule.roomId || !knownRoomIds.has(schedule.roomId),
          ),
    [filter.roomId, knownRoomIds, schedules.data],
  );
  const printModel = useMemo(
    () =>
      printRoom && printOccurrences.data
        ? buildRoomWeekPrintModel(printRoom, printOccurrences.data, selectedDate)
        : undefined,
    [printOccurrences.data, printRoom, selectedDate],
  );
  useEffect(() => {
    if (!printModel) return;
    const clear = () => setPrintRoom(null);
    window.addEventListener('afterprint', clear, { once: true });
    const frame = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', clear);
    };
  }, [printModel]);
  const days = [1, 2, 3, 4, 5, 6, 7].map(formatWeekday);
  return (
    <main className="mx-auto w-full max-w-[1600px] animate-fade-in p-9 pb-14">
      <PageHeader
        action={
          canManage ? (
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setEditingSchedule(null);
                  setError(undefined);
                  setScheduleDialog(true);
                }}
                variant="outline"
              >
                <CalendarPlus className="size-4" />
                {t('schedule.action.add')}
              </Button>
              <Button
                onClick={() => {
                  setError(undefined);
                  setLessonDialog(true);
                }}
              >
                <Plus className="size-4" />
                {t('schedule.action.oneOff')}
              </Button>
            </div>
          ) : undefined
        }
        description={t('schedule.pageDescription')}
        eyebrow={t('page.schedule.eyebrow')}
        title={t('schedule.pageTitle')}
      />
      <Card className="mb-5 flex flex-wrap items-center gap-3 p-4">
        <Button
          aria-label="Предыдущий период"
          onClick={() => {
            const value = new Date(`${selectedDate}T12:00:00`);
            if (calendarView === 'month') value.setMonth(value.getMonth() - 1);
            else value.setDate(value.getDate() - (calendarView === 'week' ? 7 : 1));
            setSelectedDate(localDateInputValue(value));
          }}
          size="icon"
          variant="outline"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button onClick={() => setSelectedDate(localDateInputValue())} variant="outline">
          Сегодня
        </Button>
        <Input
          aria-label="Дата календаря"
          className="w-40"
          onChange={(event) => setSelectedDate(event.target.value)}
          type="date"
          value={selectedDate}
        />
        <Button
          aria-label="Следующий период"
          onClick={() => {
            const value = new Date(`${selectedDate}T12:00:00`);
            if (calendarView === 'month') value.setMonth(value.getMonth() + 1);
            else value.setDate(value.getDate() + (calendarView === 'week' ? 7 : 1));
            setSelectedDate(localDateInputValue(value));
          }}
          size="icon"
          variant="outline"
        >
          <ChevronRight className="size-4" />
        </Button>
        <Select
          onChange={(event) =>
            setFilter((value) => ({ ...value, branchId: event.target.value || undefined }))
          }
        >
          <option value="">{t('schedule.allBranches')}</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
        <Select
          onChange={(event) =>
            setFilter((value) => ({ ...value, roomId: event.target.value || undefined }))
          }
          value={filter.roomId ?? ''}
        >
          <option value="">Все залы</option>
          {rooms.data
            ?.filter((room) => !filter.branchId || room.branchId === filter.branchId)
            .map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
        </Select>
        <Select
          onChange={(event) =>
            setFilter((value) => ({ ...value, groupId: event.target.value || undefined }))
          }
          value={filter.groupId ?? ''}
        >
          <option value="">Все группы</option>
          {groups.data
            ?.filter((group) => !filter.branchId || group.branchId === filter.branchId)
            .map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
        </Select>
        <Select
          onChange={(event) =>
            setFilter((value) => ({ ...value, coachId: event.target.value || undefined }))
          }
        >
          <option value="">{t('schedule.allCoaches')}</option>
          {staff.data?.map((coach) => (
            <option key={coach.id} value={coach.id}>
              {coach.fullName}
            </option>
          ))}
        </Select>
        {canManage ? (
          <>
            <Input
              className="w-40"
              aria-label={t('schedule.dateFrom')}
              onChange={(event) =>
                setGeneration((value) => ({ ...value, dateFrom: event.target.value }))
              }
              type="date"
              value={generation.dateFrom}
            />
            <Input
              className="w-40"
              aria-label={t('schedule.dateTo')}
              onChange={(event) =>
                setGeneration((value) => ({ ...value, dateTo: event.target.value }))
              }
              type="date"
              value={generation.dateTo}
            />
            <Button
              disabled={generate.isPending}
              onClick={() => void runGeneration()}
              variant="outline"
            >
              <CheckCheck className="size-4" />
              {t('schedule.action.generate')}
            </Button>
            <Button onClick={() => setCopyOpen(true)} variant="outline">
              <Copy className="size-4" />
              Копировать день
            </Button>
            <Button onClick={() => setExceptionOpen(true)} variant="outline">
              <PartyPopper className="size-4" />
              Исключение
            </Button>
          </>
        ) : null}
        {message ? <p className="text-sm font-medium text-emerald-700">{message}</p> : null}
        {error && !scheduleDialog && !lessonDialog ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : null}
      </Card>
      {schedules.isLoading ? <LoadingState label={t('schedule.loading')} /> : null}
      {schedules.isError ? (
        <ErrorState
          message={t('schedule.errorLoad')}
          onRetry={() => void schedules.refetch()}
          retryLabel={t('common.retry')}
          title={t('common.errorTitle')}
        />
      ) : null}
      <div className="space-y-6" data-testid="room-week-sections">
        {roomSections.map(({ room, schedules: roomSchedules }) => (
          <Card className="overflow-hidden" data-room-id={room.id} key={room.id}>
            <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border">
              <div className="min-w-0">
                <CardTitle className="truncate">{room.name}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{room.branchName}</p>
              </div>
              <Button
                data-testid={`print-room-week-${room.id}`}
                onClick={() => setPrintRoom(room)}
                size="small"
                variant="outline"
              >
                <Printer className="size-4" />
                Печать недели
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto p-4">
              <WeekCalendar
                days={days}
                emptyLabel="Нет занятий"
                items={roomSchedules.map((schedule) => ({
                  color: groups.data?.find(({ id }) => id === schedule.groupId)?.color,
                  content: (
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {schedule.startTime}–{schedule.endTime}
                        </p>
                        <p className="mt-1 truncate">{schedule.groupName}</p>
                        <p className="mt-1 truncate text-muted-foreground">
                          {schedule.coachName ?? 'Тренер не назначен'}
                        </p>
                      </div>
                      {canManage ? (
                        <span className="flex shrink-0 gap-1">
                          <button
                            aria-label={`${t('common.edit')}: ${schedule.groupName}`}
                            onClick={() => {
                              setEditingSchedule(schedule);
                              setScheduleDialog(true);
                            }}
                            type="button"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            aria-label={`${t('schedule.deactivate')}: ${schedule.groupName}`}
                            onClick={async () => {
                              await deactivateSchedule.mutateAsync(schedule.id);
                              await client.invalidateQueries({ queryKey: ['schedules'] });
                            }}
                            type="button"
                          >
                            <CalendarX className="size-3.5" />
                          </button>
                        </span>
                      ) : null}
                    </div>
                  ),
                  id: schedule.id,
                  weekday: schedule.weekday,
                }))}
              />
            </CardContent>
          </Card>
        ))}
        {!schedules.isLoading && roomSections.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            В доступных филиалах нет активных залов.
          </Card>
        ) : null}
        {unassignedSchedules.length ? (
          <Card className="overflow-hidden border-amber-200">
            <CardHeader className="border-b border-amber-200 bg-amber-50/70">
              <CardTitle>Без назначенного зала</CardTitle>
              <p className="text-xs text-muted-foreground">
                Назначьте зал, чтобы расписание появилось в соответствующем разделе.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-4">
              <WeekCalendar
                days={days}
                emptyLabel="Нет занятий"
                items={unassignedSchedules.map((schedule) => ({
                  content: (
                    <div>
                      <p className="font-semibold">
                        {schedule.startTime}–{schedule.endTime}
                      </p>
                      <p className="mt-1 truncate">{schedule.groupName}</p>
                    </div>
                  ),
                  id: schedule.id,
                  weekday: schedule.weekday,
                }))}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
      {printModel ? (
        <section
          aria-label={`Расписание на неделю: ${printModel.roomName}`}
          className="room-week-print-sheet"
          data-testid="room-week-print-sheet"
        >
          <header>
            <p>ARAVA CRM · Студия танца</p>
            <h1>{printModel.roomName}</h1>
            <h2>{printModel.weekRange}</h2>
          </header>
          <div className="room-week-print-grid">
            {printModel.days.map((day) => (
              <section key={day.date}>
                <h3>{day.label}</h3>
                {day.lessons.length ? (
                  day.lessons.map((lesson) => (
                    <article
                      className={lesson.cancelled ? 'is-cancelled' : undefined}
                      key={lesson.id}
                    >
                      <b>{lesson.time}</b>
                      <strong>{lesson.groupName}</strong>
                      <span>{lesson.trainerName}</span>
                      {lesson.replacement ? <small>Замена</small> : null}
                      {lesson.cancelled ? <small>Отменено</small> : null}
                    </article>
                  ))
                ) : (
                  <p>Нет занятий</p>
                )}
              </section>
            ))}
          </div>
        </section>
      ) : null}
      <Card className="mt-5">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t('lesson.details')}</CardTitle>
          <div className="flex rounded-xl bg-muted p-1">
            {(['day', 'week', 'month'] as const).map((view) => (
              <button
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${calendarView === view ? 'bg-surface shadow-sm' : 'text-muted-foreground'}`}
                key={view}
                onClick={() => setCalendarView(view)}
                type="button"
              >
                {view === 'day' ? 'День' : view === 'week' ? 'Неделя' : 'Месяц'}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {lessons.data?.map((lesson) => (
            <article
              className="flex items-center gap-4 rounded-2xl border border-border bg-background p-4"
              key={lesson.id}
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft">
                <Clock3 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{lesson.groupName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(lesson.startsAt, {
                    day: 'numeric',
                    month: 'long',
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · {lesson.roomName ?? lesson.room ?? 'Зал не указан'}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2 text-right">
                <StatusBadge tone={lesson.status === 'CANCELLED' ? 'danger' : 'success'}>
                  {t(`lesson.status.${lesson.status}`)}
                </StatusBadge>
                <button
                  className="mt-2 flex items-center gap-1 text-xs font-semibold"
                  onClick={() => navigate(`/attendance/${lesson.id}`)}
                  type="button"
                >
                  <UserRoundCheck className="size-3.5" />
                  {t('lesson.action.attendance')}
                </button>
                <button
                  className="text-xs font-semibold text-muted-foreground"
                  onClick={() => navigate(`/lessons/${lesson.id}`)}
                  type="button"
                >
                  {t('lesson.details')}
                </button>
              </div>
            </article>
          ))}
          {rentals.data?.map((rental) => (
            <article
              className="rounded-2xl border border-violet-200 bg-violet-50 p-4"
              key={rental.id}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">
                Аренда зала
              </p>
              <p className="mt-2 font-semibold">
                {rental.roomName}
                {rental.clientName ? ` · ${rental.clientName}` : ''}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(rental.startAt, {
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
              {canManage && rental.status === 'ACTIVE' ? (
                <Button
                  className="mt-3"
                  onClick={async () => {
                    await getDesktopApi().rentals.cancel(getSessionToken(), rental.id);
                    await client.invalidateQueries({ queryKey: ['rentals'] });
                  }}
                  size="small"
                  variant="outline"
                >
                  Отменить аренду
                </Button>
              ) : null}
            </article>
          ))}
          {closures.data?.map((closure) => (
            <article
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
              key={closure.id}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                Зал закрыт
              </p>
              <p className="mt-2 font-semibold">
                {closure.roomName} · {closure.reason}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(closure.startAt, {
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </article>
          ))}
        </CardContent>
      </Card>
      <ScheduleDialog
        branches={branches.data ?? []}
        error={scheduleDialog ? error : undefined}
        groups={groups.data ?? []}
        onClose={() => setScheduleDialog(false)}
        onSubmit={submitSchedule}
        open={scheduleDialog}
        rooms={rooms.data ?? []}
        schedule={editingSchedule}
        staff={staff.data ?? []}
      />
      <LessonDialog
        error={lessonDialog ? error : undefined}
        groups={groups.data ?? []}
        lesson={null}
        onClose={() => setLessonDialog(false)}
        onSubmit={submitLesson}
        open={lessonDialog}
        rooms={rooms.data ?? []}
        staff={staff.data ?? []}
      />
      <Dialog
        closeLabel="Закрыть"
        onClose={() => setCopyOpen(false)}
        open={copyOpen}
        title="Копировать расписание дня"
      >
        <div className="space-y-4">
          <div>
            <Label>Дата назначения</Label>
            <Input
              className="mt-2"
              onChange={(event) => setCopyTarget(event.target.value)}
              type="date"
              value={copyTarget}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button onClick={() => setCopyOpen(false)} variant="outline">
              Отмена
            </Button>
            <Button
              onClick={async () => {
                const result = await getDesktopApi().lessons.copyDay(getSessionToken(), {
                  sourceDate: selectedDate,
                  targetDate: copyTarget,
                });
                setMessage(
                  `Скопировано: ${String(result.copied)}. Конфликты: ${String(result.conflicts)}.`,
                );
                await invalidateLessonCaches(client);
                setCopyOpen(false);
              }}
            >
              Копировать
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        closeLabel="Закрыть"
        onClose={() => setExceptionOpen(false)}
        open={exceptionOpen}
        title="Исключение календаря"
      >
        <div className="space-y-4">
          <div>
            <Label>Название</Label>
            <Input
              className="mt-2"
              onChange={(event) => setExceptionTitle(event.target.value)}
              value={exceptionTitle}
            />
          </div>
          <div>
            <Label>Тип исключения</Label>
            <Select
              className="mt-2"
              onChange={(event) => setExceptionType(event.target.value as typeof exceptionType)}
              value={exceptionType}
            >
              <option value="HOLIDAY">Праздничный день</option>
              <option value="DAY_OFF">Выходной день</option>
              <option value="VACATION">Каникулы</option>
              <option value="CUSTOM">Особый период</option>
            </Select>
          </div>
          <p className="text-sm text-muted-foreground">
            На выбранную дату новые занятия по шаблонам создаваться не будут.
          </p>
          <div className="flex justify-end gap-3">
            <Button onClick={() => setExceptionOpen(false)} variant="outline">
              Отмена
            </Button>
            <Button
              onClick={async () => {
                const start = new Date(`${selectedDate}T00:00:00`);
                const end = new Date(`${selectedDate}T23:59:59.999`);
                await getDesktopApi().calendarExceptions.create(getSessionToken(), {
                  ...(filter.branchId ? { branchId: filter.branchId } : {}),
                  endAt: end.toISOString(),
                  startAt: start.toISOString(),
                  title: exceptionTitle,
                  type: exceptionType,
                });
                setMessage('Исключение календаря создано.');
                setExceptionOpen(false);
              }}
            >
              Создать
            </Button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
