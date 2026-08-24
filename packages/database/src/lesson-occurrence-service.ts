import type { AuthenticatedUser } from '@arava/shared';
import type { EnrollmentStatus, Prisma, StudentStatus } from '@prisma/client';

import type { DatabaseClient } from './index';
import { accessibleBranchIds } from './permissions';
import {
  endOfLocalDay,
  isoWeekday,
  scheduleOccurrenceForLocalDate,
  startOfLocalDay,
} from './schedule';

const activeEnrollmentStatuses: EnrollmentStatus[] = ['ACTIVE', 'TRIAL'];
const activeStudentStatuses: StudentStatus[] = ['ACTIVE', 'TRIAL', 'FROZEN'];

const materializedLessonInclude = {
  attendance: { select: { studentId: true } },
  group: { select: { assistantCoachId: true, coachId: true } },
} satisfies Prisma.LessonInclude;

type MaterializedLesson = Prisma.LessonGetPayload<{
  include: typeof materializedLessonInclude;
}>;

export interface ResolvedDailyLesson {
  attendanceMarked: number;
  branchId: string;
  endsAt: Date;
  expectedStudents: number;
  groupId: string;
  lessonId?: string;
  source: 'LESSON' | 'WEEKLY_SCHEDULE';
  startsAt: Date;
  trialStudents: number;
}

function occurrenceKey(groupId: string, startsAt: Date): string {
  return `${groupId}:${String(startsAt.getTime())}`;
}

function overlaps(startAt: Date, endAt: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return rangeStart < endAt && rangeEnd > startAt;
}

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
    activeEnrollmentStatuses.includes(enrollment.status) &&
    activeStudentStatuses.includes(enrollment.student.status) &&
    !enrollment.student.archivedAt
  );
}

/** Resolves the operational lesson set for one local studio day without creating Lesson rows. */
export class LessonOccurrenceService {
  constructor(private readonly database: DatabaseClient) {}

  async resolveDay(actor: AuthenticatedUser, date: Date): Promise<ResolvedDailyLesson[]> {
    const dayStart = startOfLocalDay(date);
    const dayEnd = endOfLocalDay(date);
    const weekday = isoWeekday(dayStart);
    const branchIds = accessibleBranchIds(actor);
    const coachScope =
      actor.role === 'COACH'
        ? {
            OR: [
              { coachId: actor.id },
              { group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] } },
            ],
          }
        : {};
    const [materialized, schedules, exceptions] = await Promise.all([
      this.database.lesson.findMany({
        include: materializedLessonInclude,
        where: {
          startsAt: { gte: dayStart, lte: dayEnd },
          ...(branchIds ? { branchId: { in: branchIds } } : {}),
          ...coachScope,
        },
      }),
      this.database.weeklySchedule.findMany({
        where: {
          isActive: true,
          weekday,
          validFrom: { lte: dayEnd },
          ...(branchIds ? { branchId: { in: branchIds } } : {}),
          AND: [
            { OR: [{ validTo: null }, { validTo: { gte: dayStart } }] },
            ...(actor.role === 'COACH' ? [coachScope] : []),
          ],
        },
      }),
      this.database.calendarException.findMany({
        where: {
          endAt: { gt: dayStart },
          startAt: { lte: dayEnd },
          ...(branchIds ? { OR: [{ branchId: null }, { branchId: { in: branchIds } }] } : {}),
        },
      }),
    ]);
    const roomIds = [...new Set(schedules.flatMap(({ roomId }) => (roomId ? [roomId] : [])))];
    const closures = roomIds.length
      ? await this.database.roomClosure.findMany({
          where: {
            endAt: { gt: dayStart },
            roomId: { in: roomIds },
            startAt: { lte: dayEnd },
          },
        })
      : [];
    const materializedKeys = new Set(
      materialized.map(({ groupId, startsAt }) => occurrenceKey(groupId, startsAt)),
    );
    const unresolved = [
      ...materialized
        .filter(({ status }) => status !== 'CANCELLED')
        .map((lesson) => this.fromLesson(lesson)),
      ...schedules.flatMap((schedule): ResolvedDailyLesson[] => {
        const occurrence = scheduleOccurrenceForLocalDate(schedule, dayStart);
        if (!occurrence) return [];
        if (materializedKeys.has(occurrenceKey(schedule.groupId, occurrence.startsAt))) return [];
        if (
          exceptions.some(
            (exception) =>
              (!exception.branchId || exception.branchId === schedule.branchId) &&
              exception.startAt <= occurrence.startsAt &&
              exception.endAt > occurrence.startsAt,
          )
        )
          return [];
        if (
          schedule.roomId &&
          closures.some(
            (closure) =>
              closure.roomId === schedule.roomId &&
              overlaps(occurrence.startsAt, occurrence.endsAt, closure.startAt, closure.endAt),
          )
        )
          return [];
        return [
          {
            attendanceMarked: 0,
            branchId: schedule.branchId,
            endsAt: occurrence.endsAt,
            expectedStudents: 0,
            groupId: schedule.groupId,
            source: 'WEEKLY_SCHEDULE',
            startsAt: occurrence.startsAt,
            trialStudents: 0,
          },
        ];
      }),
    ];
    const groupIds = [...new Set(unresolved.map(({ groupId }) => groupId))];
    const enrollments = groupIds.length
      ? await this.database.enrollment.findMany({
          include: { student: { select: { archivedAt: true, status: true } } },
          where: {
            groupId: { in: groupIds },
            joinedAt: { lte: dayEnd },
            OR: [{ leftAt: null }, { leftAt: { gte: dayStart } }],
          },
        })
      : [];
    const enrollmentsByGroup = new Map<string, typeof enrollments>();
    for (const enrollment of enrollments) {
      const group = enrollmentsByGroup.get(enrollment.groupId) ?? [];
      group.push(enrollment);
      enrollmentsByGroup.set(enrollment.groupId, group);
    }
    const attendanceByLesson = new Map(
      materialized.map((lesson) => [
        lesson.id,
        new Set(lesson.attendance.map(({ studentId }) => studentId)),
      ]),
    );
    return unresolved
      .map((lesson) => {
        const expectedStudentIds = new Set(
          lesson.lessonId ? attendanceByLesson.get(lesson.lessonId) : undefined,
        );
        let trialStudents = 0;
        for (const enrollment of enrollmentsByGroup.get(lesson.groupId) ?? []) {
          if (!membershipValidAt(enrollment, lesson.startsAt)) continue;
          expectedStudentIds.add(enrollment.studentId);
          if (enrollment.status === 'TRIAL') trialStudents += 1;
        }
        return {
          ...lesson,
          expectedStudents: expectedStudentIds.size,
          trialStudents,
        };
      })
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  }

  private fromLesson(lesson: MaterializedLesson): ResolvedDailyLesson {
    return {
      attendanceMarked: lesson.attendance.length,
      branchId: lesson.branchId,
      endsAt: lesson.endsAt,
      expectedStudents: 0,
      groupId: lesson.groupId,
      lessonId: lesson.id,
      source: 'LESSON',
      startsAt: lesson.startsAt,
      trialStudents: 0,
    };
  }
}
