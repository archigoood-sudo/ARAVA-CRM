import type { GroupRosterMember, GroupRosterOverview, GroupRosterSegment } from '@arava/shared';
import { t } from '@arava/shared';
import type { EnrollmentStatus } from '@prisma/client';

import { FinanceService } from './finance-service';
import type { DatabaseClient } from './index';
import { assertBranchAccess, assertPermission } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';

const CAPACITY_STATUSES: EnrollmentStatus[] = ['ACTIVE', 'TRIAL', 'FROZEN'];
const RECENT_DAYS = 14;

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return dateKey(value);
}

function fullName(student: {
  firstName: string;
  lastName: string;
  middleName: string | null;
}): string {
  return [student.lastName, student.firstName, student.middleName].filter(Boolean).join(' ');
}

function ageAt(birthDate: Date | null, at: string): number | undefined {
  if (!birthDate) return undefined;
  const [year, month, day] = at.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const birthYear = birthDate.getUTCFullYear();
  const birthMonth = birthDate.getUTCMonth() + 1;
  const birthDay = birthDate.getUTCDate();
  return (
    year - birthYear - (month < birthMonth || (month === birthMonth && day < birthDay) ? 1 : 0)
  );
}

function segmentAt(
  joinedAt: string,
  leftAt: string | undefined,
  asOfDate: string,
): GroupRosterSegment {
  if (joinedAt > asOfDate) return 'FUTURE';
  if (!leftAt || leftAt >= asOfDate) return 'CURRENT';
  return 'FORMER';
}

export class GroupRosterService {
  private readonly finance: FinanceService;

  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {
    this.finance = new FinanceService(database, application);
  }

  async get(token: string, groupId: string, asOfDate: string): Promise<GroupRosterOverview> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'groups:read');
    const group = await this.database.danceGroup.findUnique({
      select: {
        assistantCoachId: true,
        branchId: true,
        capacity: true,
        coachId: true,
        id: true,
      },
      where: { id: groupId },
    });
    if (!group) throw new DomainError('NOT_FOUND', t('domain.notFound.group'));
    assertBranchAccess(actor, group.branchId);
    if (actor.role === 'COACH' && group.coachId !== actor.id && group.assistantCoachId !== actor.id)
      throw new DomainError('AUTHORIZATION', t('domain.authorization.groupCoach'));

    const enrollments = await this.database.enrollment.findMany({
      include: {
        student: {
          select: {
            birthDate: true,
            firstName: true,
            id: true,
            lastName: true,
            middleName: true,
            phone: true,
            status: true,
          },
        },
      },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
      where: { groupId },
    });
    const studentIds = [...new Set(enrollments.map(({ studentId }) => studentId))];
    const [attendance, finances] = await Promise.all([
      this.database.attendance.findMany({
        orderBy: { lesson: { startsAt: 'desc' } },
        select: { lesson: { select: { startsAt: true } }, studentId: true },
        where: {
          lesson: { groupId, status: { not: 'CANCELLED' } },
          status: { in: ['PRESENT', 'LATE', 'TRIAL'] },
          studentId: { in: studentIds },
        },
      }),
      this.finance.rosterFinance(token, group.branchId, studentIds),
    ]);
    const attendanceByStudent = new Map<string, Date>();
    for (const item of attendance)
      if (!attendanceByStudent.has(item.studentId))
        attendanceByStudent.set(item.studentId, item.lesson.startsAt);
    const recentFrom = shiftDate(asOfDate, -(RECENT_DAYS - 1));
    const members: GroupRosterMember[] = enrollments.map((enrollment) => {
      const joinedAt = dateKey(enrollment.joinedAt);
      const leftAt = enrollment.leftAt ? dateKey(enrollment.leftAt) : undefined;
      const segment = segmentAt(joinedAt, leftAt, asOfDate);
      const finance = finances.get(enrollment.studentId);
      const lastAttendance = attendanceByStudent.get(enrollment.studentId);
      return {
        age: ageAt(enrollment.student.birthDate, asOfDate),
        joinedAt,
        lastAttendanceAt: lastAttendance?.toISOString(),
        leftAt,
        membershipId: enrollment.id,
        membershipStatus: enrollment.status,
        recentlyAdded: segment === 'CURRENT' && joinedAt >= recentFrom,
        segment,
        studentId: enrollment.studentId,
        studentName: fullName(enrollment.student),
        studentPhone: actor.role === 'COACH' ? undefined : (enrollment.student.phone ?? undefined),
        studentStatus: enrollment.student.status,
        subscription: finance?.subscription,
        totalDebt: actor.role === 'COACH' ? undefined : finance?.totalDebt,
      };
    });
    const current = members.filter(({ segment }) => segment === 'CURRENT');
    const capacityOccupiedCount = enrollments.filter(
      ({ leftAt, status }) => !leftAt && CAPACITY_STATUSES.includes(status),
    ).length;
    return {
      activeCount: current.filter(
        ({ membershipStatus, studentStatus }) =>
          membershipStatus === 'ACTIVE' && studentStatus === 'ACTIVE',
      ).length,
      asOfDate,
      capacity: group.capacity,
      capacityOccupiedCount,
      currentCount: current.length,
      formerCount: members.filter(({ segment }) => segment === 'FORMER').length,
      freePlaces: Math.max(0, group.capacity - capacityOccupiedCount),
      frozenCount: current.filter(
        ({ membershipStatus, studentStatus }) =>
          membershipStatus === 'FROZEN' || studentStatus === 'FROZEN',
      ).length,
      futureCount: members.filter(({ segment }) => segment === 'FUTURE').length,
      members,
      recentlyAddedCount: current.filter(({ recentlyAdded }) => recentlyAdded).length,
      trialCount: current.filter(
        ({ membershipStatus, studentStatus }) =>
          membershipStatus === 'TRIAL' || studentStatus === 'TRIAL',
      ).length,
    };
  }
}
