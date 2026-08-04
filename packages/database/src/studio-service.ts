import type {
  AttendanceEntryInput,
  AttendanceLessonDetail,
  AttendanceParticipant,
  AuthenticatedUser,
  EnrollmentInput,
  EnrollmentSummary,
  GroupDetail,
  GroupInput,
  GroupListQuery,
  GroupSummary,
  LessonCancelInput,
  LessonGenerateInput,
  LessonGenerationResult,
  LessonInput,
  LessonListQuery,
  LessonSummary,
  StaffOption,
  WeeklyScheduleInput,
  WeeklyScheduleQuery,
  WeeklyScheduleSummary,
} from '@arava/shared';
import { t } from '@arava/shared';
import {
  Prisma,
  type DanceGroup,
  type Enrollment,
  type EnrollmentStatus as PrismaEnrollmentStatus,
  type WeeklySchedule,
} from '@prisma/client';

import type { DatabaseClient } from './index';
import { assertBranchAccess, assertPermission, accessibleBranchIds } from './permissions';
import {
  combineLocalDateAndTime,
  endOfLocalDay,
  isoWeekday,
  scheduleWindowsOverlap,
  startOfLocalDay,
  timeRangesOverlap,
} from './schedule';
import { DomainError } from './security';
import type { ApplicationService } from './services';

const CURRENT_ENROLLMENTS: PrismaEnrollmentStatus[] = ['ACTIVE', 'TRIAL', 'FROZEN'];
const EXPECTED_ENROLLMENTS: PrismaEnrollmentStatus[] = ['ACTIVE', 'TRIAL'];

const groupInclude = {
  _count: {
    select: { enrollments: { where: { leftAt: null, status: { in: CURRENT_ENROLLMENTS } } } },
  },
  assistantCoach: { select: { fullName: true } },
  branch: { select: { name: true } },
  coach: { select: { fullName: true } },
} satisfies Prisma.DanceGroupInclude;

const scheduleInclude = {
  branch: { select: { name: true } },
  coach: { select: { fullName: true } },
  group: { select: { name: true } },
} satisfies Prisma.WeeklyScheduleInclude;

const lessonInclude = {
  _count: { select: { attendance: true } },
  branch: { select: { name: true } },
  coach: { select: { fullName: true } },
  group: {
    select: {
      _count: {
        select: { enrollments: { where: { leftAt: null, status: { in: EXPECTED_ENROLLMENTS } } } },
      },
      assistantCoachId: true,
      coachId: true,
      name: true,
    },
  },
} satisfies Prisma.LessonInclude;

type GroupRecord = Prisma.DanceGroupGetPayload<{ include: typeof groupInclude }>;
type ScheduleRecord = Prisma.WeeklyScheduleGetPayload<{ include: typeof scheduleInclude }>;
type LessonRecord = Prisma.LessonGetPayload<{ include: typeof lessonInclude }>;

function optionalValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : null;
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function groupData(input: GroupInput): Prisma.DanceGroupUncheckedCreateInput {
  return {
    ageFrom: input.ageFrom ?? null,
    ageTo: input.ageTo ?? null,
    assistantCoachId: input.assistantCoachId ?? null,
    branchId: input.branchId,
    capacity: input.capacity,
    coachId: input.coachId ?? null,
    color: optionalValue(input.color),
    description: optionalValue(input.description),
    direction: input.direction.trim(),
    name: input.name.trim(),
    status: input.status,
  };
}

function groupSummary(group: GroupRecord, attendancePercentage = 0): GroupSummary {
  const studentCount = group._count.enrollments;
  return {
    ageFrom: group.ageFrom ?? undefined,
    ageTo: group.ageTo ?? undefined,
    archivedAt: group.archivedAt?.toISOString(),
    assistantCoachId: group.assistantCoachId ?? undefined,
    assistantCoachName: group.assistantCoach?.fullName,
    attendancePercentage,
    availablePlaces: Math.max(0, group.capacity - studentCount),
    branchId: group.branchId,
    branchName: group.branch.name,
    capacity: group.capacity,
    coachId: group.coachId ?? undefined,
    coachName: group.coach?.fullName,
    color: group.color ?? undefined,
    createdAt: group.createdAt.toISOString(),
    description: group.description ?? undefined,
    direction: group.direction,
    id: group.id,
    name: group.name,
    status: group.status,
    studentCount,
    updatedAt: group.updatedAt.toISOString(),
  };
}

