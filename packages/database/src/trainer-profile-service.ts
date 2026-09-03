import type {
  AuthenticatedUser,
  TrainerProfileLesson,
  TrainerProfileOverview,
  TrainerProfileSubstitution,
} from '@arava/shared';
import type { Prisma } from '@prisma/client';

import type { DatabaseClient } from './index';
import { accessibleBranchIds, assertPermission } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';

const ACTIVE_ENROLLMENTS = ['ACTIVE', 'TRIAL', 'FROZEN'] as const;
const WEEKDAYS = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const UPCOMING_LIMIT = 12;
const SUBSTITUTION_LIMIT = 20;

const lessonInclude = {
  attendance: { select: { status: true } },
  branch: { select: { name: true } },
  coach: { select: { fullName: true } },
  group: { select: { name: true } },
  roomEntity: { select: { name: true } },
  substitution: {
    include: {
      originalTrainer: { select: { fullName: true } },
      substituteTrainer: { select: { fullName: true } },
    },
  },
} satisfies Prisma.LessonInclude;

type LessonRecord = Prisma.LessonGetPayload<{ include: typeof lessonInclude }>;

function monthRange(month: string): { from: Date; to: Date } {
  const match = /^(\d{4})-(\d{2})$/u.exec(month);
  if (!match) throw new DomainError('VALIDATION', 'Укажите месяц в формате ГГГГ-ММ.');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11)
    throw new DomainError('VALIDATION', 'Укажите корректный месяц.');
  return { from: new Date(year, monthIndex, 1), to: new Date(year, monthIndex + 1, 1) };
}

