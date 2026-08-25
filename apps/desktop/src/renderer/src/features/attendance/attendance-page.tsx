import { formatDate, type AttendanceEntryInput, type AttendanceStatus } from '@arava/shared';
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
  Select,
  cn,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCheck,
  CircleCheck,
  Clock3,
  Plus,
  Search,
  UserRoundCheck,
  UserRoundX,
  UsersRound,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { invalidateAttendanceCaches } from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const operationalStatuses: {
  active: string;
  icon: typeof UserRoundCheck;
  label: string;
  status: Extract<AttendanceStatus, 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'>;
}[] = [
  {
    active: 'border-emerald-600 bg-emerald-600 text-white',
    icon: UserRoundCheck,
    label: 'Присутствовал',
    status: 'PRESENT',
  },
  {
    active: 'border-sky-500 bg-sky-500 text-white',
    icon: Clock3,
    label: 'Опоздал',
    status: 'LATE',
  },
  {
    active: 'border-red-500 bg-red-500 text-white',
    icon: UserRoundX,
    label: 'Отсутствовал',
    status: 'ABSENT',
  },
  {
    active: 'border-amber-500 bg-amber-500 text-white',
    icon: CircleCheck,
    label: 'Болел',
    status: 'EXCUSED',
  },
];

const statusLabels: Record<AttendanceStatus, string> = {
  ABSENT: 'Отсутствовал',
  EXCUSED: 'Болел',
  LATE: 'Опоздал',
  PRESENT: 'Присутствовал',
  TRIAL: 'Пробное занятие',
};

