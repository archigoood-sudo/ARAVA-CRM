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
  GroupMembershipGroupOption,
  GroupMembershipStudentOption,
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
import { permissionsForRole, t } from '@arava/shared';
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
  endOfLocalDay,
  isoWeekday,
  scheduleOccurrenceForLocalDate,
  scheduleWindowsOverlap,
  startOfLocalDay,
} from './schedule';
import { DomainError } from './security';
import type { ApplicationService } from './services';
import { CalendarService } from './calendar-service';
import { LessonOccurrenceService } from './lesson-occurrence-service';
import {
  applyAttendanceWriteOff,
  reverseAttendanceWriteOffs,
  reverseLessonWriteOffs,
} from './subscription-ledger';

const CURRENT_ENROLLMENTS: PrismaEnrollmentStatus[] = ['ACTIVE', 'TRIAL', 'FROZEN'];
const EXPECTED_ENROLLMENTS: PrismaEnrollmentStatus[] = ['ACTIVE', 'TRIAL'];
const MANUAL_ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED'] as const;

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
  roomEntity: { select: { name: true } },
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
  roomEntity: { select: { name: true } },
  substitution: {
    include: {
      originalTrainer: { select: { fullName: true } },
      substituteTrainer: { select: { fullName: true } },
    },
  },
} satisfies Prisma.LessonInclude;

type GroupRecord = Prisma.DanceGroupGetPayload<{ include: typeof groupInclude }>;
type ScheduleRecord = Prisma.WeeklyScheduleGetPayload<{ include: typeof scheduleInclude }>;
type LessonRecord = Prisma.LessonGetPayload<{ include: typeof lessonInclude }>;
interface AttendanceEnrollment {
  joinedAt: Date;
  leftAt: Date | null;
  status: PrismaEnrollmentStatus;
  student: { archivedAt: Date | null; status: string };
}

