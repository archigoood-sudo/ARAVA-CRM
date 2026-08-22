import type {
  AttendanceScanLessonOption,
  AttendanceScanOptions,
  AttendanceWorkspaceDay,
  AttendanceWorkspaceLesson,
  AuthenticatedUser,
} from '@arava/shared';
import type { EnrollmentStatus, Prisma, StudentStatus } from '@prisma/client';

import type { DatabaseClient } from './index';
import { accessibleBranchIds, assertBranchAccess, assertPermission } from './permissions';
import { endOfLocalDay, startOfLocalDay } from './schedule';
import { DomainError } from './security';
import type { ApplicationService } from './services';

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
  ) {}

  async today(token: string, date: string): Promise<AttendanceWorkspaceDay> {
    const actor = await this.workspaceActor(token);
    const from = startOfLocalDay(date);
    const to = endOfLocalDay(date);
    const branchIds = accessibleBranchIds(actor);
    const lessons = await this.database.lesson.findMany({
      include: workspaceLessonInclude,
      orderBy: { startsAt: 'asc' },
      where: {
        startsAt: { gte: from, lte: to },
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
      },
    });
    const groupIds = [...new Set(lessons.map(({ groupId }) => groupId))];
    const enrollments = groupIds.length
      ? await this.database.enrollment.findMany({
          include: { student: { select: { archivedAt: true, status: true } } },
          where: {
            groupId: { in: groupIds },
            joinedAt: { lte: to },
            OR: [{ leftAt: null }, { leftAt: { gte: from } }],
          },
        })
      : [];
    const byGroup = new Map<string, typeof enrollments>();
    for (const enrollment of enrollments) {
      const group = byGroup.get(enrollment.groupId) ?? [];
      group.push(enrollment);
      byGroup.set(enrollment.groupId, group);
    }
    const summaries: AttendanceWorkspaceLesson[] = lessons.map((lesson) => {
      const markedStudentIds = new Set(lesson.attendance.map(({ studentId }) => studentId));
      const expectedStudentIds = new Set(markedStudentIds);
      for (const enrollment of byGroup.get(lesson.groupId) ?? []) {
        if (membershipValidAt(enrollment, lesson.startsAt))
          expectedStudentIds.add(enrollment.studentId);
      }
      return {
        attendanceCompletedAt: lesson.attendanceCompletedAt?.toISOString(),
        attendanceExpected: expectedStudentIds.size,
        attendanceMarked: markedStudentIds.size,
        branchId: lesson.branchId,
        branchName: lesson.branch.name,
        direction: lesson.group.direction,
        effectiveTrainerName: effectiveTrainerName(lesson),
        endsAt: lesson.endsAt.toISOString(),
        groupId: lesson.groupId,
        groupName: lesson.group.name,
        id: lesson.id,
        roomName: lesson.roomEntity?.name ?? lesson.room ?? undefined,
        startsAt: lesson.startsAt.toISOString(),
        status: lesson.status,
      };
    });
    return { date, lessons: summaries };
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
    const to = endOfLocalDay(date);
    const lessons = await this.database.lesson.findMany({
      include: workspaceLessonInclude,
      where: {
        branchId: student.branchId,
        startsAt: { gte: from, lte: to },
        status: { not: 'CANCELLED' },
        OR: [
          { attendance: { some: { studentId } } },
          {
            group: {
              enrollments: {
                some: {
                  studentId,
                  joinedAt: { lte: to },
                  OR: [{ leftAt: null }, { leftAt: { gte: from } }],
                },
              },
            },
          },
        ],
      },
    });
    const enrollments = await this.database.enrollment.findMany({
      include: { student: { select: { archivedAt: true, status: true } } },
      where: {
        groupId: { in: [...new Set(lessons.map(({ groupId }) => groupId))] },
        studentId,
      },
    });
    const enrollmentByGroup = new Map(
      enrollments.map((enrollment) => [enrollment.groupId, enrollment]),
    );
    const options = lessons.flatMap((lesson): AttendanceScanLessonOption[] => {
      const current = lesson.attendance.find((attendance) => attendance.studentId === studentId);
      const enrollment = enrollmentByGroup.get(lesson.groupId);
      if (!current && (!enrollment || !membershipValidAt(enrollment, lesson.startsAt))) return [];
      return [
        {
          branchName: lesson.branch.name,
          currentStatus: current?.status,
          effectiveTrainerName: effectiveTrainerName(lesson),
          endsAt: lesson.endsAt.toISOString(),
          groupName: lesson.group.name,
          lessonId: lesson.id,
          roomName: lesson.roomEntity?.name ?? lesson.room ?? undefined,
          startsAt: lesson.startsAt.toISOString(),
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
