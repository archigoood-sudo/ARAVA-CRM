import type {
  AttendanceScanConfirmationInput,
  AttendanceScanLessonOption,
  AttendanceScanOptions,
  AttendanceOccurrenceInput,
  AttendanceWorkspaceDay,
  AttendanceWorkspaceLesson,
  AuthenticatedUser,
  LessonSummary,
} from '@arava/shared';
import type { EnrollmentStatus, Prisma, StudentStatus } from '@prisma/client';

import type { DatabaseClient } from './index';
import { assertBranchAccess, assertPermission } from './permissions';
import { startOfLocalDay } from './schedule';
import { DomainError } from './security';
import type { ApplicationService } from './services';
import { LessonOccurrenceService } from './lesson-occurrence-service';
import { StudioService } from './studio-service';

const currentEnrollmentStatuses: EnrollmentStatus[] = ['ACTIVE', 'TRIAL'];
const currentStudentStatuses: StudentStatus[] = ['ACTIVE', 'TRIAL', 'FROZEN'];

const workspaceLessonInclude = {
  attendance: { select: { status: true, studentId: true } },
  branch: { select: { name: true } },
  coach: { select: { fullName: true } },
  group: {
    select: {
      coach: { select: { fullName: true } },
      direction: true,
      id: true,
      name: true,
    },
  },
  roomEntity: { select: { name: true } },
  substitution: { include: { substituteTrainer: { select: { fullName: true } } } },
} satisfies Prisma.LessonInclude;

type WorkspaceLessonRecord = Prisma.LessonGetPayload<{ include: typeof workspaceLessonInclude }>;

const workspaceScheduleInclude = {
  branch: { select: { name: true } },
  coach: { select: { fullName: true } },
  group: {
    select: {
      coach: { select: { fullName: true } },
      direction: true,
      id: true,
      name: true,
    },
  },
  roomEntity: { select: { name: true } },
} satisfies Prisma.WeeklyScheduleInclude;

type WorkspaceScheduleRecord = Prisma.WeeklyScheduleGetPayload<{
  include: typeof workspaceScheduleInclude;
}>;

function membershipValidAt(
  enrollment: {
    joinedAt: Date;
    leftAt: Date | null;
    status: EnrollmentStatus;
    student: { archivedAt: Date | null; status: StudentStatus };
  },
  at: Date,
): boolean {
  if (enrollment.joinedAt > at) return false;
  if (enrollment.leftAt) return enrollment.leftAt >= at;
  return (
    currentEnrollmentStatuses.includes(enrollment.status) &&
    currentStudentStatuses.includes(enrollment.student.status) &&
    !enrollment.student.archivedAt
  );
}

function effectiveTrainerName(lesson: WorkspaceLessonRecord): string | undefined {
  return (
    lesson.substitution?.substituteTrainer.fullName ??
    lesson.coach?.fullName ??
    lesson.group.coach?.fullName
  );
}