function scheduleSummary(schedule: ScheduleRecord): WeeklyScheduleSummary {
  return {
    branchId: schedule.branchId,
    branchName: schedule.branch.name,
    coachId: schedule.coachId ?? undefined,
    coachName: schedule.coach?.fullName,
    createdAt: schedule.createdAt.toISOString(),
    endTime: schedule.endTime,
    groupId: schedule.groupId,
    groupName: schedule.group.name,
    id: schedule.id,
    isActive: schedule.isActive,
    room: schedule.room ?? undefined,
    startTime: schedule.startTime,
    updatedAt: schedule.updatedAt.toISOString(),
    validFrom: schedule.validFrom.toISOString().slice(0, 10),
    validTo: schedule.validTo?.toISOString().slice(0, 10),
    weekday: schedule.weekday,
  };
}

function lessonSummary(lesson: LessonRecord): LessonSummary {
  return {
    attendanceExpected: lesson.group._count.enrollments,
    attendanceMarked: lesson._count.attendance,
    branchId: lesson.branchId,
    branchName: lesson.branch.name,
    cancellationReason: lesson.cancellationReason ?? undefined,
    coachId: lesson.coachId ?? undefined,
    coachName: lesson.coach?.fullName,
    endsAt: lesson.endsAt.toISOString(),
    groupId: lesson.groupId,
    groupName: lesson.group.name,
    id: lesson.id,
    notes: lesson.notes ?? undefined,
    room: lesson.room ?? undefined,
    startsAt: lesson.startsAt.toISOString(),
    status: lesson.status,
  };
}

function enrollmentSummary(
  enrollment: Enrollment & {
    student: {
      firstName: string;
      lastName: string;
      middleName: string | null;
      phone: string | null;
    };
  },
): EnrollmentSummary {
  return {
    id: enrollment.id,
    joinedAt: enrollment.joinedAt.toISOString().slice(0, 10),
    leftAt: enrollment.leftAt?.toISOString().slice(0, 10),
    notes: enrollment.notes ?? undefined,
    status: enrollment.status,
    studentId: enrollment.studentId,
    studentName: [
      enrollment.student.lastName,
      enrollment.student.firstName,
      enrollment.student.middleName,
    ]
      .filter(Boolean)
      .join(' '),
    studentPhone: enrollment.student.phone ?? undefined,
  };
}

