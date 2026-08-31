import type {
  AttentionFilters,
  AttentionItem,
  AttentionSeverity,
  AttentionSummary,
} from '@arava/shared';
import { RETENTION_RULES } from '@arava/shared';

import type { DatabaseClient } from './index';
import { ATTENTION_RULES, DAY_MS, isExpiringSoon } from './attention-rules';
import { accessibleBranchIds, assertBranchAccess } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';
import { AUTO_RESOLVE_LWW_ENTITY_TYPES } from './sync-conflict-policy';

const ACTIVE_ENROLLMENTS = ['ACTIVE', 'TRIAL', 'FROZEN'] as const;
const ACTIVE_SUBSCRIPTIONS = ['ACTIVE', 'FROZEN'] as const;
const SEVERITY_ORDER: Record<AttentionSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

function fullName(person: {
  firstName: string;
  lastName: string;
  middleName: string | null;
}): string {
  return [person.lastName, person.firstName, person.middleName].filter(Boolean).join(' ');
}

function dateRoute(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function paymentNet(payment: {
  amount: number;
  status: string;
  refunds: { amount: number }[];
}): number {
  if (payment.status === 'CANCELLED') return 0;
  return payment.amount - payment.refunds.reduce((sum, refund) => sum + refund.amount, 0);
}

export class AttentionService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listItems(token: string, filters: AttentionFilters = {}): Promise<AttentionItem[]> {
    const actor = await this.application.authenticate(token);
    if (actor.role === 'COACH')
      throw new DomainError('AUTHORIZATION', 'Центр внимания доступен только руководителям.');
    if (filters.branchId) assertBranchAccess(actor, filters.branchId);
    const accessible = accessibleBranchIds(actor);
    const branchIds = filters.branchId ? [filters.branchId] : accessible;
    const branchScope = branchIds ? { branchId: { in: branchIds } } : {};
    const now = this.now();
    const historyStart = new Date(now.getTime() - ATTENTION_RULES.operationalHistoryDays * DAY_MS);
    const attendanceCutoff = new Date(
      now.getTime() - ATTENTION_RULES.attendanceGraceMinutes * 60_000,
    );
    const horizon = new Date(now.getTime() + ATTENTION_RULES.operationalHorizonDays * DAY_MS);
    const substitutionHorizon = new Date(
      now.getTime() + ATTENTION_RULES.substitutionHorizonDays * DAY_MS,
    );

    const [students, archivedStudents, lessons, closures, scheduleIssues, substitutions, periods] =
      await Promise.all([
        this.database.student.findMany({
          include: {
            branch: { select: { name: true } },
            enrollments: {
              select: {
                group: { select: { name: true } },
                groupId: true,
                id: true,
                joinedAt: true,
                leftAt: true,
                status: true,
              },
              where: { leftAt: null, status: { in: [...ACTIVE_ENROLLMENTS] } },
            },
            membershipCards: {
              orderBy: { updatedAt: 'desc' },
              select: { id: true, status: true },
              take: 1,
              where: { archivedAt: null },
            },
            payments: {
              orderBy: { paidAt: 'desc' },
              select: { paidAt: true },
              take: 1,
              where: { status: { not: 'CANCELLED' } },
            },
            subscriptions: {
              include: {
                payments: {
                  select: {
                    amount: true,
                    refunds: { select: { amount: true } },
                    status: true,
                  },
                },
                tariff: { select: { name: true } },
              },
              orderBy: { startsAt: 'desc' },
            },
          },
          where: { ...branchScope, archivedAt: null, status: { not: 'ARCHIVED' } },
        }),
        this.database.student.findMany({
          include: {
            branch: { select: { name: true } },
            enrollments: {
              select: { id: true },
              where: { leftAt: null, status: { in: [...ACTIVE_ENROLLMENTS] } },
            },
          },
          where: {
            ...branchScope,
            OR: [{ archivedAt: { not: null } }, { status: 'ARCHIVED' }],
            enrollments: { some: { leftAt: null, status: { in: [...ACTIVE_ENROLLMENTS] } } },
          },
        }),
        this.database.lesson.findMany({
          include: {
            branch: { select: { name: true } },
            coach: { select: { fullName: true } },
            group: { select: { name: true } },
            roomEntity: { select: { name: true } },
          },
          orderBy: { endsAt: 'desc' },
          where: {
            ...branchScope,
            attendanceCompletedAt: null,
            endsAt: { gte: historyStart, lte: attendanceCutoff },
            status: { in: ['PLANNED', 'COMPLETED'] },
          },
        }),
        this.database.roomClosure.findMany({
          include: {
            room: {
              include: {
                branch: { select: { name: true } },
                lessons: {
                  select: { endsAt: true, id: true, startsAt: true },
                  where: {
                    endsAt: { gt: now },
                    startsAt: { lt: horizon },
                    status: { not: 'CANCELLED' },
                  },
                },
                rentals: {
                  select: { endAt: true, id: true, startAt: true },
                  where: { endAt: { gt: now }, startAt: { lt: horizon }, status: 'ACTIVE' },
                },
              },
            },
          },
          where: {
            endAt: { gt: now },
            startAt: { lt: horizon },
            room: branchIds ? { branchId: { in: branchIds } } : {},
          },
        }),
        this.database.lesson.findMany({
          include: {
            branch: { select: { name: true } },
            group: { select: { name: true } },
            roomEntity: { select: { archivedAt: true, isActive: true, name: true } },
          },
          where: {
            ...branchScope,
            startsAt: { gte: now, lte: horizon },
            status: 'PLANNED',
            OR: [
              { roomId: null },
              { roomEntity: { is: { isActive: false } } },
              { roomEntity: { is: { archivedAt: { not: null } } } },
            ],
          },
        }),
        this.database.trainerSubstitution.findMany({
          include: {
            lesson: {
              include: {
                branch: { select: { name: true } },
                group: { select: { name: true } },
                roomEntity: { select: { name: true } },
              },
            },
            originalTrainer: { select: { fullName: true } },
            substituteTrainer: { select: { fullName: true } },
          },
          where: {
            lesson: {
              ...(branchIds ? { branchId: { in: branchIds } } : {}),
              startsAt: { gte: now, lte: substitutionHorizon },
              status: { not: 'CANCELLED' },
            },
          },
        }),
        this.database.payrollPeriod.findMany({
          include: { branch: { select: { name: true } } },
          where: {
            status: { in: ['DRAFT', 'CALCULATED'] },
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
          },
        }),
      ]);
    const backupSettings =
      actor.role === 'OWNER'
        ? await this.database.appSetting.findMany({
            where: { key: { startsWith: 'backup.' } },
          })
        : [];
    const backupSetting = new Map(backupSettings.map(({ key, value }) => [key, value]));
    const failedPaymentOperations = await this.database.paymentOperation.findMany({
      include: {
        branch: { select: { name: true } },
        student: { select: { firstName: true, lastName: true, middleName: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      where: {
        ...branchScope,
        OR: [{ status: { in: ['FAILED', 'EXPIRED'] } }, { saleFinalizationError: { not: null } }],
        updatedAt: { gte: historyStart },
      },
    });
    const trialAttention = await this.database.trialAppointment.findMany({
      include: {
        group: { include: { branch: { select: { name: true } } } },
        lesson: {
          include: { attendance: { select: { status: true, studentId: true } } },
        },
        student: { select: { firstName: true, lastName: true } },
      },
      where: {
        status: 'BOOKED',
        supersededAt: null,
        group: branchIds ? { branchId: { in: branchIds } } : {},
        OR: [
          {
            outcome: null,
            lesson: {
              endsAt: {
                lte: new Date(
                  now.getTime() - RETENTION_RULES.trialOutcomeGraceHours * 60 * 60 * 1000,
                ),
              },
            },
          },
          { outcome: null, lesson: { status: 'CANCELLED' } },
          {
            outcome: 'THINKING',
            updatedAt: {
              lte: new Date(now.getTime() - RETENTION_RULES.thinkingFollowUpHours * 60 * 60 * 1000),
            },
          },
          { outcome: 'NO_SHOW' },
        ],
      },
    });
    const retentionGroupIds = [
      ...new Set(
        students.flatMap((student) =>
          student.enrollments
            .filter(({ status }) => status === 'ACTIVE')
            .map(({ groupId }) => groupId),
        ),
      ),
    ];
    const retentionLessons = retentionGroupIds.length
      ? await this.database.lesson.findMany({
          include: { attendance: { select: { status: true, studentId: true } } },
          orderBy: { startsAt: 'desc' },
          where: {
            endsAt: { gte: historyStart, lte: now },
            groupId: { in: retentionGroupIds },
            status: { not: 'CANCELLED' },
          },
        })
      : [];
    const retentionLessonsByGroup = new Map<string, typeof retentionLessons>();
    for (const lesson of retentionLessons) {
      const groupLessons = retentionLessonsByGroup.get(lesson.groupId) ?? [];
      groupLessons.push(lesson);
      retentionLessonsByGroup.set(lesson.groupId, groupLessons);
    }
    const uncoveredAttendanceCandidates = await this.database.attendance.findMany({
      include: {
        lesson: {
          include: {
            branch: { select: { name: true } },
            group: { select: { name: true } },
            trialAppointments: { select: { status: true, studentId: true, supersededAt: true } },
          },
        },
        student: { select: { firstName: true, lastName: true, middleName: true } },
      },
      orderBy: { markedAt: 'desc' },
      take: 100,
      where: {
        directPaymentId: null,
        directPaymentOperationId: null,
        lesson: {
          ...(branchIds ? { branchId: { in: branchIds } } : {}),
          status: { not: 'CANCELLED' },
        },
        status: { in: ['PRESENT', 'LATE'] },
      },
    });
    const uncoveredAttendanceIds = uncoveredAttendanceCandidates.map(
      ({ lessonId, studentId }) => `${lessonId}:${studentId}`,
    );
    const attendanceWriteOffs = uncoveredAttendanceIds.length
      ? await this.database.subscriptionLedger.findMany({
          include: { reversals: { select: { id: true } } },
          where: { attendanceId: { in: uncoveredAttendanceIds }, type: 'LESSON_WRITE_OFF' },
        })
      : [];
    const subscriptionCoveredAttendanceIds = new Set(
      attendanceWriteOffs.flatMap(({ attendanceId, reversals }) =>
        attendanceId && reversals.length === 0 ? [attendanceId] : [],
      ),
    );

    const items: AttentionItem[] = [];
    const add = (item: AttentionItem) => items.push(item);

    for (const trial of trialAttention) {
      const attendance = trial.studentId
        ? trial.lesson.attendance.find(({ studentId }) => studentId === trial.studentId)
        : null;
      const missed = attendance?.status === 'ABSENT' || attendance?.status === 'EXCUSED';
      const cancelled = trial.lesson.status === 'CANCELLED';
      const thinking = trial.outcome === 'THINKING';
      const noShow = trial.outcome === 'NO_SHOW' || missed;
      add({
        actionLabel:
          cancelled || noShow
            ? 'Перенести пробное'
            : trial.studentId
              ? 'Открыть ученика'
              : 'Открыть заявку',
        actionRoute: trial.studentId
          ? `/students/${trial.studentId}`
          : `/leads?leadId=${encodeURIComponent(trial.externalLeadId)}`,
        branchId: trial.group.branchId,
        branchName: trial.group.branch.name,
        category: 'TRIALS',
        description: `${trial.group.name} · ${trial.lesson.startsAt.toLocaleString('ru-RU')}`,
        entityId: trial.id,
        entityType: 'TrialAppointment',
        id: `trial:${cancelled ? 'reschedule' : noShow ? 'missed' : thinking ? 'thinking' : 'outcome'}:${trial.id}`,
        occurredAt: trial.lesson.endsAt.toISOString(),
        severity: cancelled || noShow ? 'WARNING' : thinking ? 'INFO' : 'WARNING',
        title: cancelled
          ? 'Пробное занятие отменено — выберите новую дату'
          : noShow
            ? `${trial.student ? `${trial.student.firstName} ${trial.student.lastName}` : 'Клиент'} не пришёл на пробное`
            : thinking
              ? 'Клиент думает после пробного'
              : 'Пробное прошло — укажите результат',
      });
    }

    const absenceStudents = new Set<string>();
    for (const student of students) {
      const name = fullName(student);
      const common = { branchId: student.branchId, branchName: student.branch.name };
      const retentionEligible =
        student.status === 'ACTIVE' &&
        student.enrollments.some(({ status }) => status === 'ACTIVE');
      if (!student.enrollments.length)
        add({
          ...common,
          actionLabel: 'Открыть ученика',
          actionRoute: `/students/${student.id}`,
          category: 'STUDENTS',
          description: `${name} не состоит ни в одной активной группе.`,
          entityId: student.id,
          entityType: 'Student',
          id: `student:no-group:${student.id}`,
          severity: 'WARNING',
          title: 'Ученик без группы',
        });

      const activeSubscriptions = student.subscriptions.filter(
        (subscription) =>
          ACTIVE_SUBSCRIPTIONS.includes(
            subscription.status as (typeof ACTIVE_SUBSCRIPTIONS)[number],
          ) &&
          subscription.startsAt <= now &&
          (!subscription.expiresAt || subscription.expiresAt >= now),
      );
      const paidUpcomingSubscriptions = student.subscriptions.filter((subscription) => {
        const paid = subscription.payments.reduce((sum, payment) => sum + paymentNet(payment), 0);
        return subscription.status === 'PENDING' && paid >= subscription.salePrice;
      });
      const paidNextFor = (subscriptionId: string) =>
        paidUpcomingSubscriptions.some(
          ({ sequenceAfterSubscriptionId }) => sequenceAfterSubscriptionId === subscriptionId,
        );
      const recentlyExpired = student.subscriptions.find(
        (subscription) =>
          subscription.expiresAt &&
          subscription.expiresAt < now &&
          subscription.expiresAt >=
            new Date(now.getTime() - ATTENTION_RULES.recentlyExpiredDays * DAY_MS),
      );
      const recentlyUsedUp = student.subscriptions.find(
        (subscription) =>
          subscription.status === 'USED_UP' &&
          subscription.lessonLimit !== null &&
          subscription.lessonsUsed >= subscription.lessonLimit &&
          subscription.updatedAt >= historyStart,
      );
      const endedSubscription = [recentlyExpired, recentlyUsedUp]
        .filter((subscription): subscription is NonNullable<typeof subscription> =>
          Boolean(subscription),
        )
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
      if (
        student.status === 'ACTIVE' &&
        !activeSubscriptions.length &&
        !paidUpcomingSubscriptions.length &&
        !recentlyExpired &&
        !recentlyUsedUp
      )
        add({
          ...common,
          actionLabel: 'Оформить абонемент',
          actionRoute: `/students/${student.id}?action=subscription`,
          category: 'SUBSCRIPTIONS',
          description: `У ${name} нет действующего абонемента.`,
          entityId: student.id,
          entityType: 'Student',
          id: `student:no-subscription:${student.id}`,
          severity: 'WARNING',
          title: 'Нет активного абонемента',
        });

      for (const subscription of activeSubscriptions) {
        const renewalAlreadyPaid = paidNextFor(subscription.id);
        const paid = subscription.payments.reduce((sum, payment) => sum + paymentNet(payment), 0);
        if (
          actor.role === 'OWNER' &&
          (subscription.payments.length === 0 || paid < subscription.salePrice)
        )
          add({
            ...common,
            actionLabel: 'Проверить историю',
            actionRoute: `/students/${student.id}?section=subscription`,
            category: 'PAYMENTS',
            description: `Абонемент «${subscription.tariff.name}» сохранён как действующий, но подтверждённая полная оплата не найдена. Запись не изменена; проверьте историю продажи вручную.`,
            entityId: subscription.id,
            entityType: 'Subscription',
            id: `subscription:payment-integrity:${subscription.id}`,
            occurredAt: subscription.updatedAt.toISOString(),
            severity: 'CRITICAL',
            title: `${name}: активный абонемент без полной оплаты`,
          });
        const remaining =
          subscription.lessonLimit === null
            ? undefined
            : Math.max(0, subscription.lessonLimit - subscription.lessonsUsed);
        if (remaining === 0 && !renewalAlreadyPaid)
          add({
            ...common,
            actionLabel: 'Продлить абонемент',
            actionRoute: `/students/${student.id}?action=subscription&renewalOf=${subscription.id}`,
            category: 'SUBSCRIPTIONS',
            description: `В абонементе «${subscription.tariff.name}» не осталось занятий.`,
            entityId: subscription.id,
            entityType: 'Subscription',
            id: `subscription:zero:${subscription.id}`,
            severity: 'CRITICAL',
            title: `${name}: занятия закончились`,
          });
        else if (
          remaining === RETENTION_RULES.lowSubscriptionRemainingLessons &&
          !renewalAlreadyPaid
        )
          add({
            ...common,
            actionLabel: 'Продлить абонемент',
            actionRoute: `/students/${student.id}?action=subscription&renewalOf=${subscription.id}`,
            category: 'SUBSCRIPTIONS',
            description: `В абонементе «${subscription.tariff.name}» осталось 1 занятие.`,
            entityId: subscription.id,
            entityType: 'Subscription',
            id: `subscription:low:${subscription.id}`,
            severity: 'WARNING',
            title: `${name}: осталось 1 занятие`,
          });
        if (
          !renewalAlreadyPaid &&
          subscription.expiresAt &&
          isExpiringSoon(subscription.expiresAt, now)
        )
          add({
            ...common,
            actionLabel: 'Продлить абонемент',
            actionRoute: `/students/${student.id}?action=subscription&renewalOf=${subscription.id}`,
            category: 'SUBSCRIPTIONS',
            description: `Абонемент «${subscription.tariff.name}» заканчивается ${subscription.expiresAt.toLocaleDateString('ru-RU')}.`,
            dueAt: subscription.expiresAt.toISOString(),
            entityId: subscription.id,
            entityType: 'Subscription',
            id: `subscription:expiring:${subscription.id}`,
            severity: 'WARNING',
            title: `${name}: абонемент заканчивается`,
          });
      }

      if (
        retentionEligible &&
        !activeSubscriptions.length &&
        !paidUpcomingSubscriptions.length &&
        endedSubscription
      ) {
        const expiredByDate = endedSubscription.status !== 'USED_UP';
        const endedOn = endedSubscription.expiresAt
          ? endedSubscription.expiresAt.toLocaleDateString('ru-RU')
          : endedSubscription.updatedAt.toLocaleDateString('ru-RU');
        add({
          ...common,
          actionLabel: 'Продлить абонемент',
          actionRoute: `/students/${student.id}?action=subscription&renewalOf=${endedSubscription.id}`,
          category: 'SUBSCRIPTIONS',
          description: `Абонемент «${endedSubscription.tariff.name}» закончился ${endedOn}.`,
          dueAt: endedSubscription.expiresAt?.toISOString(),
          entityId: endedSubscription.id,
          entityType: 'Subscription',
          id: `subscription:ended:${student.id}`,
          occurredAt: endedSubscription.updatedAt.toISOString(),
          severity: 'WARNING',
          title: `${name}: абонемент ${expiredByDate ? 'истёк' : 'закончился'}`,
        });
      }

      if (retentionEligible && !absenceStudents.has(student.id)) {
        const absence = student.enrollments
          .filter(({ status }) => status === 'ACTIVE')
          .map((enrollment) => {
            const latest = (retentionLessonsByGroup.get(enrollment.groupId) ?? [])
              .filter(
                (lesson) =>
                  lesson.groupId === enrollment.groupId && lesson.startsAt >= enrollment.joinedAt,
              )
              .slice(0, RETENTION_RULES.consecutiveAbsenceCount);
            const consecutive =
              latest.length === RETENTION_RULES.consecutiveAbsenceCount &&
              latest.every(
                (lesson) =>
                  lesson.attendance.find(({ studentId }) => studentId === student.id)?.status ===
                  'ABSENT',
              );
            return consecutive ? { enrollment, latest } : undefined;
          })
          .find(Boolean);
        if (absence) {
          absenceStudents.add(student.id);
          add({
            ...common,
            actionLabel: 'Открыть посещаемость',
            actionRoute: `/students/${student.id}?section=attendance`,
            category: 'ATTENDANCE',
            description: `${absence.enrollment.group.name} · три последних состоявшихся занятия отмечены как пропуски.`,
            entityId: student.id,
            entityType: 'Student',
            id: `attendance:retention:${student.id}`,
            occurredAt: absence.latest[0]?.startsAt.toISOString(),
            severity: 'WARNING',
            title: `${name}: не был на последних 3 занятиях`,
          });
        }
      }

      const debt = student.subscriptions.reduce(
        (sum, subscription) =>
          sum +
          Math.max(
            0,
            subscription.salePrice -
              subscription.payments.reduce((paid, payment) => paid + paymentNet(payment), 0),
          ),
        0,
      );
      if (debt > 0)
        add({
          ...common,
          actionLabel: 'Принять оплату',
          actionRoute: `/students/${student.id}?action=payment`,
          category: 'PAYMENTS',
          description: `Задолженность ${new Intl.NumberFormat('ru-RU').format(debt / 100)} ₽${student.payments[0] ? `, последняя оплата ${student.payments[0].paidAt.toLocaleDateString('ru-RU')}` : ''}.`,
          entityId: student.id,
          entityType: 'Student',
          id: `student:debt:${student.id}`,
          occurredAt: student.payments[0]?.paidAt.toISOString(),
          severity: 'WARNING',
          title: `${name}: есть задолженность`,
        });

      const card = student.membershipCards[0];
      if (card?.status === 'LOST' || card?.status === 'BLOCKED')
        add({
          ...common,
          actionLabel: 'Открыть ученика',
          actionRoute: `/students/${student.id}?section=card`,
          category: 'CARDS',
          description:
            card.status === 'LOST' ? 'Карта отмечена как утерянная.' : 'Карта заблокирована.',
          entityId: card.id,
          entityType: 'MembershipCard',
          id: `card:${card.status.toLowerCase()}:${card.id}`,
          severity: 'WARNING',
          title: `${name}: ${card.status === 'LOST' ? 'карта потеряна' : 'карта заблокирована'}`,
        });
    }

    for (const student of archivedStudents)
      add({
        actionLabel: 'Открыть ученика',
        actionRoute: `/students/${student.id}`,
        branchId: student.branchId,
        branchName: student.branch.name,
        category: 'STUDENTS',
        description: `Архивный профиль ${fullName(student)} остаётся в активной группе.`,
        entityId: student.id,
        entityType: 'Student',
        id: `student:archived-active:${student.id}`,
        severity: 'CRITICAL',
        title: 'Архивный ученик в активных данных',
      });

    for (const operation of failedPaymentOperations)
      add({
        actionLabel: 'Открыть оплату',
        actionRoute: `/students/${operation.studentId}?paymentOperationId=${operation.id}`,
        branchId: operation.branchId,
        branchName: operation.branch.name,
        category: 'PAYMENTS',
        description: operation.saleFinalizationError
          ? 'Оплата подтверждена, но выдача абонемента ещё не завершена. Безопасно проверьте оплату повторно.'
          : operation.status === 'EXPIRED'
            ? 'Время ожидания оплаты истекло. Откройте операцию, чтобы проверить состояние.'
            : 'Оплата не завершена. Откройте операцию, чтобы проверить состояние или повторить попытку.',
        entityId: operation.id,
        entityType: 'PaymentOperation',
        id: `payment-operation:${operation.saleFinalizationError ? 'sale-finalization' : operation.status.toLowerCase()}:${operation.id}`,
        occurredAt: operation.updatedAt.toISOString(),
        severity: 'CRITICAL',
        title: operation.saleFinalizationError
          ? `${fullName(operation.student)}: оплата получена, абонемент не выдан`
          : `${fullName(operation.student)}: проблема оплаты`,
      });

    for (const attendance of uncoveredAttendanceCandidates) {
      const attendanceId = `${attendance.lessonId}:${attendance.studentId}`;
      if (
        attendance.lesson.trialAppointments.some(
          (trial) =>
            trial.status === 'BOOKED' &&
            !trial.supersededAt &&
            trial.studentId === attendance.studentId,
        )
      )
        continue;
      if (subscriptionCoveredAttendanceIds.has(attendanceId)) continue;
      add({
        actionLabel: 'Оплатить посещение',
        actionRoute: `/students/${attendance.studentId}?action=attendance-payment&lessonId=${attendance.lessonId}`,
        branchId: attendance.lesson.branchId,
        branchName: attendance.lesson.branch.name,
        category: 'SUBSCRIPTIONS',
        description: `${attendance.lesson.group.name} · ${attendance.lesson.startsAt.toLocaleString('ru-RU')}.`,
        entityId: attendanceId,
        entityType: 'Attendance',
        id: `attendance:uncovered:${attendanceId}`,
        occurredAt: attendance.markedAt.toISOString(),
        severity: 'WARNING',
        title: `${fullName(attendance.student)}: посещение без покрытия`,
      });
    }

    for (const lesson of lessons)
      add({
        actionLabel: 'Заполнить посещаемость',
        actionRoute: `/attendance/${lesson.id}`,
        branchId: lesson.branchId,
        branchName: lesson.branch.name,
        category: 'ATTENDANCE',
        description: `${lesson.group.name} · ${lesson.startsAt.toLocaleString('ru-RU')} · ${lesson.coach?.fullName ?? 'Тренер не назначен'} · ${lesson.roomEntity?.name ?? lesson.room ?? 'Зал не указан'}.`,
        dueAt: lesson.endsAt.toISOString(),
        entityId: lesson.id,
        entityType: 'Lesson',
        id: `lesson:attendance:${lesson.id}`,
        severity: 'WARNING',
        title: 'Не заполнена посещаемость',
      });

    for (const closure of closures) {
      const affectedLessons = closure.room.lessons.filter(
        (lesson) => lesson.startsAt < closure.endAt && lesson.endsAt > closure.startAt,
      );
      const affectedRentals = closure.room.rentals.filter(
        (rental) => rental.startAt < closure.endAt && rental.endAt > closure.startAt,
      );
      if (!affectedLessons.length && !affectedRentals.length) continue;
      const today = closure.startAt.toDateString() === now.toDateString();
      add({
        actionLabel: 'Открыть расписание',
        actionRoute: `/schedule?branchId=${closure.room.branchId}&date=${dateRoute(closure.startAt)}&roomId=${closure.roomId}`,
        branchId: closure.room.branchId,
        branchName: closure.room.branch.name,
        category: 'ROOMS',
        description: `${closure.room.name}: затронуто занятий — ${String(affectedLessons.length)}, аренд — ${String(affectedRentals.length)}. ${closure.reason}`,
        dueAt: closure.startAt.toISOString(),
        entityId: closure.id,
        entityType: 'RoomClosure',
        id: `room:closure:${closure.id}`,
        severity: today ? 'CRITICAL' : 'WARNING',
        title: 'Зал временно закрыт',
      });
    }

    for (const lesson of scheduleIssues)
      add({
        actionLabel: 'Открыть занятие',
        actionRoute: `/lessons/${lesson.id}`,
        branchId: lesson.branchId,
        branchName: lesson.branch.name,
        category: 'SCHEDULE',
        description: `${lesson.group.name} · ${lesson.startsAt.toLocaleString('ru-RU')}${lesson.roomEntity ? ` · ${lesson.roomEntity.name}` : ''}.`,
        dueAt: lesson.startsAt.toISOString(),
        entityId: lesson.id,
        entityType: 'Lesson',
        id: `lesson:room:${lesson.id}`,
        severity: lesson.startsAt.toDateString() === now.toDateString() ? 'CRITICAL' : 'WARNING',
        title: lesson.roomId ? 'Занятие назначено в неактивный зал' : 'У занятия не указан зал',
      });

    for (const substitution of substitutions)
      add({
        actionLabel: 'Открыть занятие',
        actionRoute: `/lessons/${substitution.lessonId}`,
        branchId: substitution.lesson.branchId,
        branchName: substitution.lesson.branch.name,
        category: 'SUBSTITUTIONS',
        description: `${substitution.lesson.group.name} · ${substitution.lesson.startsAt.toLocaleString('ru-RU')} · ${substitution.originalTrainer?.fullName ?? 'Тренер не назначен'} → ${substitution.substituteTrainer.fullName} · ${substitution.lesson.roomEntity?.name ?? substitution.lesson.room ?? 'Зал не указан'}.`,
        dueAt: substitution.lesson.startsAt.toISOString(),
        entityId: substitution.id,
        entityType: 'TrainerSubstitution',
        id: `substitution:${substitution.id}`,
        severity: 'INFO',
        title: 'Запланирована замена тренера',
      });

    await this.appendPayrollItems(items, periods, branchIds, now);

    if (actor.role === 'OWNER') {
      const initializedAt = new Date(
        backupSetting.get('backup.initializedAt') ?? now.toISOString(),
      );
      const lastSuccessfulValue = backupSetting.get('backup.lastSuccessfulAt');
      const lastSuccessfulAt = lastSuccessfulValue ? new Date(lastSuccessfulValue) : undefined;
      const ageDays = lastSuccessfulAt
        ? (now.getTime() - lastSuccessfulAt.getTime()) / DAY_MS
        : undefined;
      const graceElapsed =
        now.getTime() - initializedAt.getTime() >=
        ATTENTION_RULES.backupInitialGraceHours * 60 * 60 * 1000;
      if (
        (!lastSuccessfulAt && graceElapsed) ||
        (ageDays ?? 0) > ATTENTION_RULES.backupWarningDays
      ) {
        const critical = !lastSuccessfulAt || (ageDays ?? 0) > ATTENTION_RULES.backupCriticalDays;
        add({
          actionLabel: 'Открыть настройки резервных копий',
          actionRoute: '/settings#backups',
          category: 'BACKUPS',
          description: lastSuccessfulAt
            ? `Последняя успешная копия создана ${lastSuccessfulAt.toLocaleString('ru-RU')}.`
            : 'После первоначального периода работы не создано ни одной исправной копии.',
          entityId: 'backup-health',
          entityType: 'Backup',
          id: 'backup:stale',
          occurredAt: lastSuccessfulAt?.toISOString(),
          severity: critical ? 'CRITICAL' : 'WARNING',
          title: critical ? 'Резервная копия давно не создавалась' : 'Пора создать резервную копию',
        });
      }
      const failures = Number(backupSetting.get('backup.consecutiveFailures')) || 0;
      if (failures >= ATTENTION_RULES.backupRepeatedFailures)
        add({
          actionLabel: 'Открыть настройки резервных копий',
          actionRoute: '/settings#backups',
          category: 'BACKUPS',
          description:
            backupSetting.get('backup.lastError') ??
            'Несколько автоматических попыток завершились ошибкой.',
          entityId: 'backup-automatic',
          entityType: 'Backup',
          id: 'backup:automatic-failures',
          occurredAt: backupSetting.get('backup.lastAttemptAt'),
          severity: failures >= 3 ? 'CRITICAL' : 'WARNING',
          title: 'Не удаётся создать автоматическую копию',
        });

      const [integrationSettings, failedSync, oldestPending, pendingCount, conflictCount] =
        await Promise.all([
          this.database.appSetting.findMany({ where: { key: { startsWith: 'integration.' } } }),
          this.database.syncOutbox.count({ where: { status: 'FAILED' } }),
          this.database.syncOutbox.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
            where: { status: { in: ['PENDING', 'PROCESSING'] } },
          }),
          this.database.syncOutbox.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
          this.database.syncConflict.count({
            where: {
              entityType: { notIn: [...AUTO_RESOLVE_LWW_ENTITY_TYPES] },
              status: 'OPEN',
            },
          }),
        ]);
      const integrationSetting = new Map(integrationSettings.map(({ key, value }) => [key, value]));
      if (integrationSetting.get('integration.enabled') === 'true') {
        const state = integrationSetting.get('integration.lastState');
        const oldestHours = oldestPending
          ? (now.getTime() - oldestPending.createdAt.getTime()) / (60 * 60 * 1000)
          : 0;
        if (state === 'AUTH_ERROR' || state === 'VERSION_UNSUPPORTED')
          add({
            actionLabel: 'Открыть настройки интеграции',
            actionRoute: '/settings#integration',
            category: 'INTEGRATION',
            description:
              state === 'AUTH_ERROR'
                ? 'Сервер отозвал доступ устройства. Требуется повторное подключение владельцем.'
                : 'Сайт не поддерживает текущую версию API интеграции.',
            entityId: 'integration-device',
            entityType: 'Integration',
            id: `integration:${state}`,
            severity: 'CRITICAL',
            title:
              state === 'AUTH_ERROR'
                ? 'Интеграция отключена сервером'
                : 'Требуется обновление интеграции',
          });
        else if (conflictCount > 0)
          add({
            actionLabel: 'Открыть диагностику',
            actionRoute: '/settings#integration',
            category: 'INTEGRATION',
            description: `Ошибок согласования: ${String(conflictCount)}. Обычные изменения CRM согласует автоматически.`,
            entityId: 'integration-conflicts',
            entityType: 'Integration',
            id: 'integration:conflicts',
            severity: 'CRITICAL',
            title: 'Ошибка согласования синхронизации',
          });
        else if (failedSync >= 3 || pendingCount >= 100 || oldestHours >= 24)
          add({
            actionLabel: 'Открыть журнал синхронизации',
            actionRoute: '/settings#integration',
            category: 'INTEGRATION',
            description: `Ожидают отправки: ${String(pendingCount)}. Ошибок: ${String(failedSync)}.`,
            entityId: 'integration-queue',
            entityType: 'Integration',
            id: 'integration:queue-health',
            occurredAt: oldestPending?.createdAt.toISOString(),
            severity:
              failedSync >= 10 || pendingCount >= 500 || oldestHours >= 72 ? 'CRITICAL' : 'WARNING',
            title: 'Проблема синхронизации с сайтом',
          });
      }
    }

    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    return items
      .filter((item) => !filters.category || item.category === filters.category)
      .filter((item) => !filters.severity || item.severity === filters.severity)
      .filter((item) => {
        if (!filters.relevance || filters.relevance === 'ALL' || !item.dueAt) return true;
        const dueAt = new Date(item.dueAt);
        return filters.relevance === 'TODAY' ? dueAt <= todayEnd : dueAt > todayEnd;
      })
      .sort(
        (left, right) =>
          SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
          (left.dueAt ?? left.occurredAt ?? '9999').localeCompare(
            right.dueAt ?? right.occurredAt ?? '9999',
          ) ||
          left.title.localeCompare(right.title, 'ru'),
      );
  }

  async getSummary(token: string): Promise<AttentionSummary> {
    const items = await this.listItems(token);
    const categories = [...new Set(items.map(({ category }) => category))].map((category) => ({
      category,
      count: items.filter((item) => item.category === category).length,
    }));
    return {
      categories,
      criticalCount: items.filter(({ severity }) => severity === 'CRITICAL').length,
      items: items.slice(0, 5),
      total: items.length,
    };
  }

  private async appendPayrollItems(
    items: AttentionItem[],
    periods: {
      branch: { name: string } | null;
      branchId: string | null;
      dateFrom: Date;
      dateTo: Date;
      id: string;
      status: string;
    }[],
    branchIds: string[] | undefined,
    now: Date,
  ): Promise<void> {
    if (!periods.length) return;
    const from = new Date(Math.min(...periods.map(({ dateFrom }) => dateFrom.getTime())));
    const to = new Date(Math.max(...periods.map(({ dateTo }) => dateTo.getTime())));
    const [lessons, rules] = await Promise.all([
      this.database.lesson.findMany({
        select: { branchId: true, coachId: true, groupId: true, id: true, startsAt: true },
        where: {
          ...(branchIds ? { branchId: { in: branchIds } } : {}),
          attendanceCompletedAt: null,
          coachId: { not: null },
          startsAt: { gte: from, lte: to },
          status: 'COMPLETED',
        },
      }),
      this.database.payrollRule.findMany({
        where: {
          ...(branchIds ? { branchId: { in: branchIds } } : {}),
          isActive: true,
          type: { not: 'FIXED_MONTHLY' },
          validFrom: { lte: to },
          OR: [{ validTo: null }, { validTo: { gte: from } }],
        },
      }),
    ]);
    for (const period of periods) {
      const pending = lessons.filter(
        (lesson) =>
          lesson.startsAt >= period.dateFrom &&
          lesson.startsAt <= period.dateTo &&
          (!period.branchId || lesson.branchId === period.branchId) &&
          rules.some(
            (rule) =>
              rule.coachId === lesson.coachId &&
              rule.branchId === lesson.branchId &&
              (!rule.groupId || rule.groupId === lesson.groupId) &&
              rule.validFrom <= lesson.startsAt &&
              (!rule.validTo || rule.validTo >= lesson.startsAt),
          ),
      );
      if (pending.length)
        items.push({
          actionLabel: 'Открыть расчёт зарплаты',
          actionRoute: `/payroll?periodId=${period.id}`,
          branchId: period.branchId ?? undefined,
          branchName: period.branch?.name,
          category: 'PAYROLL',
          description: `Посещаемость не завершена для ${String(pending.length)} занятий. Период нельзя утвердить.`,
          dueAt: period.dateTo.toISOString(),
          entityId: period.id,
          entityType: 'PayrollPeriod',
          id: `payroll:attendance:${period.id}`,
          severity: 'CRITICAL',
          title: 'Зарплата заблокирована посещаемостью',
        });
      else if (period.status === 'CALCULATED')
        items.push({
          actionLabel: 'Открыть расчёт зарплаты',
          actionRoute: `/payroll?periodId=${period.id}`,
          branchId: period.branchId ?? undefined,
          branchName: period.branch?.name,
          category: 'PAYROLL',
          description: `Расчёт за ${period.dateFrom.toLocaleDateString('ru-RU')} — ${period.dateTo.toLocaleDateString('ru-RU')} ожидает проверки.`,
          dueAt: period.dateTo.toISOString(),
          entityId: period.id,
          entityType: 'PayrollPeriod',
          id: `payroll:review:${period.id}`,
          severity: period.dateTo < now ? 'WARNING' : 'INFO',
          title: 'Расчёт зарплаты ожидает утверждения',
        });
    }
  }
}
