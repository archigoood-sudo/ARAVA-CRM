import type {
  StudentNoteInput,
  StudentProfileActivity,
  StudentProfileNote,
  StudentProfileOverview,
  StudentProfileSubscription,
  StudentProfileWarning,
} from '@arava/shared';

import type { DatabaseClient } from './index';
import { assertBranchAccess, assertPermission } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';
import { FinanceService } from './finance-service';
import { ATTENTION_RULES, isExpiringSoon, isLowLessonBalance } from './attention-rules';

const ACTIVE_ENROLLMENTS = ['ACTIVE', 'TRIAL', 'FROZEN'] as const;
const UPCOMING_LIMIT = 5;
const RECENT_LIMIT = 10;
const ATTENDANCE_PERIOD_DAYS = 90;
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
    const groupAccess = trainer
      ? { group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] } }
      : {};
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - ATTENDANCE_PERIOD_DAYS);

    const [enrollments, recentAttendance, attendancePeriod, finance, payments, card, notes] =
      await Promise.all([
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
          where: {
            ...groupAccess,
            leftAt: null,
            status: { in: [...ACTIVE_ENROLLMENTS] },
            studentId,
          },
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
            ...(trainer
              ? {
                  lesson: {
                    group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] },
                  },
                }
              : {}),
          },
        }),
        this.database.attendance.findMany({
          select: { status: true },
          where: {
            markedAt: { gte: periodStart },
            studentId,
            ...(trainer
              ? {
                  lesson: {
                    group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] },
                  },
                }
              : {}),
          },
        }),
        trainer
          ? Promise.resolve(undefined)
          : financeService.listStudentSubscriptions(token, studentId),
        trainer
          ? Promise.resolve([])
          : this.database.payment.findMany({
              include: { refunds: true },
              orderBy: { paidAt: 'desc' },
              take: RECENT_LIMIT,
              where: { studentId },
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
      ]);

    const groupIds = enrollments.map(({ groupId }) => groupId);
    const upcomingLessons = groupIds.length
      ? await this.database.lesson.findMany({
          include: {
            branch: { select: { name: true } },
            coach: { select: { fullName: true } },
            group: { select: { name: true } },
            roomEntity: { select: { name: true } },
          },
          orderBy: { startsAt: 'asc' },
          take: UPCOMING_LIMIT,
          where: { groupId: { in: groupIds }, startsAt: { gte: new Date() }, status: 'PLANNED' },
        })
      : [];

    const subscriptionViews: StudentProfileSubscription[] =
      finance?.subscriptions.map((subscription) => ({
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
      })) ?? [];
    const currentSubscription = subscriptionViews
      .filter(({ status }) => status === 'ACTIVE' || status === 'FROZEN')
      .sort((left, right) =>
        (left.expiresAt ?? '9999').localeCompare(right.expiresAt ?? '9999'),
      )[0];
    const totalDebt = finance?.totalDebt ?? 0;
    const warnings: StudentProfileWarning[] = [];
    if (student.status !== 'ARCHIVED') {
      if (!enrollments.length)
        warnings.push({
          code: 'NO_GROUP',
          message: 'Ученик не состоит ни в одной группе.',
          tone: 'warning',
        });
      if (!trainer && !currentSubscription)
        warnings.push({
          code: 'NO_SUBSCRIPTION',
          message: 'Нет активного абонемента.',
          tone: 'warning',
        });
      if (!trainer && totalDebt > 0)
        warnings.push({ code: 'DEBT', message: 'Есть задолженность по оплате.', tone: 'danger' });
      if (
        currentSubscription?.remainingLessons !== undefined &&
        isLowLessonBalance(currentSubscription.remainingLessons)
      )
        warnings.push({
          code: 'LOW_BALANCE',
          message: 'В абонементе осталось не больше двух занятий.',
          tone: 'warning',
        });
      if (currentSubscription?.expiresAt && isExpiringSoon(new Date(currentSubscription.expiresAt)))
        warnings.push({
          code: 'EXPIRING',
          message: `Абонемент заканчивается в ближайшие ${String(ATTENTION_RULES.expirationDays)} дней.`,
          tone: 'warning',
        });
      if (card?.status === 'BLOCKED' || card?.status === 'LOST')
        warnings.push({
          code: 'CARD_PROBLEM',
          message:
            card.status === 'LOST' ? 'Карта отмечена как утерянная.' : 'Карта заблокирована.',
          tone: 'danger',
        });
    }

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

    return {
      access: trainer ? 'TRAINER' : 'ADMIN',
      attendance: {
        attended,
        missed,
        percentage: attendancePeriod.length
          ? Math.round((attended / attendancePeriod.length) * 100)
          : 0,
        recent: recentAttendance.map(({ lesson, markedAt, status }) => ({
          groupName: lesson.group.name,
          lessonId: lesson.id,
          markedAt: markedAt.toISOString(),
          startsAt: lesson.startsAt.toISOString(),
          status,
        })),
      },
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
      groups: enrollments.map(({ group, id, joinedAt, status }) => ({
        branchName: group.branch.name,
        coachName: group.coach?.fullName,
        direction: group.direction,
        enrollmentId: id,
        groupId: group.id,
        groupName: group.name,
        joinedAt: joinedAt.toISOString(),
        membershipStatus: status,
        roomName: group.schedules.find(({ roomEntity }) => roomEntity)?.roomEntity?.name,
        scheduleSummary: group.schedules
          .slice(0, 3)
          .map(
            ({ endTime, startTime, weekday }) =>
              `${WEEKDAYS[weekday] ?? String(weekday)} · ${startTime}–${endTime}`,
          ),
      })),
      history,
      notes: notes.map(noteSummary),
      recentPayments: payments.map((payment) => ({
        amount: payment.amount,
        id: payment.id,
        method: payment.paymentMethod,
        paidAt: payment.paidAt.toISOString(),
        refundedAmount: payment.refunds.reduce((sum, refund) => sum + refund.amount, 0),
        status: payment.status,
      })),
      student,
      totalDebt: trainer ? undefined : totalDebt,
      upcomingLessons: upcomingLessons.map((lesson) => ({
        branchName: lesson.branch.name,
        coachName: lesson.coach?.fullName,
        endsAt: lesson.endsAt.toISOString(),
        groupName: lesson.group.name,
        id: lesson.id,
        roomName: lesson.roomEntity?.name ?? lesson.room ?? undefined,
        startsAt: lesson.startsAt.toISOString(),
      })),
      warnings,
    };
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
