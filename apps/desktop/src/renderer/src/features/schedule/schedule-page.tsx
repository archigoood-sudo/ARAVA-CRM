import {
  formatDate,
  formatWeekday,
  t,
  type LessonGenerateInput,
  type LessonInput,
  type LessonListQuery,
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
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { LessonDialog } from './lesson-dialog';
import { ScheduleDialog } from './schedule-dialog';

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
function calendarRange(view: 'day' | 'week'): LessonListQuery {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (view === 'week') from.setDate(from.getDate() - ((from.getDay() || 7) - 1));
  const to = new Date(from);
  if (view === 'week') to.setDate(to.getDate() + 6);
  to.setHours(23, 59, 59, 999);
  return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
}

export function SchedulePage() {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role !== 'COACH';
  const navigate = useNavigate();
  const client = useQueryClient();
  const [filter, setFilter] = useState<WeeklyScheduleQuery>({});
  const [calendarView, setCalendarView] = useState<'day' | 'week'>('week');
  const [scheduleDialog, setScheduleDialog] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<WeeklyScheduleSummary | null>(null);
  const [lessonDialog, setLessonDialog] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [generation, setGeneration] = useState<LessonGenerateInput>({
    dateFrom: isoDate(new Date()),
    dateTo: isoDate(new Date(Date.now() + 30 * 86_400_000)),
  });
  const lessonQuery = useMemo(
    () => ({ ...calendarRange(calendarView), branchId: filter.branchId, coachId: filter.coachId }),
    [calendarView, filter.branchId, filter.coachId],
  );
  const schedules = useQuery({
    queryFn: () => getDesktopApi().schedules.list(getSessionToken(), filter),
    queryKey: queryKeys.schedules(filter),
  });
  const lessons = useQuery({
    queryFn: () => getDesktopApi().lessons.list(getSessionToken(), lessonQuery),
    queryKey: queryKeys.lessons(lessonQuery),
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
      await client.invalidateQueries({ queryKey: ['lessons'] });
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
      await client.invalidateQueries({ queryKey: ['lessons'] });
    } catch (caught) {
      setError(getErrorMessage(caught, t('schedule.errorSave')));
    }
  };
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
      <div className="overflow-x-auto pb-2">
        <WeekCalendar
          days={days}
          emptyLabel={t('schedule.empty')}
          items={(schedules.data ?? []).map((schedule) => ({
            color: groups.data?.find(({ id }) => id === schedule.groupId)?.color,
            content: (
              <div>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {schedule.startTime}–{schedule.endTime}
                    </p>
                    <p className="mt-1 truncate">{schedule.groupName}</p>
                    <p className="mt-1 text-muted-foreground">
                      {schedule.room ?? schedule.branchName}
                    </p>
                  </div>
                  {canManage ? (
                    <span className="flex gap-1">
                      <button
                        aria-label={t('common.edit')}
                        onClick={() => {
                          setEditingSchedule(schedule);
                          setScheduleDialog(true);
                        }}
                        type="button"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        aria-label={t('schedule.deactivate')}
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
              </div>
            ),
            id: schedule.id,
            weekday: schedule.weekday,
          }))}
        />
      </div>
      <Card className="mt-5">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t('lesson.details')}</CardTitle>
          <div className="flex rounded-xl bg-muted p-1">
            {(['day', 'week'] as const).map((view) => (
              <button
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${calendarView === view ? 'bg-surface shadow-sm' : 'text-muted-foreground'}`}
                key={view}
                onClick={() => setCalendarView(view)}
                type="button"
              >
                {t(view === 'day' ? 'schedule.view.day' : 'schedule.view.week')}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
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
                  · {lesson.room ?? t('common.notSpecified')}
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
        </CardContent>
      </Card>
      <ScheduleDialog
        branches={branches.data ?? []}
        error={scheduleDialog ? error : undefined}
        groups={groups.data ?? []}
        onClose={() => setScheduleDialog(false)}
        onSubmit={submitSchedule}
        open={scheduleDialog}
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
        staff={staff.data ?? []}
      />
    </main>
  );
}