export function AttendancePage() {
  const { lessonId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualStatus, setManualStatus] =
    useState<Extract<AttendanceStatus, 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'>>('PRESENT');
  const [manualStudentId, setManualStudentId] = useState('');
  const user = useAuthStore((state) => state.user);
  const client = useQueryClient();
  const attendance = useQuery({
    enabled: Boolean(lessonId),
    queryFn: () => getDesktopApi().attendance.get(getSessionToken(), lessonId),
    queryKey: queryKeys.attendance(lessonId),
  });
  const save = useMutation({
    mutationFn: (entries: AttendanceEntryInput[]) =>
      getDesktopApi().attendance.save(getSessionToken(), lessonId, entries),
    onSuccess: async (data) => {
      client.setQueryData(queryKeys.attendance(lessonId), data);
      await invalidateAttendanceCaches(client);
    },
  });
  const studentOptions = useQuery({
    enabled: manualOpen && Boolean(attendance.data?.lesson.branchId),
    queryFn: () =>
      getDesktopApi().students.options(
        getSessionToken(),
        attendance.data?.lesson.branchId ?? undefined,
      ),
    queryKey: ['attendance', 'manual-student-options', attendance.data?.lesson.branchId, user?.id],
  });
  const manualSave = useMutation({
    mutationFn: () =>
      getDesktopApi().attendance.manualSave(getSessionToken(), lessonId, {
        status: manualStatus,
        studentId: manualStudentId,
      }),
    onSuccess: async (data) => {
      client.setQueryData(queryKeys.attendance(lessonId), data);
      setManualOpen(false);
      setManualStudentId('');
      setManualStatus('PRESENT');
      await invalidateAttendanceCaches(client);
    },
  });

  const filteredParticipants = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('ru-RU');
    if (!normalized) return attendance.data?.participants ?? [];
    return (attendance.data?.participants ?? []).filter(({ studentName }) =>
      studentName.toLocaleLowerCase('ru-RU').includes(normalized),
    );
  }, [attendance.data?.participants, search]);

  if (attendance.isLoading) return <LoadingState label="Загружаем список учеников…" />;
  if (!attendance.data || attendance.isError)
    return (
      <ErrorState
        message="Не удалось загрузить посещаемость занятия."
        onRetry={() => void attendance.refetch()}
        retryLabel="Повторить"
        title="Что-то пошло не так"
      />
    );

  const { lesson, participants } = attendance.data;
  const participantIds = new Set(participants.map(({ studentId }) => studentId));
  const manualCandidates = (studentOptions.data ?? []).filter(({ id }) => !participantIds.has(id));
  const counts = {
    ABSENT: participants.filter(({ status }) => status === 'ABSENT').length,
    EXCUSED: participants.filter(({ status }) => status === 'EXCUSED').length,
    LATE: participants.filter(({ status }) => status === 'LATE').length,
    PRESENT: participants.filter(({ status }) => status === 'PRESENT').length,
    UNMARKED: participants.filter(({ status }) => !status).length,
  };
  const workspaceDate = searchParams.get('date');
  const returnTo =
    searchParams.get('from') === 'workspace'
      ? `/attendance${workspaceDate ? `?date=${workspaceDate}` : ''}`
      : `/lessons/${lessonId}`;

  return (
    <main className="mx-auto w-full max-w-[1320px] animate-fade-in p-7 pb-16 min-[1500px]:p-9">
      <Link
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        to={returnTo}
      >
        <ArrowLeft className="size-4" />
        {returnTo.startsWith('/attendance') ? 'К выбранному дню' : 'К занятию'}
      </Link>

      <header className="mb-5 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {formatDate(lesson.startsAt, { dateStyle: 'long', timeStyle: 'short' })}
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.045em]">{lesson.groupName}</h1>
          <p className="mt-2 text-muted-foreground">Отмечайте учеников одним нажатием</p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-2 text-sm font-semibold">
            <CircleCheck className="size-4 text-emerald-500" />
            Изменения сохраняются сразу
          </p>
          {attendance.data.attendanceCompletedAt ? (
            <Badge className="mt-2 bg-emerald-50 text-emerald-700">Посещаемость заполнена</Badge>
          ) : null}
        </div>
      </header>

      <section className="sticky top-0 z-20 -mx-2 mb-5 grid grid-cols-2 gap-2 bg-background/95 px-2 py-3 backdrop-blur md:grid-cols-5">
        {[
          ['Присутствуют', counts.PRESENT, 'text-emerald-700'],
          ['Опоздали', counts.LATE, 'text-sky-700'],
          ['Отсутствуют', counts.ABSENT, 'text-red-600'],
          ['Болеют', counts.EXCUSED, 'text-amber-700'],
          ['Не отмечены', counts.UNMARKED, 'text-muted-foreground'],
        ].map(([label, value, tone]) => (
          <Card className="px-4 py-3" key={String(label)}>
            <p className={cn('text-2xl font-semibold tabular-nums', tone)}>{value}</p>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
          </Card>
        ))}
      </section>

      {participants.length > 0 && counts.UNMARKED === 0 ? (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <CheckCheck className="size-4" /> Все ученики отмечены
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div className="relative min-w-64 flex-1 md:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Поиск ученика"
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Имя или фамилия"
              value={search}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {user?.role !== 'COACH' ? (
              <Button onClick={() => setManualOpen(true)} variant="outline">
                <Plus className="size-4" />
                Добавить ученика в занятие
              </Button>
            ) : null}
            <Button
              disabled={save.isPending || participants.length === 0}
              onClick={() =>
                void save.mutateAsync(
                  participants.map(({ studentId }) => ({ status: 'PRESENT', studentId })),
                )
              }
            >
              <CheckCheck className="size-4" />
              Отметить всех присутствующими
            </Button>
          </div>
        </div>

        {participants.length === 0 ? (
          <div className="p-8">
            <EmptyState
              description="Добавьте ученика в группу или только в это занятие, чтобы отметить посещаемость."
              icon={UsersRound}
              title="В группе пока нет учеников"
            />
          </div>
        ) : filteredParticipants.length === 0 ? (
          <div className="p-8">
            <EmptyState
              description="Проверьте написание имени или фамилии."
              icon={Search}
              title="Ученик не найден"
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredParticipants.map((participant) => (
              <article
                className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"
                key={participant.studentId}
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{participant.studentName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {participant.status ? statusLabels[participant.status] : 'Ещё не отмечен'}
                  </p>
                  {participant.addedToGroupLater ? (
                    <Badge className="mt-2 bg-sky-50 text-sky-700">Добавлен в группу позже</Badge>
                  ) : null}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {operationalStatuses.map(({ active, icon: Icon, label, status }) => (
                    <button
                      aria-label={`${participant.studentName}: ${label}`}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition active:scale-[0.98]',
                        participant.status === status
                          ? active
                          : 'border-border bg-surface hover:border-neutral-300 hover:bg-muted',
                      )}
                      disabled={save.isPending}
                      key={status}
                      onClick={() =>
                        void save.mutateAsync([{ status, studentId: participant.studentId }])
                      }
                      type="button"
                    >
                      <Icon className="size-4" />
                      <span className="hidden xl:inline">{label}</span>
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <Dialog
        closeLabel="Закрыть"
        description="Ученик будет добавлен только в список этого занятия. История группы не изменится."
        onClose={() => setManualOpen(false)}
        open={manualOpen}
        title="Добавить ученика в занятие"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="manual-attendance-student">Ученик</Label>
            <Select
              id="manual-attendance-student"
              onChange={(event) => setManualStudentId(event.target.value)}
              value={manualStudentId}
            >
              <option value="">Выберите ученика</option>
              {manualCandidates.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.lastName} {student.firstName}
                </option>
              ))}
            </Select>
            {studentOptions.isLoading ? (
              <p className="text-xs text-muted-foreground">Загружаем учеников…</p>
            ) : manualCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Других доступных учеников в этом филиале нет.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-attendance-status">Результат посещения</Label>
            <Select
              id="manual-attendance-status"
              onChange={(event) =>
                setManualStatus(
                  event.target.value as Extract<
                    AttendanceStatus,
                    'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'
                  >,
                )
              }
              value={manualStatus}
            >
              <option value="PRESENT">Присутствовал</option>
              <option value="LATE">Опоздал</option>
              <option value="ABSENT">Отсутствовал</option>
              <option value="EXCUSED">Болел</option>
            </Select>
          </div>
          {manualSave.isError ? (
            <p className="text-sm text-red-600">Не удалось добавить ученика в занятие.</p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button onClick={() => setManualOpen(false)} variant="outline">
              Отмена
            </Button>
            <Button
              disabled={!manualStudentId || manualSave.isPending}
              onClick={() => manualSave.mutate()}
            >
              {manualSave.isPending ? 'Сохраняем…' : 'Добавить и отметить'}
            </Button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
