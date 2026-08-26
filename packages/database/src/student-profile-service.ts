import type {
  StudentNoteInput,
  StudentProfileActivity,
  StudentProfileNote,
  StudentProfileOverview,
  StudentProfilePrimaryAction,
  StudentProfileSubscription,
  StudentProfileWarning,
  StudentFinanceSummary,
  SubscriptionSummary,
  TrialAppointmentSummary,
} from '@arava/shared';

import type { DatabaseClient } from './index';
import { accessibleBranchIds, assertBranchAccess, assertPermission } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';
import { FinanceService } from './finance-service';
import { AttentionService } from './attention-service';
import { LessonOccurrenceService } from './lesson-occurrence-service';
import { deriveTrialWorkflowState } from './lead-service';

const UPCOMING_LIMIT = 5;
const RECENT_LIMIT = 5;
const ATTENDANCE_PERIOD_DAYS = 90;
const UPCOMING_PERIOD_DAYS = 8;
const WEEKDAYS = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function noteSummary(note: {
  archivedAt: Date | null;
  author: { fullName: string };
  authorUserId: string;
  createdAt: Date;
  id: string;
  text: string;
  updatedAt: Date;
}): StudentProfileNote {
  return {
    archivedAt: note.archivedAt?.toISOString(),
    authorName: note.author.fullName,
    authorUserId: note.authorUserId,
    createdAt: note.createdAt.toISOString(),
    id: note.id,
    text: note.text,
    updatedAt: note.updatedAt.toISOString(),
  };
}

function activityTitle(action: string): string {
  const titles: Record<string, string> = {
    CARD_ASSIGNED: 'Привязана пластиковая карта',
    CARD_REPLACED: 'Пластиковая карта заменена',
    CARD_UNASSIGNED: 'Пластиковая карта отвязана',
    ENROLLMENT_ADDED: 'Ученик добавлен в группу',
    ENROLLMENT_LEFT: 'Ученик выведен из группы',
    PAYMENT_CREATED: 'Зарегистрирована оплата',
    PAYMENT_REFUNDED: 'Оформлен возврат',
    STUDENT_CREATED: 'Создан профиль ученика',
    STUDENT_NOTE_ARCHIVED: 'Заметка перенесена в архив',
    STUDENT_NOTE_CREATED: 'Добавлена заметка',
    STUDENT_NOTE_UPDATED: 'Заметка изменена',
    STUDENT_CONTACT_ARCHIVED: 'Контакт перенесён в архив',
    STUDENT_CONTACT_CREATED: 'Добавлен контакт',
    STUDENT_CONTACT_UPDATED: 'Контакт изменён',
    STUDENT_UPDATED: 'Профиль ученика изменён',
    SUBSCRIPTION_CREATED: 'Оформлен абонемент',
    SUBSCRIPTION_FROZEN: 'Абонемент заморожен',
    SUBSCRIPTION_UNFROZEN: 'Абонемент разморожен',
  };
  return titles[action] ?? 'Изменение в профиле';
}