function startOfToday(): Date {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function lessonView(lesson: LessonRecord): TrainerProfileLesson {
  return {
    actualTrainerName: lesson.coach?.fullName,
    branchId: lesson.branchId,
    branchName: lesson.branch.name,
    endsAt: lesson.endsAt.toISOString(),
    groupId: lesson.groupId,
    groupName: lesson.group.name,
    id: lesson.id,
    isSubstitution: Boolean(lesson.substitution),
    roomName: lesson.roomEntity?.name ?? lesson.room ?? undefined,
    scheduledTrainerName: lesson.substitution?.originalTrainer?.fullName ?? lesson.coach?.fullName,
    startsAt: lesson.startsAt.toISOString(),
    status: lesson.status,
  };
}

function substitutionView(record: {
  createdAt: Date;
  id: string;
  lesson: {
    branch: { name: string };
    group: { name: string };
    id: string;
    startsAt: Date;
  };
  originalTrainer: { fullName: string } | null;
  reason: string | null;
  substituteTrainer: { fullName: string };
}): TrainerProfileSubstitution {
  return {
    branchName: record.lesson.branch.name,
    createdAt: record.createdAt.toISOString(),
    groupName: record.lesson.group.name,
    id: record.id,
    lessonId: record.lesson.id,
    originalTrainerName: record.originalTrainer?.fullName,
    reason: record.reason ?? undefined,
    startsAt: record.lesson.startsAt.toISOString(),
    substituteTrainerName: record.substituteTrainer.fullName,
  };
}

function branchFilter(branchIds: string[] | undefined): Prisma.LessonWhereInput {
  return branchIds ? { branchId: { in: branchIds } } : {};
}

export class TrainerProfileService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async getOverview(
    token: string,
    trainerId: string,
    month: string,
  ): Promise<TrainerProfileOverview> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payroll:read');
    const trainer = await this.database.user.findUnique({
      include: { branchAssignments: { include: { branch: { select: { name: true } } } } },
      where: { id: trainerId },
    });
    if (trainer?.role !== 'COACH') throw new DomainError('NOT_FOUND', 'Профиль тренера не найден.');
    await this.assertProfileAccess(
      actor,
      trainerId,
      trainer.branchAssignments.map(({ branchId }) => branchId),
    );

    const allowedBranchIds = accessibleBranchIds(actor);
    const scope = branchFilter(allowedBranchIds);
    const { from, to } = monthRange(month);
    const todayFrom = startOfToday();
    const todayTo = new Date(todayFrom);
    todayTo.setDate(todayTo.getDate() + 1);
    const recentFrom = new Date(todayFrom);
    recentFrom.setDate(recentFrom.getDate() - 90);
    const relevantTrainer = {
      OR: [
        { coachId: trainerId },
        { substitution: { is: { originalTrainerId: trainerId } } },
        { substitution: { is: { substituteTrainerId: trainerId } } },
      ],
    } satisfies Prisma.LessonWhereInput;

    const [
      groups,
      historicalGroups,
      periodLessons,
      todayLessons,
      upcomingLessons,
      schedules,
      substitutions,
      accruals,
      payrollPeriods,
      payrollRules,
      payoutRules,
    ] = await Promise.all([
      this.database.danceGroup.findMany({
        include: {
          branch: { select: { name: true } },
          enrollments: {
            select: { id: true },
            where: { leftAt: null, status: { in: [...ACTIVE_ENROLLMENTS] } },
          },
          lessons: {
            include: lessonInclude,
            orderBy: { startsAt: 'asc' },
            take: 1,
            where: { startsAt: { gte: new Date() }, status: 'PLANNED' },
          },
          schedules: {
            include: { roomEntity: { select: { name: true } } },
            orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
            where: { isActive: true },
          },
        },
        orderBy: { name: 'asc' },
        where: {
          archivedAt: null,
          coachId: trainerId,
          ...(allowedBranchIds ? { branchId: { in: allowedBranchIds } } : {}),
          status: { not: 'ARCHIVED' },
        },
      }),
      this.database.danceGroup.findMany({
        include: {
          _count: {
            select: {
              enrollments: {
                where: { leftAt: null, status: { in: [...ACTIVE_ENROLLMENTS] } },
              },
            },
          },
          branch: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        where: {
          ...(allowedBranchIds ? { branchId: { in: allowedBranchIds } } : {}),
          coachId: trainerId,
          OR: [{ archivedAt: { not: null } }, { status: 'ARCHIVED' }],
        },
      }),
      this.database.lesson.findMany({
        include: lessonInclude,
        orderBy: { startsAt: 'asc' },
        where: { ...scope, ...relevantTrainer, startsAt: { gte: from, lt: to } },
      }),
      this.database.lesson.findMany({
        include: lessonInclude,
        orderBy: { startsAt: 'asc' },
        where: { ...scope, ...relevantTrainer, startsAt: { gte: todayFrom, lt: todayTo } },
      }),
      this.database.lesson.findMany({
        include: lessonInclude,
        orderBy: { startsAt: 'asc' },
        take: UPCOMING_LIMIT,
        where: { ...scope, ...relevantTrainer, startsAt: { gte: new Date() }, status: 'PLANNED' },
      }),
      this.database.weeklySchedule.findMany({
        include: {
          branch: { select: { name: true } },
          group: { select: { name: true } },
          roomEntity: { select: { name: true } },
        },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
        where: {
          ...(allowedBranchIds ? { branchId: { in: allowedBranchIds } } : {}),
          AND: [
            { OR: [{ coachId: trainerId }, { coachId: null, group: { coachId: trainerId } }] },
            { OR: [{ validTo: null }, { validTo: { gte: todayFrom } }] },
          ],
          isActive: true,
          validFrom: { lt: todayTo },
        },
      }),
      this.database.trainerSubstitution.findMany({
        include: {
          lesson: {
            include: { branch: { select: { name: true } }, group: { select: { name: true } } },
          },
          originalTrainer: { select: { fullName: true } },
          substituteTrainer: { select: { fullName: true } },
        },
        orderBy: { lesson: { startsAt: 'desc' } },
        take: SUBSTITUTION_LIMIT,
        where: {
          lesson: allowedBranchIds ? { branchId: { in: allowedBranchIds } } : {},
          OR: [{ originalTrainerId: trainerId }, { substituteTrainerId: trainerId }],
        },
      }),
      this.database.payrollAccrual.findMany({
        include: {
          branch: { select: { name: true } },
          group: { select: { name: true } },
          lesson: { select: { startsAt: true } },
          payrollPeriod: { select: { status: true } },
        },
        orderBy: { createdAt: 'asc' },
        where: {
          ...(allowedBranchIds ? { branchId: { in: allowedBranchIds } } : {}),
          coachId: trainerId,
          payrollPeriod: {
            dateFrom: { lt: to },
            dateTo: { gte: from },
            status: { in: ['CALCULATED', 'APPROVED', 'PAID'] },
          },
        },
      }),
      this.database.payrollPeriod.findMany({
        select: { branchId: true, dateFrom: true, dateTo: true, status: true },
        where: {
          ...(allowedBranchIds
            ? { OR: [{ branchId: null }, { branchId: { in: allowedBranchIds } }] }
            : {}),
          dateFrom: { lt: to },
          dateTo: { gte: from },
          status: { in: ['DRAFT', 'CALCULATED'] },
        },
      }),
      this.database.payrollRule.findMany({
        where: {
          ...(allowedBranchIds ? { branchId: { in: allowedBranchIds } } : {}),
          coachId: trainerId,
          isActive: true,
          validFrom: { lt: to },
          OR: [{ validTo: null }, { validTo: { gte: from } }],
        },
      }),
      this.database.trainerPayoutRule.findMany({
        select: { effectiveFrom: true },
        where: { effectiveFrom: { lt: to }, trainerId },
      }),
    ]);

    const actualCompleted = periodLessons.filter(
      (lesson) =>
        (lesson.substitution?.substituteTrainerId ?? lesson.coachId) === trainerId &&
        lesson.status !== 'CANCELLED' &&
        lesson.startsAt < new Date(),
    );
    const attendanceCompleted = actualCompleted.filter((lesson) => lesson.attendanceCompletedAt);
    const presentTotal = attendanceCompleted.reduce(
      (sum, lesson) =>
        sum +
        lesson.attendance.filter(({ status }) => status === 'PRESENT' || status === 'LATE').length,
      0,
    );
    const attendanceTotal = attendanceCompleted.reduce(
      (sum, lesson) => sum + lesson.attendance.length,
      0,
    );
    const pendingAttendance = actualCompleted.filter((lesson) => {
      if (lesson.attendanceCompletedAt) return false;
      const mutablePeriod = payrollPeriods.some(
        (period) =>
          (!period.branchId || period.branchId === lesson.branchId) &&
          period.dateFrom <= lesson.startsAt &&
          period.dateTo >= lesson.startsAt,
      );
      if (!mutablePeriod) return false;
      return (
        payoutRules.some(({ effectiveFrom }) => effectiveFrom <= lesson.startsAt) ||
        payrollRules.some(
          (rule) =>
            rule.type !== 'FIXED_MONTHLY' &&
            rule.branchId === lesson.branchId &&
            (!rule.groupId || rule.groupId === lesson.groupId) &&
            rule.validFrom <= lesson.startsAt &&
            (!rule.validTo || rule.validTo >= lesson.startsAt),
        )
      );
    });

    const groupAttendance = await this.database.attendance.findMany({
      select: { lesson: { select: { groupId: true } }, status: true },
      where: {
        lesson: {
          ...scope,
          groupId: { in: groups.map(({ id }) => id) },
          startsAt: { gte: recentFrom, lt: todayTo },
          status: 'COMPLETED',
        },
      },
    });
    const attention: TrainerProfileOverview['attention'] = [];
    if (pendingAttendance.length)
      attention.push({
        actionRoute: '/payroll',
        code: 'PENDING_ATTENDANCE',
        message: `${String(pendingAttendance.length)} занятия требуют заполнения посещаемости`,
        tone: 'warning',
      });
    const futureSubstitutions = substitutions.filter(({ lesson }) => lesson.startsAt >= new Date());
    if (futureSubstitutions.length)
      attention.push({
        actionRoute: '/schedule',
        code: 'UPCOMING_SUBSTITUTION',
        message: `Предстоящие замены: ${String(futureSubstitutions.length)}`,
        tone: 'info',
      });
    if (!trainer.isActive && (upcomingLessons.length || schedules.length))
      attention.push({
        actionRoute: '/schedule',
        code: 'INACTIVE_ASSIGNED',
        message: 'Неактивный тренер назначен на будущие занятия или расписание.',
        tone: 'danger',
      });

    const visibleBranches = trainer.branchAssignments
      .filter(({ branchId }) => !allowedBranchIds || allowedBranchIds.includes(branchId))
      .map(({ branch, branchId }) => ({ id: branchId, name: branch.name }));
    const statuses = [...new Set(accruals.map(({ payrollPeriod }) => payrollPeriod.status))];
    const permissions = {
      canManageTrainer: actor.role === 'OWNER' || actor.role === 'ADMIN',
      canResetPassword: actor.role === 'OWNER' || actor.role === 'ADMIN',
      ownProfile: actor.id === trainerId,
    };

    return {
      activity: {
        cancelled: periodLessons.filter(({ status }) => status === 'CANCELLED').length,
        conducted: actualCompleted.length,
        scheduled: periodLessons.length,
        substitutionsConducted: actualCompleted.filter(
          ({ substitution }) => substitution?.substituteTrainerId === trainerId,
        ).length,
      },
      attendance: {
        averagePresent: attendanceCompleted.length
          ? Math.round((presentTotal / attendanceCompleted.length) * 10) / 10
          : 0,
        completedLessons: attendanceCompleted.length,
        percentage: attendanceTotal ? Math.round((presentTotal / attendanceTotal) * 100) : 0,
        presentTotal,
      },
      attention,
      groups: groups.map((group) => {
        const attendance = groupAttendance.filter(({ lesson }) => lesson.groupId === group.id);
        const present = attendance.filter(({ status }) => status === 'PRESENT').length;
        return {
          attendancePercentage: attendance.length
            ? Math.round((present / attendance.length) * 100)
            : 0,
          branchId: group.branchId,
          branchName: group.branch.name,
          direction: group.direction,
          id: group.id,
          name: group.name,
          nextLesson: group.lessons[0] ? lessonView(group.lessons[0]) : undefined,
          schedule: group.schedules.map(
            (item) =>
              `${WEEKDAYS[item.weekday] ?? String(item.weekday)} · ${item.startTime}–${item.endTime}`,
          ),
          status: group.status,
          studentCount: group.enrollments.length,
        };
      }),
      historicalGroups: historicalGroups.map((group) => ({
        attendancePercentage: 0,
        branchId: group.branchId,
        branchName: group.branch.name,
        direction: group.direction,
        id: group.id,
        name: group.name,
        schedule: [],
        status: group.status,
        studentCount: group._count.enrollments,
      })),
      payroll: {
        accruedAmount: accruals.reduce((sum, item) => sum + item.finalAmount, 0),
        approvedAmount: accruals
          .filter(({ payrollPeriod }) => ['APPROVED', 'PAID'].includes(payrollPeriod.status))
          .reduce((sum, item) => sum + item.finalAmount, 0),
        details: accruals.map((item) => ({
          attendeeCount: item.attendeeCount ?? undefined,
          branchName: item.branch.name,
          calculatedAmount: item.calculatedAmount,
          finalAmount: item.finalAmount,
          groupName: item.group?.name,
          id: item.id,
          lessonId: item.lessonId ?? undefined,
          lessonStartsAt: item.lesson?.startsAt.toISOString(),
          periodStatus: item.payrollPeriod.status,
          payoutAmount: item.payoutAmount ?? undefined,
          payoutCategory: item.payoutCategory ?? undefined,
          payoutMode: item.payoutMode ?? undefined,
          payoutPercentage:
            item.payoutPercentageBasisPoints === null
              ? undefined
              : item.payoutPercentageBasisPoints / 100,
          rate: item.baseAmount,
          type: item.type,
        })),
        lessonsIncluded: new Set(accruals.flatMap(({ lessonId }) => (lessonId ? [lessonId] : [])))
          .size,
        paidAmount: accruals
          .filter(({ payrollPeriod }) => payrollPeriod.status === 'PAID')
          .reduce((sum, item) => sum + item.finalAmount, 0),
        pendingAttendanceCount: pendingAttendance.length,
        presentCount: accruals.reduce((sum, item) => sum + (item.attendeeCount ?? 0), 0),
        statuses,
      },
      period: {
        dateFrom: from.toISOString(),
        dateTo: new Date(to.getTime() - 1).toISOString(),
        month,
      },
      permissions,
      schedule: schedules.map((item) => ({
        branchId: item.branchId,
        branchName: item.branch.name,
        endTime: item.endTime,
        groupId: item.groupId,
        groupName: item.group.name,
        id: item.id,
        roomName: item.roomEntity?.name ?? item.room ?? undefined,
        startTime: item.startTime,
        weekday: item.weekday,
      })),
      substitutions: {
        incoming: substitutions
          .filter(({ substituteTrainerId }) => substituteTrainerId === trainerId)
          .map(substitutionView),
        outgoing: substitutions
          .filter(({ originalTrainerId }) => originalTrainerId === trainerId)
          .map(substitutionView),
      },
      today: todayLessons.map(lessonView),
      trainer: {
        branches: visibleBranches,
        directions: [...new Set(groups.map(({ direction }) => direction))],
        email: trainer.email,
        fullName: trainer.fullName,
        id: trainer.id,
        isActive: trainer.isActive,
        phone: trainer.phone ?? undefined,
        trainerDescription: trainer.trainerDescription ?? undefined,
      },
      upcomingLessons: upcomingLessons.map(lessonView),
    };
  }

  private async assertProfileAccess(
    actor: AuthenticatedUser,
    trainerId: string,
    trainerBranchIds: string[],
  ): Promise<void> {
    if (actor.role === 'OWNER') return;
    if (actor.role === 'COACH') {
      if (actor.id !== trainerId)
        throw new DomainError('AUTHORIZATION', 'Профиль другого тренера недоступен.');
      return;
    }
    const branchIds = accessibleBranchIds(actor);
    if (!branchIds) return;
    if (trainerBranchIds.some((branchId) => branchIds.includes(branchId))) return;
    const related = await this.database.danceGroup.count({
      where: { branchId: { in: branchIds }, coachId: trainerId },
    });
    if (!related)
      throw new DomainError('AUTHORIZATION', 'Профиль тренера недоступен в выбранных филиалах.');
  }
}