function attendanceEnrollmentScope(
  enrollment: AttendanceEnrollment,
  lessonStartsAt: Date,
): 'HISTORICAL' | 'CURRENT_LATER' | undefined {
  if (
    enrollment.joinedAt <= lessonStartsAt &&
    (!enrollment.leftAt || enrollment.leftAt >= lessonStartsAt)
  )
    return 'HISTORICAL';
  if (
    enrollment.joinedAt > lessonStartsAt &&
    !enrollment.leftAt &&
    EXPECTED_ENROLLMENTS.includes(enrollment.status) &&
    ['ACTIVE', 'TRIAL', 'FROZEN'].includes(enrollment.student.status) &&
    !enrollment.student.archivedAt
  )
    return 'CURRENT_LATER';
  return undefined;
}

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
    room: schedule.roomEntity?.name ?? schedule.room ?? undefined,
    roomId: schedule.roomId ?? undefined,
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
    roomId: lesson.roomId ?? undefined,
    roomName: lesson.roomEntity?.name,
    originalCoachId: lesson.substitution?.originalTrainerId ?? undefined,
    originalCoachName: lesson.substitution?.originalTrainer?.fullName,
    substituteCoachId: lesson.substitution?.substituteTrainerId,
    substituteCoachName: lesson.substitution?.substituteTrainer.fullName,
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
  private readonly calendar: CalendarService;

  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {
    this.calendar = new CalendarService(database, application);
  }

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

  async listEligibleGroupsForStudent(
    token: string,
    studentId: string,
  ): Promise<GroupMembershipGroupOption[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'groups:manage');
    const student = await this.database.student.findUnique({ where: { id: studentId } });
    if (!student) throw new DomainError('NOT_FOUND', t('domain.notFound.student'));
    assertBranchAccess(actor, student.branchId);
    if (student.archivedAt || student.status === 'ARCHIVED')
      throw new DomainError('VALIDATION', t('domain.validation.studentArchived'));
    const groups = await this.database.danceGroup.findMany({
      include: groupInclude,
      orderBy: { name: 'asc' },
      where: {
        archivedAt: null,
        branchId: student.branchId,
        enrollments: {
          none: {
            leftAt: null,
            status: { in: CURRENT_ENROLLMENTS },
            studentId,
          },
        },
        status: { in: ['ACTIVE', 'RECRUITING'] },
      },
    });
    return groups.map((group) => ({
      availablePlaces: Math.max(0, group.capacity - group._count.enrollments),
      branchId: group.branchId,
      id: group.id,
      name: group.name,
      status: group.status,
    }));
  }

  async listEligibleStudentsForGroup(
    token: string,
    groupId: string,
  ): Promise<GroupMembershipStudentOption[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'groups:manage');
    const group = await this.requireGroup(groupId);
    assertBranchAccess(actor, group.branchId);
    const students = await this.database.student.findMany({
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      where: {
        archivedAt: null,
        branchId: group.branchId,
        enrollments: {
          none: {
            groupId,
            leftAt: null,
            status: { in: CURRENT_ENROLLMENTS },
          },
        },
        status: { not: 'ARCHIVED' },
      },
    });
    return students.map(({ firstName, id, lastName, middleName, status }) => ({
      firstName,
      id,
      lastName,
      middleName: middleName ?? undefined,
      status,
    }));
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
        ...(query.roomId ? { roomId: query.roomId } : {}),
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
        ...(query.roomId ? { roomId: query.roomId } : {}),
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
    await this.validateRoomForBranch(input.roomId, group.branchId);
    await this.assertLessonNoConflict(input);
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
    await this.validateRoomForBranch(input.roomId, group.branchId);
    await this.assertLessonNoConflict(input, id);
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
      const directPayments = await transaction.attendance.count({
        where: {
          lessonId: id,
          OR: [{ directPaymentId: { not: null } }, { directPaymentOperationId: { not: null } }],
        },
      });
      if (directPayments > 0)
        throw new DomainError(
          'CONFLICT',
          'Сначала отмените или завершите разовые оплаты посещений этого занятия.',
        );
      const reversedWriteOffs = await reverseLessonWriteOffs(transaction, id, actor.id);
      const cancelled = await transaction.lesson.update({
        data: { cancellationReason: input.cancellationReason.trim(), status: 'CANCELLED' },
        include: lessonInclude,
        where: { id },
      });
      await this.audit(transaction, actor.id, 'LESSON_CANCELLED', 'Lesson', id, {
        reason: input.cancellationReason,
        reversedWriteOffs,
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
        const occurrence = scheduleOccurrenceForLocalDate(schedule, day);
        if (!occurrence) continue;
        const { endsAt, startsAt } = occurrence;
        const exception = await this.database.calendarException.findFirst({
          where: {
            OR: [{ branchId: null }, { branchId: schedule.branchId }],
            startAt: { lte: startsAt },
            endAt: { gt: startsAt },
          },
        });
        if (exception) {
          skipped += 1;
          continue;
        }
        try {
          const result = await this.materializeScheduleOccurrence(schedule, startsAt, endsAt);
          if (result.created) created += 1;
          else skipped += 1;
        } catch (error) {
          if (error instanceof DomainError && error.code === 'CONFLICT') {
            skipped += 1;
            continue;
          }
          throw error;
        }
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

  async materializeLessonOccurrence(
    token: string,
    input: { groupId: string; startsAt: string },
  ): Promise<LessonSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'lessons:manage');
    const startsAt = new Date(input.startsAt);
    const occurrence = (
      await new LessonOccurrenceService(this.database).resolveDay(actor, startsAt)
    ).find(
      (candidate) =>
        candidate.groupId === input.groupId && candidate.startsAt.getTime() === startsAt.getTime(),
    );
    if (!occurrence)
      throw new DomainError(
        'VALIDATION',
        'Выбранное занятие больше недоступно. Обновите список и выберите другое.',
      );
    if (occurrence.lessonId) return this.getLesson(token, occurrence.lessonId);
    if (!occurrence.scheduleTemplateId)
      throw new DomainError('VALIDATION', 'Не удалось определить шаблон выбранного занятия.');
    const schedule = await this.database.weeklySchedule.findUnique({
      where: { id: occurrence.scheduleTemplateId },
    });
    if (!schedule?.isActive)
      throw new DomainError(
        'VALIDATION',
        'Расписание изменилось. Обновите список и выберите занятие повторно.',
      );
    const result = await this.materializeScheduleOccurrence(
      schedule,
      occurrence.startsAt,
      occurrence.endsAt,
    );
    if (result.lesson.status === 'CANCELLED')
      throw new DomainError('VALIDATION', 'Нельзя записать на отменённое занятие.');
    if (result.created)
      await this.audit(
        this.database,
        actor.id,
        'LESSON_MATERIALIZED_FOR_TRIAL',
        'Lesson',
        result.lesson.id,
        {
          scheduleTemplateId: schedule.id,
        },
      );
    return lessonSummary(result.lesson);
  }

  async getAttendance(token: string, lessonId: string): Promise<AttendanceLessonDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'lessons:read');
    const lesson = await this.requireLesson(lessonId);
    this.assertLessonRead(actor, lesson);
    if (lesson.status === 'CANCELLED')
      throw new DomainError('VALIDATION', t('domain.validation.attendanceCancelled'));
    const [enrollments, marks] = await Promise.all([
      this.database.enrollment.findMany({
        include: {
          student: {
            select: {
              archivedAt: true,
              firstName: true,
              lastName: true,
              middleName: true,
              status: true,
            },
          },
        },
        orderBy: { student: { lastName: 'asc' } },
        where: { groupId: lesson.groupId },
      }),
      this.database.attendance.findMany({
        include: {
          student: { select: { firstName: true, lastName: true, middleName: true } },
        },
        where: { lessonId },
      }),
    ]);
    const markByStudent = new Map(marks.map((mark) => [mark.studentId, mark]));
    const enrollmentByStudent = new Map<string, (typeof enrollments)[number]>();
    const historicallyEnrolled = new Set<string>();
    const addedLater = new Set<string>();
    for (const enrollment of enrollments) {
      const scope = attendanceEnrollmentScope(enrollment, lesson.startsAt);
      if (!scope && !markByStudent.has(enrollment.studentId)) continue;
      enrollmentByStudent.set(enrollment.studentId, enrollment);
      if (scope === 'HISTORICAL') historicallyEnrolled.add(enrollment.studentId);
      else if (scope === 'CURRENT_LATER') addedLater.add(enrollment.studentId);
    }
    const participants: AttendanceParticipant[] = [...enrollmentByStudent.values()].map(
      ({ student, studentId }) => {
        const mark = markByStudent.get(studentId);
        return {
          ...(addedLater.has(studentId) && !historicallyEnrolled.has(studentId)
            ? { addedToGroupLater: true }
            : {}),
          comment: mark?.comment ?? undefined,
          markedAt: mark?.markedAt.toISOString(),
          status: mark?.status,
          studentId,
          studentName: [student.lastName, student.firstName, student.middleName]
            .filter(Boolean)
            .join(' '),
        };
      },
    );
    const participantIds = new Set(participants.map(({ studentId }) => studentId));
    for (const mark of marks) {
      if (participantIds.has(mark.studentId)) continue;
      participants.push({
        comment: mark.comment ?? undefined,
        markedAt: mark.markedAt.toISOString(),
        status: mark.status,
        studentId: mark.studentId,
        studentName: [mark.student.lastName, mark.student.firstName, mark.student.middleName]
          .filter(Boolean)
          .join(' '),
      });
    }
    participants.sort((left, right) => left.studentName.localeCompare(right.studentName, 'ru'));
    return {
      attendanceCompletedAt: lesson.attendanceCompletedAt?.toISOString(),
      lesson: lessonSummary(lesson),
      participants,
    };
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
    if (lesson.status === 'CANCELLED')
      throw new DomainError('VALIDATION', t('domain.validation.attendanceCancelled'));
    const allowedStudents = await this.attendanceStudentIds(lesson);
    await this.persistAttendance(actor, lesson, entries, allowedStudents);
    return this.getAttendance(token, lessonId);
  }

  async saveManualAttendance(
    token: string,
    lessonId: string,
    entry: AttendanceEntryInput,
  ): Promise<AttendanceLessonDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'attendance:manage');
    if (actor.role === 'COACH')
      throw new DomainError('AUTHORIZATION', t('domain.authorization.permissionDenied'));
    if (
      !MANUAL_ATTENDANCE_STATUSES.includes(
        entry.status as (typeof MANUAL_ATTENDANCE_STATUSES)[number],
      )
    )
      throw new DomainError(
        'VALIDATION',
        'Для ручной отметки выберите присутствие, отсутствие или болезнь.',
      );
    const lesson = await this.requireLesson(lessonId);
    this.assertLessonRead(actor, lesson);
    if (lesson.status === 'CANCELLED')
      throw new DomainError('VALIDATION', t('domain.validation.attendanceCancelled'));
    const student = await this.database.student.findUnique({ where: { id: entry.studentId } });
    if (!student || student.archivedAt)
      throw new DomainError('NOT_FOUND', t('domain.notFound.student'));
    assertBranchAccess(actor, student.branchId);
    if (student.branchId !== lesson.branchId)
      throw new DomainError('AUTHORIZATION', t('domain.authorization.attendanceStudent'));
    const allowedStudents = await this.attendanceStudentIds(lesson);
    allowedStudents.add(entry.studentId);
    await this.persistAttendance(
      actor,
      lesson,
      [entry],
      allowedStudents,
      undefined,
      false,
      new Set([entry.studentId]),
    );
    return this.getAttendance(token, lessonId);
  }

  async processTrainerWebAttendance(
    trainerId: string,
    lessonId: string,
    entries: AttendanceEntryInput[],
    webActionId: string,
  ): Promise<void> {
    const trainer = await this.database.user.findUnique({
      include: { branchAssignments: { select: { branchId: true } } },
      where: { id: trainerId },
    });
    if (trainer?.role !== 'COACH' || !trainer.isActive)
      throw new DomainError('AUTHORIZATION', 'Тренер недоступен для отметки посещаемости.');
    const actor: AuthenticatedUser = {
      branchIds: trainer.branchAssignments.map(({ branchId }) => branchId),
      email: trainer.email,
      fullName: trainer.fullName,
      id: trainer.id,
      mustChangePassword: trainer.mustChangePassword,
      permissions: permissionsForRole(trainer.role),
      role: trainer.role,
    };
    assertPermission(actor, 'attendance:manage');
    const lesson = await this.requireLesson(lessonId);
    assertBranchAccess(actor, lesson.branchId);
    const assignedTrainerId = lesson.substitution?.substituteTrainerId ?? lesson.coachId;
    const assignedThroughGroup =
      !assignedTrainerId &&
      (lesson.group.coachId === actor.id || lesson.group.assistantCoachId === actor.id);
    if (assignedTrainerId !== actor.id && !assignedThroughGroup)
      throw new DomainError('AUTHORIZATION', t('domain.authorization.lessonCoach'));
    if (lesson.status === 'CANCELLED')
      throw new DomainError('VALIDATION', t('domain.validation.attendanceCancelled'));
    const allowedStudents = await this.attendanceStudentIds(lesson);
    await this.persistAttendance(actor, lesson, entries, allowedStudents, webActionId, true);
  }

  private async attendanceStudentIds(lesson: LessonRecord): Promise<Set<string>> {
    const [enrollments, existingMarks] = await Promise.all([
      this.database.enrollment.findMany({
        include: { student: { select: { archivedAt: true, status: true } } },
        where: { groupId: lesson.groupId },
      }),
      this.database.attendance.findMany({
        select: { studentId: true },
        where: { lessonId: lesson.id },
      }),
    ]);
    return new Set([
      ...existingMarks.map(({ studentId }) => studentId),
      ...enrollments
        .filter((enrollment) => Boolean(attendanceEnrollmentScope(enrollment, lesson.startsAt)))
        .map(({ studentId }) => studentId),
    ]);
  }

  private async persistAttendance(
    actor: AuthenticatedUser,
    lesson: LessonRecord,
    entries: AttendanceEntryInput[],
    allowedStudents: Set<string>,
    webActionId?: string,
    allowCoachCorrection = false,
    manuallyAddedStudents: Set<string> = new Set<string>(),
  ): Promise<void> {
    if (new Set(entries.map(({ studentId }) => studentId)).size !== entries.length)
      throw new DomainError('VALIDATION', t('domain.validation.attendanceUnique'));
    if (entries.some(({ studentId }) => !allowedStudents.has(studentId)))
      throw new DomainError('AUTHORIZATION', t('domain.authorization.attendanceStudent'));
    await this.database.$transaction(async (transaction) => {
      for (const entry of entries) {
        const previous = await transaction.attendance.findUnique({
          where: { lessonId_studentId: { lessonId: lesson.id, studentId: entry.studentId } },
        });
        if (
          previous &&
          previous.status !== entry.status &&
          actor.role === 'COACH' &&
          !allowCoachCorrection
        )
          throw new DomainError('AUTHORIZATION', t('domain.authorization.attendanceCorrection'));
        if (
          previous &&
          previous.status !== entry.status &&
          (previous.directPaymentId || previous.directPaymentOperationId)
        )
          throw new DomainError(
            'CONFLICT',
            'Сначала отмените или завершите оплату этого посещения.',
          );
        if (previous && previous.status !== entry.status)
          await reverseAttendanceWriteOffs(
            transaction,
            `${lesson.id}:${entry.studentId}`,
            actor.id,
            t('ledger.comment.attendanceCorrection'),
          );
        await transaction.attendance.upsert({
          create: {
            comment: optionalValue(entry.comment),
            lessonId: lesson.id,
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
          where: { lessonId_studentId: { lessonId: lesson.id, studentId: entry.studentId } },
        });
        if (!previous && manuallyAddedStudents.has(entry.studentId))
          await this.audit(
            transaction,
            actor.id,
            'ATTENDANCE_STUDENT_MANUALLY_ADDED',
            'Attendance',
            `${lesson.id}:${entry.studentId}`,
            { lessonId: lesson.id, studentId: entry.studentId },
          );
        if (previous?.status !== entry.status)
          await applyAttendanceWriteOff(transaction, {
            actorUserId: actor.id,
            attendanceStatus: entry.status,
            branchId: lesson.branchId,
            lessonId: lesson.id,
            lessonStartsAt: lesson.startsAt,
            studentId: entry.studentId,
          });
        if (previous && previous.status !== entry.status)
          await this.audit(
            transaction,
            actor.id,
            'ATTENDANCE_CORRECTED',
            'Attendance',
            `${lesson.id}:${entry.studentId}`,
            {
              from: previous.status,
              source: webActionId ? 'TRAINER_WEB_ACTION' : 'CRM',
              to: entry.status,
            },
          );
      }
      if (entries.length > 0 && lesson.status === 'PLANNED' && lesson.endsAt <= new Date()) {
        await transaction.lesson.update({
          data: { status: 'COMPLETED' },
          where: { id: lesson.id },
        });
        await this.audit(
          transaction,
          actor.id,
          'LESSON_COMPLETED_BY_ATTENDANCE',
          'Lesson',
          lesson.id,
        );
      }
      if (!lesson.attendanceCompletedAt && allowedStudents.size > 0) {
        const markedCount = await transaction.attendance.count({ where: { lessonId: lesson.id } });
        if (markedCount >= allowedStudents.size)
          await transaction.lesson.update({
            data: { attendanceCompletedAt: new Date() },
            where: { id: lesson.id },
          });
      }
      if (webActionId)
        await transaction.webAction.update({
          data: {
            nextCompletionAttemptAt: new Date(),
            processedAt: new Date(),
            processedByUserId: actor.id,
            safeError: null,
            safeResultJson: JSON.stringify({ marksApplied: entries.length, status: 'SUCCEEDED' }),
            status: 'SUCCEEDED_ACK_PENDING',
          },
          where: { id: webActionId, status: 'CLAIMED' },
        });
    });
  }

  private async materializeScheduleOccurrence(
    schedule: WeeklySchedule,
    startsAt: Date,
    endsAt: Date,
  ): Promise<{ created: boolean; lesson: LessonRecord }> {
    const existing = await this.database.lesson.findUnique({
      include: lessonInclude,
      where: { groupId_startsAt: { groupId: schedule.groupId, startsAt } },
    });
    if (existing) return { created: false, lesson: existing };
    await this.calendar.assertEventAvailable({
      ...(schedule.coachId ? { coachId: schedule.coachId } : {}),
      endAt: endsAt,
      groupId: schedule.groupId,
      ...(schedule.roomId ? { roomId: schedule.roomId } : {}),
      startAt: startsAt,
    });
    try {
      const lesson = await this.database.lesson.create({
        data: {
          branchId: schedule.branchId,
          coachId: schedule.coachId,
          endsAt,
          groupId: schedule.groupId,
          room: schedule.room,
          roomId: schedule.roomId,
          scheduleTemplateId: schedule.id,
          startsAt,
        },
        include: lessonInclude,
      });
      return { created: true, lesson };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
      const lesson = await this.database.lesson.findUnique({
        include: lessonInclude,
        where: { groupId_startsAt: { groupId: schedule.groupId, startsAt } },
      });
      if (!lesson) throw error;
      return { created: false, lesson };
    }
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
      roomId: input.roomId ?? null,
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
    await this.validateRoomForBranch(input.roomId, input.branchId);
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
          ...(input.roomId ? [{ roomId: input.roomId }] : []),
          { groupId: input.groupId },
        ],
      },
    });
    const conflict = possible.find((schedule) => scheduleWindowsOverlap(candidate, schedule));
    if (conflict) {
      const resource =
        conflict.groupId === input.groupId
          ? 'группа'
          : input.coachId && conflict.coachId === input.coachId
            ? t('schedule.conflict.coach')
            : t('schedule.conflict.room');
      throw new DomainError('CONFLICT', t('domain.conflict.schedule', { resource }));
    }
    if (input.roomId) {
      const rangeStart = candidate.validFrom;
      const rangeEnd = candidate.validTo ?? new Date(rangeStart.getTime() + 366 * 86_400_000);
      const [rentals, closures] = await Promise.all([
        this.database.roomRental.findMany({
          where: {
            endAt: { gt: rangeStart },
            roomId: input.roomId,
            startAt: { lt: rangeEnd },
            status: 'ACTIVE',
          },
        }),
        this.database.roomClosure.findMany({
          where: {
            endAt: { gt: rangeStart },
            roomId: input.roomId,
            startAt: { lt: rangeEnd },
          },
        }),
      ]);
      const conflictsWithOccurrence = (startAt: Date, endAt: Date) => {
        const startTime = startAt.toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          hour12: false,
          minute: '2-digit',
        });
        const endTime = endAt.toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          hour12: false,
          minute: '2-digit',
        });
        return (
          isoWeekday(startAt) === input.weekday &&
          input.startTime < endTime &&
          startTime < input.endTime
        );
      };
      if (rentals.some(({ endAt, startAt }) => conflictsWithOccurrence(startAt, endAt)))
        throw new DomainError('CONFLICT', 'В одну из дат зал занят арендой.');
      if (closures.some(({ endAt, startAt }) => conflictsWithOccurrence(startAt, endAt)))
        throw new DomainError('CONFLICT', 'В одну из дат зал временно закрыт.');
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
      roomId: input.roomId ?? null,
      startsAt: new Date(input.startsAt),
    };
  }

  private async assertLessonNoConflict(input: LessonInput, excludeId?: string): Promise<void> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    await this.calendar.assertEventAvailable({
      ...(input.coachId ? { coachId: input.coachId } : {}),
      endAt: endsAt,
      ...(excludeId ? { excludeLessonId: excludeId } : {}),
      groupId: input.groupId,
      ...(input.roomId ? { roomId: input.roomId } : {}),
      startAt: startsAt,
    });
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

  private async validateRoomForBranch(roomId: string | undefined, branchId: string): Promise<void> {
    if (!roomId) return;
    const room = await this.database.room.findFirst({
      where: { archivedAt: null, branchId, id: roomId, isActive: true },
    });
    if (!room) throw new DomainError('VALIDATION', 'Выбранный зал недоступен в этом филиале.');
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