function localDateKey(value: Date): string {
  return [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

export function rankAttendanceOptions(
  options: AttendanceScanLessonOption[],
  now: Date,
): AttendanceScanLessonOption[] {
  const category = (option: AttendanceScanLessonOption): number => {
    const startsAt = new Date(option.startsAt).getTime();
    const endsAt = new Date(option.endsAt).getTime();
    const current = now.getTime();
    if (startsAt <= current && current < endsAt) return 0;
    if (startsAt > current) return 1;
    return 2;
  };
  return [...options].sort((left, right) => {
    const categoryDifference = category(left) - category(right);
    if (categoryDifference) return categoryDifference;
    const leftStart = new Date(left.startsAt).getTime();
    const rightStart = new Date(right.startsAt).getTime();
    return category(left) === 2 ? rightStart - leftStart : leftStart - rightStart;
  });
}

export class AttendanceWorkspaceService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
    private readonly now: () => Date = () => new Date(),
    private readonly studio: StudioService = new StudioService(database, application),
  ) {}

  async today(token: string, date: string): Promise<AttendanceWorkspaceDay> {
    const actor = await this.workspaceActor(token);
    const from = startOfLocalDay(date);
    const occurrences = await new LessonOccurrenceService(this.database).resolveDay(actor, from);
    const lessonIds = occurrences.flatMap(({ lessonId }) => (lessonId ? [lessonId] : []));
    const scheduleIds = occurrences.flatMap(({ scheduleTemplateId, source }) =>
      source === 'WEEKLY_SCHEDULE' && scheduleTemplateId ? [scheduleTemplateId] : [],
    );
    const [lessons, schedules] = await Promise.all([
      lessonIds.length
        ? this.database.lesson.findMany({
            include: workspaceLessonInclude,
            where: { id: { in: lessonIds } },
          })
        : Promise.resolve([] as WorkspaceLessonRecord[]),
      scheduleIds.length
        ? this.database.weeklySchedule.findMany({
            include: workspaceScheduleInclude,
            where: { id: { in: scheduleIds } },
          })
        : Promise.resolve([] as WorkspaceScheduleRecord[]),
    ]);
    const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
    const summaries = occurrences.flatMap((occurrence): AttendanceWorkspaceLesson[] => {
      const lesson = occurrence.lessonId ? lessonById.get(occurrence.lessonId) : undefined;
      const schedule = occurrence.scheduleTemplateId
        ? scheduleById.get(occurrence.scheduleTemplateId)
        : undefined;
      const metadata = lesson
        ? {
            branchName: lesson.branch.name,
            direction: lesson.group.direction,
            effectiveTrainerName: effectiveTrainerName(lesson),
            groupName: lesson.group.name,
            replacement: Boolean(lesson.substitution),
            roomId: lesson.roomId ?? undefined,
            roomName: lesson.roomEntity?.name ?? lesson.room ?? undefined,
          }
        : schedule
          ? {
              branchName: schedule.branch.name,
              direction: schedule.group.direction,
              effectiveTrainerName: schedule.coach?.fullName ?? schedule.group.coach?.fullName,
              groupName: schedule.group.name,
              replacement: false,
              roomId: schedule.roomId ?? undefined,
              roomName: schedule.roomEntity?.name ?? schedule.room ?? undefined,
            }
          : undefined;
      if (!metadata) return [];
      return [
        {
          ...(lesson?.attendanceCompletedAt
            ? { attendanceCompletedAt: lesson.attendanceCompletedAt.toISOString() }
            : {}),
          attendanceExpected: occurrence.expectedStudents,
          attendanceMarked: occurrence.attendanceMarked,
          attendancePresent:
            lesson?.attendance.filter(({ status }) => status === 'PRESENT').length ?? 0,
          branchId: occurrence.branchId,
          ...metadata,
          endsAt: occurrence.endsAt.toISOString(),
          groupId: occurrence.groupId,
          id:
            occurrence.lessonId ??
            `occurrence:${occurrence.groupId}:${String(occurrence.startsAt.getTime())}`,
          ...(occurrence.lessonId ? { lessonId: occurrence.lessonId } : {}),
          source: occurrence.source,
          startsAt: occurrence.startsAt.toISOString(),
          status: lesson?.status ?? 'PLANNED',
        },
      ];
    });
    return { date, lessons: summaries };
  }

  async openOccurrence(token: string, input: AttendanceOccurrenceInput): Promise<LessonSummary> {
    await this.workspaceActor(token);
    return this.studio.materializeLessonOccurrence(token, input);
  }

  async confirmScan(
    token: string,
    input: AttendanceScanConfirmationInput,
  ): Promise<Awaited<ReturnType<StudioService['confirmScannedAttendance']>>> {
    const startsAt = new Date(input.startsAt);
    const available = await this.scanOptions(token, input.studentId, localDateKey(startsAt));
    const selected = available.lessons.find(
      (option) =>
        option.groupId === input.groupId &&
        new Date(option.startsAt).getTime() === startsAt.getTime() &&
        (!input.lessonId || option.lessonId === input.lessonId),
    );
    if (!selected)
      throw new DomainError(
        'VALIDATION',
        'Выбранное занятие недоступно для отметки. Обновите список и попробуйте ещё раз.',
      );
    const lessonId =
      selected.lessonId ??
      (
        await this.studio.materializeLessonOccurrence(token, {
          groupId: selected.groupId,
          startsAt: selected.startsAt,
        })
      ).id;
    return this.studio.confirmScannedAttendance(token, lessonId, input.studentId);
  }

  async scanOptions(
    token: string,
    studentId: string,
    date: string,
  ): Promise<AttendanceScanOptions> {
    const actor = await this.workspaceActor(token);
    const student = await this.database.student.findUnique({ where: { id: studentId } });
    if (!student) throw new DomainError('NOT_FOUND', 'Ученик не найден.');
    assertBranchAccess(actor, student.branchId);
    const from = startOfLocalDay(date);
    const occurrences = (
      await new LessonOccurrenceService(this.database).resolveDay(actor, from)
    ).filter(({ branchId }) => branchId === student.branchId);
    const lessonIds = occurrences.flatMap(({ lessonId }) => (lessonId ? [lessonId] : []));
    const scheduleIds = occurrences.flatMap(({ scheduleTemplateId }) =>
      scheduleTemplateId ? [scheduleTemplateId] : [],
    );
    const [lessons, schedules] = await Promise.all([
      lessonIds.length
        ? this.database.lesson.findMany({
            include: workspaceLessonInclude,
            where: { id: { in: lessonIds } },
          })
        : Promise.resolve([] as WorkspaceLessonRecord[]),
      scheduleIds.length
        ? this.database.weeklySchedule.findMany({
            include: workspaceScheduleInclude,
            where: { id: { in: scheduleIds } },
          })
        : Promise.resolve([] as WorkspaceScheduleRecord[]),
    ]);
    const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
    const enrollments = await this.database.enrollment.findMany({
      include: { student: { select: { archivedAt: true, status: true } } },
      where: {
        groupId: { in: [...new Set(occurrences.map(({ groupId }) => groupId))] },
        studentId,
      },
    });
    const enrollmentByGroup = new Map(
      enrollments.map((enrollment) => [enrollment.groupId, enrollment]),
    );
    const options = occurrences.flatMap((occurrence): AttendanceScanLessonOption[] => {
      const lesson = occurrence.lessonId ? lessonById.get(occurrence.lessonId) : undefined;
      const schedule = occurrence.scheduleTemplateId
        ? scheduleById.get(occurrence.scheduleTemplateId)
        : undefined;
      const current = lesson?.attendance.find((attendance) => attendance.studentId === studentId);
      const enrollment = enrollmentByGroup.get(occurrence.groupId);
      if (!current && (!enrollment || !membershipValidAt(enrollment, occurrence.startsAt)))
        return [];
      const metadata = lesson
        ? {
            branchName: lesson.branch.name,
            effectiveTrainerName: effectiveTrainerName(lesson),
            groupName: lesson.group.name,
            roomName: lesson.roomEntity?.name ?? lesson.room ?? undefined,
          }
        : schedule
          ? {
              branchName: schedule.branch.name,
              effectiveTrainerName: schedule.coach?.fullName ?? schedule.group.coach?.fullName,
              groupName: schedule.group.name,
              roomName: schedule.roomEntity?.name ?? schedule.room ?? undefined,
            }
          : undefined;
      if (!metadata) return [];
      return [
        {
          ...metadata,
          ...(current ? { currentStatus: current.status } : {}),
          endsAt: occurrence.endsAt.toISOString(),
          groupId: occurrence.groupId,
          id:
            occurrence.lessonId ??
            `occurrence:${occurrence.groupId}:${String(occurrence.startsAt.getTime())}`,
          ...(occurrence.lessonId ? { lessonId: occurrence.lessonId } : {}),
          source: occurrence.source,
          startsAt: occurrence.startsAt.toISOString(),
        },
      ];
    });
    return {
      lessons: rankAttendanceOptions(options, this.now()),
      studentId,
      studentName: [student.firstName, student.lastName].filter(Boolean).join(' '),
    };
  }

  private async workspaceActor(token: string): Promise<AuthenticatedUser> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'attendance:manage');
    if (actor.role === 'COACH')
      throw new DomainError(
        'AUTHORIZATION',
        'Рабочее место «Посещения» доступно владельцу и администраторам.',
      );
    return actor;
  }
}