export class StudioService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async listStaffOptions(token: string): Promise<StaffOption[]> {
    const actor = await this.application.authenticate(token);
    const branchIds = accessibleBranchIds(actor);
    const users = await this.database.user.findMany({
      orderBy: { fullName: 'asc' },
      select: { fullName: true, id: true, role: true },
      where: {
        isActive: true,
        role: 'COACH',
        ...(branchIds?.length
          ? { branchAssignments: { some: { branchId: { in: branchIds } } } }
          : branchIds
            ? { id: '__none__' }
            : {}),
      },
    });
    return users;
  }

  async listGroups(token: string, query: GroupListQuery): Promise<GroupSummary[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'groups:read');
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const branchIds = accessibleBranchIds(actor);
    const groups = await this.database.danceGroup.findMany({
      include: groupInclude,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      where: {
        ...(query.branchId
          ? { branchId: query.branchId }
          : branchIds
            ? { branchId: { in: branchIds } }
            : {}),
        ...(actor.role === 'COACH'
          ? { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] }
          : {}),
        ...(query.coachId
          ? { OR: [{ coachId: query.coachId }, { assistantCoachId: query.coachId }] }
          : {}),
        ...(query.direction ? { direction: query.direction } : {}),
        ...(query.search ? { name: { contains: query.search.trim() } } : {}),
        ...(query.status ? { status: query.status } : { archivedAt: null }),
      },
    });
    const percentages = await this.groupAttendancePercentages(groups.map(({ id }) => id));
    return groups.map((group) => groupSummary(group, percentages.get(group.id) ?? 0));
  }

  async getGroup(token: string, id: string): Promise<GroupDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'groups:read');
    const group = await this.requireGroup(id);
    this.assertGroupRead(actor, group);
    const [participants, schedules, lessons, percentages] = await Promise.all([
      this.database.enrollment.findMany({
        include: {
          student: { select: { firstName: true, lastName: true, middleName: true, phone: true } },
        },
        orderBy: [{ leftAt: 'asc' }, { student: { lastName: 'asc' } }],
        where: { groupId: id },
      }),
      this.database.weeklySchedule.findMany({
        include: scheduleInclude,
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
        where: { groupId: id, isActive: true },
      }),
      this.database.lesson.findMany({
        include: lessonInclude,
        orderBy: { startsAt: 'asc' },
        take: 12,
        where: { groupId: id, startsAt: { gte: new Date() } },
      }),
      this.groupAttendancePercentages([id]),
    ]);
    return {
      ...groupSummary(group, percentages.get(id) ?? 0),
      participants: participants.map(enrollmentSummary),
      schedules: schedules.map(scheduleSummary),
      upcomingLessons: lessons.map(lessonSummary),
    };
  }

  async createGroup(token: string, input: GroupInput): Promise<GroupSummary> {
    const actor = await this.manageBranch(token, input.branchId, 'groups:manage');
    await this.validateGroupReferences(input);
    const group = await this.database.$transaction(async (transaction) => {
      const created = await transaction.danceGroup.create({
        data: groupData(input),
        include: groupInclude,
      });
      await this.audit(transaction, actor.id, 'GROUP_CREATED', 'DanceGroup', created.id);
      return created;
    });
    return groupSummary(group);
  }

  async updateGroup(token: string, id: string, input: GroupInput): Promise<GroupSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'groups:manage');
    const current = await this.requireGroup(id);
    assertBranchAccess(actor, current.branchId);
    assertBranchAccess(actor, input.branchId);
    await this.validateGroupReferences(input);
    const group = await this.database.$transaction(async (transaction) => {
      const updated = await transaction.danceGroup.update({
        data: groupData(input),
        include: groupInclude,
        where: { id },
      });
      await this.audit(transaction, actor.id, 'GROUP_UPDATED', 'DanceGroup', id);
      return updated;
    });
    return groupSummary(group);
  }

  async archiveGroup(token: string, id: string): Promise<GroupSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'groups:manage');
    const current = await this.requireGroup(id);
    assertBranchAccess(actor, current.branchId);
    const group = await this.database.$transaction(async (transaction) => {
      const archived = await transaction.danceGroup.update({
        data: { archivedAt: new Date(), status: 'ARCHIVED' },
        include: groupInclude,
        where: { id },
      });
      await transaction.weeklySchedule.updateMany({
        data: { isActive: false },
        where: { groupId: id },
      });
      await this.audit(transaction, actor.id, 'GROUP_ARCHIVED', 'DanceGroup', id);
      return archived;
    });
    return groupSummary(group);
  }

  async addEnrollment(
    token: string,
    groupId: string,
    input: EnrollmentInput,
  ): Promise<EnrollmentSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'groups:manage');
    const group = await this.requireGroup(groupId);
    assertBranchAccess(actor, group.branchId);
    const student = await this.database.student.findUnique({ where: { id: input.studentId } });
    if (!student) throw new DomainError('NOT_FOUND', t('domain.notFound.student'));
    if (student.branchId !== group.branchId)
      throw new DomainError('VALIDATION', t('domain.validation.enrollmentBranch'));
    if (student.archivedAt)
      throw new DomainError('VALIDATION', t('domain.validation.studentArchived'));
    const duplicate = await this.database.enrollment.findFirst({
      where: {
        groupId,
        leftAt: null,
        status: { in: CURRENT_ENROLLMENTS },
        studentId: input.studentId,
      },
    });
    if (duplicate) throw new DomainError('CONFLICT', t('domain.conflict.enrollmentDuplicate'));
    const currentCount = await this.database.enrollment.count({
      where: { groupId, leftAt: null, status: { in: CURRENT_ENROLLMENTS } },
    });
    if (currentCount >= group.capacity && !input.overrideCapacity)
      throw new DomainError('CONFLICT', t('domain.conflict.groupCapacity'));
    const enrollment = await this.database.$transaction(async (transaction) => {
      const created = await transaction.enrollment.create({
        data: {
          groupId,
          joinedAt: dateOnly(input.joinedAt),
          notes: optionalValue(input.notes),
          status: input.status,
          studentId: input.studentId,
        },
        include: {
          student: { select: { firstName: true, lastName: true, middleName: true, phone: true } },
        },
      });
      await this.audit(transaction, actor.id, 'ENROLLMENT_ADDED', 'Enrollment', created.id, {
        groupId,
        studentId: input.studentId,
      });
      if (currentCount >= group.capacity)
        await this.audit(transaction, actor.id, 'CAPACITY_OVERRIDDEN', 'DanceGroup', groupId, {
          capacity: group.capacity,
          studentId: input.studentId,
        });
      return created;
    });
    return enrollmentSummary(enrollment);
  }

  async removeEnrollment(token: string, groupId: string, enrollmentId: string): Promise<void> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'groups:manage');
    const group = await this.requireGroup(groupId);
    assertBranchAccess(actor, group.branchId);
    const current = await this.database.enrollment.findFirst({
      where: { groupId, id: enrollmentId },
    });
    if (!current) throw new DomainError('NOT_FOUND', t('domain.notFound.enrollment'));
    await this.database.$transaction(async (transaction) => {
      await transaction.enrollment.update({
        data: { leftAt: new Date(), status: 'LEFT' },
        where: { id: enrollmentId },
      });
      await this.audit(transaction, actor.id, 'ENROLLMENT_LEFT', 'Enrollment', enrollmentId, {
        groupId,
        studentId: current.studentId,
      });
    });
  }

  async listSchedules(token: string, query: WeeklyScheduleQuery): Promise<WeeklyScheduleSummary[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'groups:read');
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const branchIds = accessibleBranchIds(actor);
    const schedules = await this.database.weeklySchedule.findMany({
      include: scheduleInclude,
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
      where: {
        ...(query.branchId
          ? { branchId: query.branchId }
          : branchIds
            ? { branchId: { in: branchIds } }
            : {}),
        ...(actor.role === 'COACH'
          ? {
              OR: [
                { coachId: actor.id },
                { group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] } },
              ],
            }
          : {}),
        ...(query.coachId ? { coachId: query.coachId } : {}),
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(query.includeInactive ? {} : { isActive: true }),
      },
    });
    return schedules.map(scheduleSummary);
  }

  async createSchedule(token: string, input: WeeklyScheduleInput): Promise<WeeklyScheduleSummary> {
    const actor = await this.manageBranch(token, input.branchId, 'schedules:manage');
    await this.validateSchedule(input);
    const schedule = await this.database.weeklySchedule.create({
      data: this.scheduleData(input),
      include: scheduleInclude,
    });
    await this.audit(this.database, actor.id, 'SCHEDULE_CREATED', 'WeeklySchedule', schedule.id);
    return scheduleSummary(schedule);
  }

  async updateSchedule(
    token: string,
    id: string,
    input: WeeklyScheduleInput,
  ): Promise<WeeklyScheduleSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'schedules:manage');
    const current = await this.requireSchedule(id);
    assertBranchAccess(actor, current.branchId);
    assertBranchAccess(actor, input.branchId);
    await this.validateSchedule(input, id);
    const schedule = await this.database.weeklySchedule.update({
      data: this.scheduleData(input),
      include: scheduleInclude,
      where: { id },
    });
    await this.audit(this.database, actor.id, 'SCHEDULE_UPDATED', 'WeeklySchedule', id);
    return scheduleSummary(schedule);
  }

  async deactivateSchedule(token: string, id: string): Promise<WeeklyScheduleSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'schedules:manage');
    const current = await this.requireSchedule(id);
    assertBranchAccess(actor, current.branchId);
    const schedule = await this.database.weeklySchedule.update({
      data: { isActive: false },
      include: scheduleInclude,
      where: { id },
    });
    await this.audit(this.database, actor.id, 'SCHEDULE_DEACTIVATED', 'WeeklySchedule', id);
    return scheduleSummary(schedule);
  }

  async listLessons(token: string, query: LessonListQuery): Promise<LessonSummary[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'lessons:read');
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const branchIds = accessibleBranchIds(actor);
    const lessons = await this.database.lesson.findMany({
      include: lessonInclude,
      orderBy: { startsAt: 'asc' },
      where: {
        startsAt: { gte: new Date(query.dateFrom), lte: new Date(query.dateTo) },
        ...(query.branchId
          ? { branchId: query.branchId }
          : branchIds
            ? { branchId: { in: branchIds } }
            : {}),
        ...(actor.role === 'COACH'
          ? {
              OR: [
                { coachId: actor.id },
                { group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] } },
              ],
            }
          : {}),
        ...(query.coachId ? { coachId: query.coachId } : {}),
        ...(query.groupId ? { groupId: query.groupId } : {}),
      },
    });
    return lessons.map(lessonSummary);
  }

  async getLesson(token: string, id: string): Promise<LessonSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'lessons:read');
    const lesson = await this.requireLesson(id);
    this.assertLessonRead(actor, lesson);
    return lessonSummary(lesson);
  }

  async createLesson(token: string, input: LessonInput): Promise<LessonSummary> {
    const group = await this.requireGroup(input.groupId);
    const actor = await this.manageBranch(token, group.branchId, 'lessons:manage');
    if (group.archivedAt) throw new DomainError('VALIDATION', t('domain.validation.groupArchived'));
    await this.validateCoachForBranch(input.coachId, group.branchId);
    await this.assertLessonNoConflict(input, group.branchId);
    try {
      const lesson = await this.database.lesson.create({
        data: this.lessonData(input, group.branchId),
        include: lessonInclude,
      });
      await this.audit(this.database, actor.id, 'LESSON_CREATED', 'Lesson', lesson.id);
      return lessonSummary(lesson);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new DomainError('CONFLICT', t('domain.conflict.lessonDuplicate'));
      throw error;
    }
  }

  async updateLesson(token: string, id: string, input: LessonInput): Promise<LessonSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'lessons:manage');
    const current = await this.requireLesson(id);
    assertBranchAccess(actor, current.branchId);
    const group = await this.requireGroup(input.groupId);
    assertBranchAccess(actor, group.branchId);
    if (group.archivedAt) throw new DomainError('VALIDATION', t('domain.validation.groupArchived'));
    await this.validateCoachForBranch(input.coachId, group.branchId);
    await this.assertLessonNoConflict(input, group.branchId, id);
    const moved =
      current.startsAt.toISOString() !== new Date(input.startsAt).toISOString() ||
      current.endsAt.toISOString() !== new Date(input.endsAt).toISOString();
    const lesson = await this.database.$transaction(async (transaction) => {
      const updated = await transaction.lesson.update({
        data: this.lessonData(input, group.branchId),
        include: lessonInclude,
        where: { id },
      });
      await this.audit(
        transaction,
        actor.id,
        moved ? 'LESSON_MOVED' : 'LESSON_UPDATED',
        'Lesson',
        id,
      );
      return updated;
    });
    return lessonSummary(lesson);
  }

  async cancelLesson(token: string, id: string, input: LessonCancelInput): Promise<LessonSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'lessons:manage');
    const current = await this.requireLesson(id);
    assertBranchAccess(actor, current.branchId);
    const lesson = await this.database.$transaction(async (transaction) => {
      const cancelled = await transaction.lesson.update({
        data: { cancellationReason: input.cancellationReason.trim(), status: 'CANCELLED' },
        include: lessonInclude,
        where: { id },
      });
      await this.audit(transaction, actor.id, 'LESSON_CANCELLED', 'Lesson', id, {
        reason: input.cancellationReason,
      });
      return cancelled;
    });
    return lessonSummary(lesson);
  }

  async generateLessons(
    token: string,
    input: LessonGenerateInput,
  ): Promise<LessonGenerationResult> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'lessons:manage');
    const from = startOfLocalDay(input.dateFrom);
    const to = endOfLocalDay(input.dateTo);
    if (to.getTime() - from.getTime() > 366 * 86_400_000)
      throw new DomainError('VALIDATION', t('domain.validation.generationRange'));
    const branchIds = accessibleBranchIds(actor);
    const schedules = await this.database.weeklySchedule.findMany({
      where: { isActive: true, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
    });
    let created = 0;
    let skipped = 0;
    for (const schedule of schedules) {
      for (const day = new Date(from); day <= to; day.setDate(day.getDate() + 1)) {
        if (isoWeekday(day) !== schedule.weekday) continue;
        const startsAt = combineLocalDateAndTime(day, schedule.startTime);
        if (
          startsAt < schedule.validFrom ||
          (schedule.validTo && startsAt > endOfLocalDay(schedule.validTo))
        )
          continue;
        const exists = await this.database.lesson.findUnique({
          where: { groupId_startsAt: { groupId: schedule.groupId, startsAt } },
        });
        if (exists) {
          skipped += 1;
          continue;
        }
        await this.database.lesson.create({
          data: {
            branchId: schedule.branchId,
            coachId: schedule.coachId,
            endsAt: combineLocalDateAndTime(day, schedule.endTime),
            groupId: schedule.groupId,
            room: schedule.room,
            scheduleTemplateId: schedule.id,
            startsAt,
          },
        });
        created += 1;
      }
    }
    await this.audit(this.database, actor.id, 'LESSONS_GENERATED', 'Lesson', 'range', {
      created,
      from: input.dateFrom,
      skipped,
      to: input.dateTo,
    });
    return { created, skipped };
  }

  async getAttendance(token: string, lessonId: string): Promise<AttendanceLessonDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'lessons:read');
    const lesson = await this.requireLesson(lessonId);
    this.assertLessonRead(actor, lesson);
    const [enrollments, marks] = await Promise.all([
      this.database.enrollment.findMany({
        include: { student: { select: { firstName: true, lastName: true, middleName: true } } },
        orderBy: { student: { lastName: 'asc' } },
        where: {
          groupId: lesson.groupId,
          joinedAt: { lte: lesson.startsAt },
          OR: [{ leftAt: null }, { leftAt: { gte: lesson.startsAt } }],
          status: { in: EXPECTED_ENROLLMENTS },
        },
      }),
      this.database.attendance.findMany({ where: { lessonId } }),
    ]);
    const markByStudent = new Map(marks.map((mark) => [mark.studentId, mark]));
    const participants: AttendanceParticipant[] = enrollments.map(({ student, studentId }) => {
      const mark = markByStudent.get(studentId);
      return {
        comment: mark?.comment ?? undefined,
        markedAt: mark?.markedAt.toISOString(),
        status: mark?.status,
        studentId,
        studentName: [student.lastName, student.firstName, student.middleName]
          .filter(Boolean)
          .join(' '),
      };
    });
    return { lesson: lessonSummary(lesson), participants };
  }

  async saveAttendance(
    token: string,
    lessonId: string,
    entries: AttendanceEntryInput[],
  ): Promise<AttendanceLessonDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'attendance:manage');
    const lesson = await this.requireLesson(lessonId);
    this.assertLessonRead(actor, lesson);
    const allowedStudents = new Set(
      (await this.getAttendance(token, lessonId)).participants.map(({ studentId }) => studentId),
    );
    if (new Set(entries.map(({ studentId }) => studentId)).size !== entries.length)
      throw new DomainError('VALIDATION', t('domain.validation.attendanceUnique'));
    if (entries.some(({ studentId }) => !allowedStudents.has(studentId)))
      throw new DomainError('AUTHORIZATION', t('domain.authorization.attendanceStudent'));
    await this.database.$transaction(async (transaction) => {
      for (const entry of entries) {
        const previous = await transaction.attendance.findUnique({
          where: { lessonId_studentId: { lessonId, studentId: entry.studentId } },
        });
        if (previous && previous.status !== entry.status && actor.role === 'COACH')
          throw new DomainError('AUTHORIZATION', t('domain.authorization.attendanceCorrection'));
        await transaction.attendance.upsert({
          create: {
            comment: optionalValue(entry.comment),
            lessonId,
            markedAt: new Date(),
            markedByUserId: actor.id,
            status: entry.status,
            studentId: entry.studentId,
          },
          update: {
            comment: optionalValue(entry.comment),
            markedAt: new Date(),
            markedByUserId: actor.id,
            status: entry.status,
          },
          where: { lessonId_studentId: { lessonId, studentId: entry.studentId } },
        });
        if (previous && previous.status !== entry.status)
          await this.audit(
            transaction,
            actor.id,
            'ATTENDANCE_CORRECTED',
            'Attendance',
            `${lessonId}:${entry.studentId}`,
            { from: previous.status, to: entry.status },
          );
      }
    });
    return this.getAttendance(token, lessonId);
  }

  private async manageBranch(
    token: string,
    branchId: string,
    action: 'groups:manage' | 'lessons:manage' | 'schedules:manage',
  ): Promise<AuthenticatedUser> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, action);
    assertBranchAccess(actor, branchId);
    const branch = await this.database.branch.findUnique({ where: { id: branchId } });
    if (!branch?.isActive)
      throw new DomainError('VALIDATION', t('domain.validation.branchArchived'));
    return actor;
  }

  private async requireGroup(id: string): Promise<GroupRecord> {
    const group = await this.database.danceGroup.findUnique({
      include: groupInclude,
      where: { id },
    });
    if (!group) throw new DomainError('NOT_FOUND', t('domain.notFound.group'));
    return group;
  }

  private async requireSchedule(id: string): Promise<WeeklySchedule> {
    const schedule = await this.database.weeklySchedule.findUnique({ where: { id } });
    if (!schedule) throw new DomainError('NOT_FOUND', t('domain.notFound.schedule'));
    return schedule;
  }

  private async requireLesson(id: string): Promise<LessonRecord> {
    const lesson = await this.database.lesson.findUnique({ include: lessonInclude, where: { id } });
    if (!lesson) throw new DomainError('NOT_FOUND', t('domain.notFound.lesson'));
    return lesson;
  }

  private assertGroupRead(actor: AuthenticatedUser, group: DanceGroup): void {
    assertBranchAccess(actor, group.branchId);
    if (actor.role === 'COACH' && group.coachId !== actor.id && group.assistantCoachId !== actor.id)
      throw new DomainError('AUTHORIZATION', t('domain.authorization.groupCoach'));
  }

  private assertLessonRead(actor: AuthenticatedUser, lesson: LessonRecord): void {
    assertBranchAccess(actor, lesson.branchId);
    if (
      actor.role === 'COACH' &&
      lesson.coachId !== actor.id &&
      lesson.group.coachId !== actor.id &&
      lesson.group.assistantCoachId !== actor.id
    )
      throw new DomainError('AUTHORIZATION', t('domain.authorization.lessonCoach'));
  }

  private async validateGroupReferences(input: GroupInput): Promise<void> {
    const branch = await this.database.branch.findUnique({ where: { id: input.branchId } });
    if (!branch?.isActive)
      throw new DomainError('VALIDATION', t('domain.validation.branchArchived'));
    const ids = [input.coachId, input.assistantCoachId].filter((id): id is string => Boolean(id));
    if (!ids.length) return;
    await Promise.all(ids.map((id) => this.validateCoachForBranch(id, input.branchId)));
  }

  private scheduleData(input: WeeklyScheduleInput): Prisma.WeeklyScheduleUncheckedCreateInput {
    return {
      branchId: input.branchId,
      coachId: input.coachId ?? null,
      endTime: input.endTime,
      groupId: input.groupId,
      isActive: input.isActive,
      room: optionalValue(input.room),
      startTime: input.startTime,
      validFrom: dateOnly(input.validFrom),
      validTo: input.validTo ? dateOnly(input.validTo) : null,
      weekday: input.weekday,
    };
  }

  private async validateSchedule(input: WeeklyScheduleInput, excludeId?: string): Promise<void> {
    const group = await this.requireGroup(input.groupId);
    if (group.branchId !== input.branchId)
      throw new DomainError('VALIDATION', t('domain.validation.scheduleBranch'));
    if (group.archivedAt) throw new DomainError('VALIDATION', t('domain.validation.groupArchived'));
    await this.validateCoachForBranch(input.coachId, input.branchId);
    const candidate = {
      endTime: input.endTime,
      startTime: input.startTime,
      validFrom: dateOnly(input.validFrom),
      validTo: input.validTo ? dateOnly(input.validTo) : null,
      weekday: input.weekday,
    };
    const possible = await this.database.weeklySchedule.findMany({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        isActive: true,
        weekday: input.weekday,
        OR: [
          ...(input.coachId ? [{ coachId: input.coachId }] : []),
          ...(input.room ? [{ branchId: input.branchId, room: input.room.trim() }] : []),
        ],
      },
    });
    const conflict = possible.find((schedule) => scheduleWindowsOverlap(candidate, schedule));
    if (conflict) {
      const resource =
        input.coachId && conflict.coachId === input.coachId
          ? t('schedule.conflict.coach')
          : t('schedule.conflict.room');
      throw new DomainError('CONFLICT', t('domain.conflict.schedule', { resource }));
    }
  }

  private lessonData(input: LessonInput, branchId: string): Prisma.LessonUncheckedCreateInput {
    return {
      branchId,
      coachId: input.coachId ?? null,
      endsAt: new Date(input.endsAt),
      groupId: input.groupId,
      notes: optionalValue(input.notes),
      room: optionalValue(input.room),
      startsAt: new Date(input.startsAt),
    };
  }

  private async assertLessonNoConflict(
    input: LessonInput,
    branchId: string,
    excludeId?: string,
  ): Promise<void> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const possible = await this.database.lesson.findMany({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        status: { not: 'CANCELLED' },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        OR: [
          ...(input.coachId ? [{ coachId: input.coachId }] : []),
          ...(input.room ? [{ branchId, room: input.room.trim() }] : []),
        ],
      },
    });
    if (
      possible.some((lesson) =>
        timeRangesOverlap(
          startsAt.toISOString(),
          endsAt.toISOString(),
          lesson.startsAt.toISOString(),
          lesson.endsAt.toISOString(),
        ),
      )
    )
      throw new DomainError('CONFLICT', t('domain.conflict.lessonResource'));
  }

  private async groupAttendancePercentages(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.database.$queryRaw<
      { groupId: string; present: bigint; total: bigint }[]
    >`
      SELECT "Lesson"."groupId" AS "groupId",
        SUM(CASE WHEN "Attendance"."status" IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) AS "present",
        COUNT(*) AS "total"
      FROM "Attendance" INNER JOIN "Lesson" ON "Lesson"."id" = "Attendance"."lessonId"
      WHERE "Lesson"."groupId" IN (${Prisma.join(ids)})
      GROUP BY "Lesson"."groupId"`;
    return new Map(
      rows.map((row) => [
        row.groupId,
        Number(row.total) ? Math.round((Number(row.present) / Number(row.total)) * 100) : 0,
      ]),
    );
  }

  private async validateCoachForBranch(
    coachId: string | undefined,
    branchId: string,
  ): Promise<void> {
    if (!coachId) return;
    const coach = await this.database.user.findFirst({
      where: {
        branchAssignments: { some: { branchId } },
        id: coachId,
        isActive: true,
        role: 'COACH',
      },
    });
    if (!coach) throw new DomainError('VALIDATION', t('domain.validation.coachBranch'));
  }

  private async audit(
    client: DatabaseClient | Prisma.TransactionClient,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        action,
        actorUserId,
        detail: detail ? JSON.stringify(detail) : null,
        entityId,
        entityType,
      },
    });
  }
}