export class StudentProfileService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async getOverview(token: string, studentId: string): Promise<StudentProfileOverview> {
    const actor = await this.application.authenticate(token);
    const student = await this.application.getStudent(token, studentId);
    const trainer = actor.role === 'COACH';
    const financeService = new FinanceService(this.database, this.application);
    const branchIds = accessibleBranchIds(actor);
    const now = new Date();
    const periodStart = new Date(now);
    periodStart.setDate(periodStart.getDate() - ATTENDANCE_PERIOD_DAYS);
    const groupScope = {
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(trainer ? { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] } : {}),
    };

    const [
      enrollments,
      recentAttendance,
      attendancePeriod,
      unfilteredFinance,
      payments,
      card,
      notes,
      trialAppointments,
      pendingSale,
      allAttentionItems,
    ] = await Promise.all([
      this.database.enrollment.findMany({
        include: {
          group: {
            include: {
              branch: { select: { name: true } },
              coach: { select: { fullName: true } },
              schedules: {
                include: { roomEntity: { select: { name: true } } },
                orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
                where: { isActive: true },
              },
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
        where: { group: groupScope, studentId },
      }),
      this.database.attendance.findMany({
        include: {
          lesson: {
            include: {
              branch: { select: { name: true } },
              coach: { select: { fullName: true } },
              group: { select: { assistantCoachId: true, coachId: true, name: true } },
            },
          },
        },
        orderBy: { markedAt: 'desc' },
        take: RECENT_LIMIT,
        where: {
          studentId,
          lesson: { group: groupScope },
        },
      }),
      this.database.attendance.findMany({
        select: { status: true },
        where: {
          studentId,
          lesson: { group: groupScope, startsAt: { gte: periodStart } },
        },
      }),
      trainer
        ? Promise.resolve(undefined)
        : financeService.listStudentSubscriptions(token, studentId),
      trainer
        ? Promise.resolve([])
        : this.database.payment.findMany({
            include: {
              refunds: true,
              subscription: { include: { tariff: { select: { name: true } } } },
            },
            orderBy: { paidAt: 'desc' },
            take: RECENT_LIMIT,
            where: { ...(branchIds ? { branchId: { in: branchIds } } : {}), studentId },
          }),
      trainer
        ? Promise.resolve(null)
        : this.database.membershipCard.findFirst({
            include: { scans: { orderBy: { occurredAt: 'desc' }, take: 1 } },
            orderBy: { updatedAt: 'desc' },
            where: { archivedAt: null, studentId },
          }),
      trainer
        ? Promise.resolve([])
        : this.database.studentNote.findMany({
            include: { author: { select: { fullName: true } } },
            orderBy: { createdAt: 'desc' },
            take: RECENT_LIMIT,
            where: { archivedAt: null, studentId },
          }),
      this.database.trialAppointment.findMany({
        include: {
          group: { include: { branch: { select: { name: true } } } },
          lesson: {
            include: {
              attendance: { where: { studentId } },
            },
          },
          student: { select: { firstName: true, lastName: true } },
        },
        orderBy: { lesson: { startsAt: 'desc' } },
        where: { group: groupScope, studentId },
      }),
      trainer
        ? Promise.resolve(null)
        : this.database.paymentOperation.findFirst({
            orderBy: { createdAt: 'desc' },
            select: { id: true, status: true },
            where: {
              ...(branchIds ? { branchId: { in: branchIds } } : {}),
              saleTariffId: { not: null },
              status: { in: ['CREATED', 'WAITING_FOR_PAYMENT', 'PROCESSING'] },
              studentId,
            },
          }),
      trainer
        ? Promise.resolve([])
        : new AttentionService(this.database, this.application).listItems(token),
    ]);

    const finance = trainer
      ? undefined
      : this.scopeFinance(unfilteredFinance, branchIds ? new Set(branchIds) : undefined);
    const activeSubscriptions =
      finance?.subscriptions.filter(({ status }) => status === 'ACTIVE' || status === 'FROZEN') ??
      [];

    const subscriptionViews: StudentProfileSubscription[] = activeSubscriptions.map(
      (subscription) => ({
        debt: subscription.debt,
        expiresAt: subscription.expiresAt,
        frozen: subscription.status === 'FROZEN',
        id: subscription.id,
        lessonLimit: subscription.lessonLimit,
        lessonsUsed: subscription.lessonsUsed,
        purchasedAt: subscription.purchasedAt,
        remainingLessons: subscription.remainingLessons,
        startsAt: subscription.startsAt,
        status: subscription.status,
        tariffName: subscription.tariffName,
      }),
    );
    const currentSubscription = subscriptionViews
      .filter(({ status }) => status === 'ACTIVE' || status === 'FROZEN')
      .sort((left, right) =>
        (left.expiresAt ?? '9999').localeCompare(right.expiresAt ?? '9999'),
      )[0];
    const totalDebt = finance?.totalDebt ?? 0;
    // Archived groups remain visible in history, but are not an active workspace context.
    const currentEnrollments = enrollments
      .filter(
        ({ joinedAt, leftAt, status }) =>
          joinedAt <= now && (!leftAt || leftAt >= now) && status !== 'LEFT',
      )
      .filter(({ group }) => !group.archivedAt && group.status !== 'ARCHIVED');
    const groupIds = [...new Set(currentEnrollments.map(({ groupId }) => groupId))];
    const upcomingEnd = new Date(now);
    upcomingEnd.setDate(upcomingEnd.getDate() + UPCOMING_PERIOD_DAYS);
    const upcomingOccurrences = groupIds.length
      ? (
          await new LessonOccurrenceService(this.database).resolveRange(actor, {
            dateFrom: now,
            dateTo: upcomingEnd,
          })
        )
          .filter(({ groupId, startsAt }) => groupIds.includes(groupId) && startsAt >= now)
          .slice(0, UPCOMING_LIMIT)
      : [];
    const groupById = new Map(enrollments.map(({ group }) => [group.id, group]));
    const trials = trialAppointments.map((appointment): TrialAppointmentSummary => {
      const attendance = appointment.lesson.attendance[0];
      const purchased =
        finance?.subscriptions.some(
          (subscription) =>
            subscription.status !== 'CANCELLED' &&
            new Date(subscription.purchasedAt) >= appointment.lesson.startsAt,
        ) ?? false;
      return {
        ...(attendance ? { attendanceStatus: attendance.status } : {}),
        branchId: appointment.group.branchId,
        branchName: appointment.group.branch.name,
        endsAt: appointment.lesson.endsAt.toISOString(),
        groupId: appointment.groupId,
        groupName: appointment.group.name,
        id: appointment.id,
        leadName: [appointment.student?.firstName, appointment.student?.lastName]
          .filter(Boolean)
          .join(' '),
        lessonId: appointment.lessonId,
        lessonStatus: appointment.lesson.status,
        startsAt: appointment.lesson.startsAt.toISOString(),
        state: deriveTrialWorkflowState({
          attendanceStatus: attendance?.status,
          endsAt: appointment.lesson.endsAt,
          lessonStatus: appointment.lesson.status,
          now,
          outcome: appointment.outcome,
          purchased,
          startsAt: appointment.lesson.startsAt,
          status: appointment.status,
        }),
        ...(appointment.outcome ? { outcome: appointment.outcome } : {}),
        studentId,
        version: appointment.version,
      };
    });
    const studentRoute = `/students/${studentId}`;
    const attentionItems = allAttentionItems.filter(({ actionRoute }) =>
      actionRoute.startsWith(studentRoute),
    );
    const warnings: StudentProfileWarning[] = attentionItems.map((item) => ({
      code: item.id,
      message: item.title,
      tone: item.severity === 'CRITICAL' ? 'danger' : 'warning',
    }));

    const history = trainer
      ? []
      : await this.studentHistory(
          studentId,
          enrollments.map(({ id }) => id),
          finance?.subscriptions.map(({ id }) => id) ?? [],
          payments.flatMap((payment) => [payment.id, ...payment.refunds.map(({ id }) => id)]),
          card ? [card.id] : [],
        );
    const attended = attendancePeriod.filter(
      ({ status }) => status === 'PRESENT' || status === 'LATE',
    ).length;
    const missed = attendancePeriod.filter(
      ({ status }) => status === 'ABSENT' || status === 'EXCUSED',
    ).length;
    const lastAttendedAt = recentAttendance.find(({ status }) =>
      ['PRESENT', 'LATE', 'TRIAL'].includes(status),
    )?.lesson.startsAt;
    const recentAttendanceView = recentAttendance.map(({ lesson, markedAt, status }) => ({
      groupName: lesson.group.name,
      lessonId: lesson.id,
      markedAt: markedAt.toISOString(),
      startsAt: lesson.startsAt.toISOString(),
      status,
    }));
    const primaryAction = this.primaryAction({
      activeSubscriptions,
      currentGroupCount: currentEnrollments.length,
      pendingSale,
      subscriptions: finance?.subscriptions ?? [],
      totalDebt,
      trials,
    });
    const nextLesson = upcomingOccurrences[0];
    const nextLessonGroup = nextLesson ? groupById.get(nextLesson.groupId) : undefined;

    return {
      access: trainer ? 'TRAINER' : 'ADMIN',
      activeSubscriptions,
      attendance: {
        attended,
        lastAttendedAt: lastAttendedAt?.toISOString(),
        missed,
        percentage: attendancePeriod.length
          ? Math.round((attended / attendancePeriod.length) * 100)
          : 0,
        recent: recentAttendanceView,
      },
      attentionItems,
      card: card
        ? {
            barcode: card.barcode,
            id: card.id,
            issuedAt: card.issuedAt?.toISOString(),
            lastScannedAt: card.scans[0]?.occurredAt.toISOString(),
            status: card.status,
          }
        : undefined,
      contacts: trainer ? [] : student.contacts,
      currentSubscription,
      finance,
      groups: enrollments.map(({ group, id, joinedAt, leftAt, status }) => ({
        branchName: group.branch.name,
        coachName: group.coach?.fullName,
        direction: group.direction,
        enrollmentId: id,
        groupId: group.id,
        groupName: group.name,
        joinedAt: joinedAt.toISOString(),
        leftAt: leftAt?.toISOString(),
        membershipStatus: status,
        roomName: group.schedules.find(({ roomEntity }) => roomEntity)?.roomEntity?.name,
        scheduleSummary: group.schedules
          .slice(0, 3)
          .map(
            ({ endTime, startTime, weekday }) =>
              `${WEEKDAYS[weekday] ?? String(weekday)} · ${startTime}–${endTime}`,
          ),
        segment:
          group.archivedAt ||
          group.status === 'ARCHIVED' ||
          (leftAt && leftAt < now) ||
          status === 'LEFT'
            ? 'FORMER'
            : joinedAt > now
              ? 'FUTURE'
              : 'CURRENT',
      })),
      history,
      notes: notes.map(noteSummary),
      ...(pendingSale ? { pendingSale } : {}),
      ...(primaryAction ? { primaryAction } : {}),
      recentPayments: payments.map((payment) => ({
        amount: payment.amount,
        id: payment.id,
        method: payment.paymentMethod,
        paidAt: payment.paidAt.toISOString(),
        purpose: payment.subscription
          ? `Абонемент «${payment.subscription.tariff.name}»`
          : payment.attendanceLessonId
            ? 'Разовое посещение'
            : (payment.comment?.trim() ?? 'Оплата'),
        refundedAmount: payment.refunds.reduce((sum, refund) => sum + refund.amount, 0),
        status: payment.status,
      })),
      student: {
        ...student,
        attendanceHistory: recentAttendanceView,
        attendancePercentage: attendancePeriod.length
          ? Math.round((attended / attendancePeriod.length) * 100)
          : 0,
        contacts: trainer ? [] : student.contacts,
        groups: enrollments.map(({ group, groupId, joinedAt, leftAt, status }) => ({
          groupId,
          groupName: group.name,
          joinedAt: joinedAt.toISOString(),
          leftAt: leftAt?.toISOString(),
          status,
        })),
        nextLesson:
          nextLesson && nextLessonGroup
            ? {
                groupName: nextLessonGroup.name,
                id:
                  nextLesson.lessonId ??
                  `${nextLesson.groupId}:${nextLesson.startsAt.toISOString()}`,
                startsAt: nextLesson.startsAt.toISOString(),
              }
            : undefined,
      },
      totalDebt: trainer ? undefined : totalDebt,
      trials,
      upcomingLessons: upcomingOccurrences.flatMap((lesson) => {
        const group = groupById.get(lesson.groupId);
        if (!group) return [];
        return [
          {
            branchName: group.branch.name,
            coachName: group.coach?.fullName,
            endsAt: lesson.endsAt.toISOString(),
            groupId: group.id,
            groupName: group.name,
            ...(lesson.lessonId ? { id: lesson.lessonId } : {}),
            roomName: group.schedules.find(({ roomEntity }) => roomEntity)?.roomEntity?.name,
            source: lesson.source,
            startsAt: lesson.startsAt.toISOString(),
          },
        ];
      }),
      warnings,
    };
  }

  private scopeFinance(
    finance: StudentFinanceSummary | undefined,
    branchIds: Set<string> | undefined,
  ): StudentFinanceSummary | undefined {
    if (!finance) return undefined;
    const subscriptions = branchIds
      ? finance.subscriptions.filter(({ branchId }) => branchIds.has(branchId))
      : finance.subscriptions;
    const uncoveredAttendances = branchIds
      ? finance.uncoveredAttendances.filter(({ branchId }) => branchIds.has(branchId))
      : finance.uncoveredAttendances;
    const uncoveredDebt = uncoveredAttendances.reduce(
      (sum, attendance) => sum + (attendance.amount ?? 0),
      0,
    );
    return {
      activeSubscriptions: subscriptions.filter(
        ({ status }) => status === 'ACTIVE' || status === 'FROZEN',
      ).length,
      expiringSoon: subscriptions.filter(({ expiringSoon }) => expiringSoon).length,
      lowBalance: subscriptions.filter(({ lowBalance }) => lowBalance).length,
      subscriptions,
      totalDebt:
        subscriptions.reduce((sum, subscription) => sum + subscription.debt, 0) + uncoveredDebt,
      uncoveredAttendances,
      uncoveredDebt,
      unpricedUncoveredAttendanceCount: uncoveredAttendances.filter(
        ({ amount }) => amount === undefined,
      ).length,
    };
  }

  private primaryAction(input: {
    activeSubscriptions: SubscriptionSummary[];
    currentGroupCount: number;
    pendingSale: { id: string; status: string } | null;
    subscriptions: SubscriptionSummary[];
    totalDebt: number;
    trials: TrialAppointmentSummary[];
  }): StudentProfilePrimaryAction | undefined {
    const trial = input.trials.find(
      ({ outcome, state }) => state === 'FOLLOW_UP' && outcome === undefined,
    );
    if (trial) return { kind: 'TRIAL_OUTCOME', label: 'Указать результат', targetId: trial.id };
    const debtSubscription = input.subscriptions.find(({ debt }) => debt > 0);
    if (input.totalDebt > 0)
      return {
        kind: 'PAYMENT',
        label: 'Принять оплату',
        ...(debtSubscription ? { targetId: debtSubscription.id } : {}),
      };
    if (input.pendingSale)
      return {
        kind: 'PAYMENT_OPERATION',
        label: 'Продолжить оплату',
        targetId: input.pendingSale.id,
      };
    if (input.activeSubscriptions.length === 0) return { kind: 'SALE', label: 'Продать абонемент' };
    if (input.currentGroupCount === 0) return { kind: 'ADD_TO_GROUP', label: 'Добавить в группу' };
    return undefined;
  }

  async createNote(
    token: string,
    studentId: string,
    input: StudentNoteInput,
  ): Promise<StudentProfileNote> {
    const actor = await this.noteManager(token, studentId);
    const note = await this.database.$transaction(async (transaction) => {
      const created = await transaction.studentNote.create({
        data: { authorUserId: actor.id, studentId, text: input.text.trim() },
        include: { author: { select: { fullName: true } } },
      });
      await transaction.auditLog.create({
        data: {
          action: 'STUDENT_NOTE_CREATED',
          actorUserId: actor.id,
          entityId: created.id,
          entityType: 'StudentNote',
          detail: JSON.stringify({ studentId }),
        },
      });
      return created;
    });
    return noteSummary(note);
  }

  async updateNote(
    token: string,
    noteId: string,
    input: StudentNoteInput,
  ): Promise<StudentProfileNote> {
    const existing = await this.database.studentNote.findUnique({ where: { id: noteId } });
    if (!existing) throw new DomainError('NOT_FOUND', 'Заметка не найдена.');
    const actor = await this.noteManager(token, existing.studentId);
    const note = await this.database.$transaction(async (transaction) => {
      const updated = await transaction.studentNote.update({
        data: { text: input.text.trim() },
        include: { author: { select: { fullName: true } } },
        where: { id: noteId },
      });
      await transaction.auditLog.create({
        data: {
          action: 'STUDENT_NOTE_UPDATED',
          actorUserId: actor.id,
          entityId: noteId,
          entityType: 'StudentNote',
          detail: JSON.stringify({ studentId: existing.studentId }),
        },
      });
      return updated;
    });
    return noteSummary(note);
  }

  async archiveNote(token: string, noteId: string): Promise<void> {
    const existing = await this.database.studentNote.findUnique({ where: { id: noteId } });
    if (!existing) throw new DomainError('NOT_FOUND', 'Заметка не найдена.');
    const actor = await this.noteManager(token, existing.studentId);
    await this.database.$transaction(async (transaction) => {
      await transaction.studentNote.update({
        data: { archivedAt: new Date() },
        where: { id: noteId },
      });
      await transaction.auditLog.create({
        data: {
          action: 'STUDENT_NOTE_ARCHIVED',
          actorUserId: actor.id,
          entityId: noteId,
          entityType: 'StudentNote',
          detail: JSON.stringify({ studentId: existing.studentId }),
        },
      });
    });
  }

  private async noteManager(token: string, studentId: string) {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'students:manage');
    const student = await this.database.student.findUnique({
      select: { branchId: true },
      where: { id: studentId },
    });
    if (!student) throw new DomainError('NOT_FOUND', 'Ученик не найден.');
    assertBranchAccess(actor, student.branchId);
    return actor;
  }

  private async studentHistory(
    studentId: string,
    enrollmentIds: string[],
    subscriptionIds: string[],
    financialIds: string[],
    cardIds: string[],
  ): Promise<StudentProfileActivity[]> {
    const identifiers = [
      studentId,
      ...enrollmentIds,
      ...subscriptionIds,
      ...financialIds,
      ...cardIds,
    ];
    const events = await this.database.auditLog.findMany({
      include: { actor: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 15,
      where: {
        OR: [{ entityId: { in: identifiers } }, { detail: { contains: studentId } }],
      },
    });
    return events.map((event): StudentProfileActivity => ({
      action: event.action,
      actorName: event.actor.fullName,
      createdAt: event.createdAt.toISOString(),
      id: event.id,
      title: activityTitle(event.action),
    }));
  }
}
