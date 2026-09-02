import type {
  ArchiveDeleteInput,
  ArchiveDeletePreview,
  ArchiveDeleteResult,
  ArchiveDependencySummary,
  ArchiveEntityType,
  ArchiveItem,
  ArchiveListResult,
  ArchiveQuery,
  AuthenticatedUser,
} from '@arava/shared';
import type { Prisma } from '@prisma/client';

import type { DatabaseClient } from './index';
import { accessibleBranchIds, assertBranchAccess } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';

const labels: Record<ArchiveEntityType, string> = {
  BRANCH: 'Филиал',
  CARD: 'Карта',
  EXPENSE_CATEGORY: 'Категория расходов',
  GROUP: 'Группа',
  PUBLICATION: 'Публикация',
  ROOM: 'Зал',
  STUDENT: 'Ученик',
  TARIFF: 'Тариф',
  TRAINER: 'Тренер',
};

type DeleteClient = DatabaseClient | Prisma.TransactionClient;

interface DeletePlan extends ArchiveDeletePreview {
  documentMediaIds: string[];
  expenseMediaReferences: string[];
  publicationMediaPaths: string[];
}

const dependencyLabels: Record<string, string> = {
  attendance: 'Посещения',
  auditRecords: 'Записи аудита',
  cardEvents: 'События карт и сканирования',
  cards: 'Карты',
  checkInEvents: 'Check-in события',
  cashRecords: 'Кассовые записи',
  contacts: 'Контакты',
  documents: 'Документы',
  enrollments: 'Участия в группах',
  expenses: 'Расходы',
  lessons: 'Занятия',
  notes: 'Заметки',
  paymentOperations: 'Платёжные операции',
  payments: 'Платежи и возвраты',
  payrollRecords: 'Начисления и правила выплат',
  roomEvents: 'Аренды и закрытия зала',
  schedules: 'Шаблоны расписания',
  subscriptions: 'Абонементы и движения',
  syncRecords: 'Записи синхронизации и check-in',
  trials: 'Пробные записи',
};

export class ArchiveService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async list(token: string, query: ArchiveQuery): Promise<ArchiveListResult> {
    const actor = await this.actor(token);
    const branchIds = accessibleBranchIds(actor);
    const branchScope = branchIds ? { in: branchIds } : undefined;
    const [students, trainers, groups, branches, rooms, tariffs, cards, categories, publications] =
      await Promise.all([
        this.database.student.findMany({
          include: { branch: { select: { name: true } } },
          where: { archivedAt: { not: null }, ...(branchScope ? { branchId: branchScope } : {}) },
        }),
        this.database.user.findMany({
          include: { branchAssignments: { include: { branch: { select: { name: true } } } } },
          where: {
            isActive: false,
            role: 'COACH',
            ...(branchIds ? { branchAssignments: { some: { branchId: { in: branchIds } } } } : {}),
          },
        }),
        this.database.danceGroup.findMany({
          include: { branch: { select: { name: true } } },
          where: {
            OR: [{ archivedAt: { not: null } }, { status: 'ARCHIVED' }],
            ...(branchScope ? { branchId: branchScope } : {}),
          },
        }),
        this.database.branch.findMany({
          where: {
            archivedAt: { not: null },
            ...(branchIds ? { id: { in: branchIds } } : {}),
          },
        }),
        this.database.room.findMany({
          include: { branch: { select: { name: true } } },
          where: { archivedAt: { not: null }, ...(branchScope ? { branchId: branchScope } : {}) },
        }),
        this.database.tariff.findMany({
          include: { branch: { select: { name: true } } },
          where: {
            archivedAt: { not: null },
            ...(branchIds ? { OR: [{ branchId: null }, { branchId: { in: branchIds } }] } : {}),
          },
        }),
        this.database.membershipCard.findMany({
          include: { student: { include: { branch: { select: { name: true } } } } },
          where: {
            OR: [{ archivedAt: { not: null } }, { status: 'ARCHIVED' }],
            ...(branchIds ? { student: { is: { branchId: { in: branchIds } } } } : {}),
          },
        }),
        this.database.expenseCategory.findMany({
          include: { branch: { select: { name: true } } },
          where: {
            archivedAt: { not: null },
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
          },
        }),
        actor.role === 'OWNER'
          ? this.database.publication.findMany({ where: { archivedAt: { not: null } } })
          : Promise.resolve([]),
      ]);

    const userIds = trainers.map(({ id }) => id);
    const trainerAudit = userIds.length
      ? await this.database.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          where: { action: 'USER_DEACTIVATED', entityId: { in: userIds }, entityType: 'User' },
        })
      : [];
    const trainerArchivedAt = new Map<string, Date>();
    for (const audit of trainerAudit)
      if (!trainerArchivedAt.has(audit.entityId))
        trainerArchivedAt.set(audit.entityId, audit.createdAt);

    const items: ArchiveItem[] = [
      ...students.map((item) =>
        this.item(
          actor,
          'STUDENT',
          item.id,
          `${item.lastName} ${item.firstName}`,
          item.archivedAt ?? item.updatedAt,
          {
            branchId: item.branchId,
            branchName: item.branch.name,
            context: item.status,
          },
        ),
      ),
      ...trainers.map((item) => {
        const assigned = item.branchAssignments.map(({ branch }) => branch.name).join(', ');
        return this.item(
          actor,
          'TRAINER',
          item.id,
          item.fullName,
          trainerArchivedAt.get(item.id) ?? item.updatedAt,
          {
            branchId: item.branchAssignments[0]?.branchId,
            branchName: assigned || 'Все филиалы',
          },
        );
      }),
      ...groups.map((item) =>
        this.item(actor, 'GROUP', item.id, item.name, item.archivedAt ?? item.updatedAt, {
          branchId: item.branchId,
          branchName: item.branch.name,
          context: item.direction,
        }),
      ),
      ...branches.map((item) =>
        this.item(actor, 'BRANCH', item.id, item.name, item.archivedAt ?? item.updatedAt, {
          branchId: item.id,
          branchName: item.name,
        }),
      ),
      ...rooms.map((item) =>
        this.item(actor, 'ROOM', item.id, item.name, item.archivedAt ?? item.updatedAt, {
          branchId: item.branchId,
          branchName: item.branch.name,
        }),
      ),
      ...tariffs.map((item) =>
        this.item(actor, 'TARIFF', item.id, item.name, item.archivedAt ?? item.updatedAt, {
          branchId: item.branchId ?? undefined,
          branchName: item.branch?.name ?? 'Общий тариф',
          context: `${String(item.price)} ${item.currency}`,
        }),
      ),
      ...cards.map((item) =>
        this.item(actor, 'CARD', item.id, item.barcode, item.archivedAt ?? item.updatedAt, {
          branchId: item.student?.branchId,
          branchName: item.student?.branch.name,
          context: item.student
            ? `${item.student.lastName} ${item.student.firstName}`
            : 'Не назначена',
        }),
      ),
      ...categories.map((item) =>
        this.item(
          actor,
          'EXPENSE_CATEGORY',
          item.id,
          item.name,
          item.archivedAt ?? item.updatedAt,
          {
            branchId: item.branchId ?? undefined,
            branchName: item.branch?.name ?? 'Общая категория',
          },
        ),
      ),
      ...publications.map((item) =>
        this.item(actor, 'PUBLICATION', item.id, item.title, item.archivedAt ?? item.updatedAt, {
          context: item.type,
        }),
      ),
    ];
    const archiveAudits = items.length
      ? await this.database.auditLog.findMany({
          include: { actor: { select: { fullName: true } } },
          orderBy: { createdAt: 'desc' },
          where: {
            action: {
              in: [
                'BRANCH_ARCHIVED',
                'CARD_ARCHIVED',
                'EXPENSE_CATEGORY_ARCHIVED',
                'GROUP_ARCHIVED',
                'PUBLICATION_ARCHIVED',
                'ROOM_ARCHIVED',
                'STUDENT_ARCHIVED',
                'TARIFF_ARCHIVED',
                'USER_DEACTIVATED',
              ],
            },
            entityId: { in: items.map(({ entityId }) => entityId) },
          },
        })
      : [];
    const archivedBy = new Map<string, string>();
    for (const audit of archiveAudits)
      if (!archivedBy.has(audit.entityId)) archivedBy.set(audit.entityId, audit.actor.fullName);
    const enriched = items.map((item) => ({
      ...item,
      archivedByName: archivedBy.get(item.entityId),
    }));
    const needle = query.search?.trim().toLocaleLowerCase('ru-RU');
    const filtered = enriched
      .filter(({ type }) => !query.type || type === query.type)
      .filter(({ branchName, context, name }) =>
        !needle
          ? true
          : [name, branchName, context].some((value) =>
              value?.toLocaleLowerCase('ru-RU').includes(needle),
            ),
      )
      .sort((left, right) => right.archivedAt.localeCompare(left.archivedAt));
    const counts: ArchiveListResult['counts'] = {};
    for (const item of items) counts[item.type] = (counts[item.type] ?? 0) + 1;
    return { counts, items: filtered, total: filtered.length };
  }

  async restore(token: string, type: ArchiveEntityType, id: string): Promise<void> {
    const actor = await this.actor(token);
    await this.assertEntityScope(actor, type, id);
    await this.assertArchived(type, id);
    if (type === 'CARD' && actor.role !== 'OWNER')
      throw new DomainError('AUTHORIZATION', 'Восстановить карту может только владелец.');
    await this.database.$transaction(async (transaction) => {
      switch (type) {
        case 'STUDENT':
          await transaction.student.update({
            data: { archivedAt: null, status: 'ACTIVE' },
            where: { id },
          });
          break;
        case 'TRAINER':
          await transaction.user.update({ data: { isActive: true }, where: { id } });
          break;
        case 'GROUP':
          await transaction.danceGroup.update({
            data: { archivedAt: null, status: 'PAUSED' },
            where: { id },
          });
          break;
        case 'BRANCH':
          await transaction.branch.update({
            data: { archivedAt: null, isActive: true },
            where: { id },
          });
          break;
        case 'ROOM':
          await transaction.room.update({
            data: { archivedAt: null, isActive: true },
            where: { id },
          });
          break;
        case 'TARIFF':
          await transaction.tariff.update({
            data: { archivedAt: null, isActive: true },
            where: { id },
          });
          break;
        case 'CARD': {
          const card = await transaction.membershipCard.findUniqueOrThrow({ where: { id } });
          await transaction.membershipCard.update({
            data: {
              archivedAt: null,
              blockedAt: null,
              status: card.studentId ? 'ASSIGNED' : 'FREE',
            },
            where: { id },
          });
          break;
        }
        case 'EXPENSE_CATEGORY':
          await transaction.expenseCategory.update({
            data: { archivedAt: null, isActive: true },
            where: { id },
          });
          break;
        case 'PUBLICATION':
          await transaction.publication.update({
            data: { archivedAt: null, status: 'DRAFT' },
            where: { id },
          });
          break;
      }
      await transaction.auditLog.create({
        data: {
          action: `${type}_RESTORED`,
          actorUserId: actor.id,
          entityId: id,
          entityType: labels[type],
        },
      });
    });
  }

  async previewPermanentlyDelete(
    token: string,
    type: ArchiveEntityType,
    id: string,
  ): Promise<ArchiveDeletePreview> {
    const actor = await this.owner(token);
    await this.assertEntityScope(actor, type, id);
    await this.assertArchived(type, id);
    const {
      documentMediaIds: _documents,
      expenseMediaReferences: _expenses,
      publicationMediaPaths: _publications,
      ...preview
    } = await this.deletePlan(this.database, type, id);
    return preview;
  }

  async deletePermanently(
    token: string,
    type: ArchiveEntityType,
    id: string,
    input: ArchiveDeleteInput,
  ): Promise<
    ArchiveDeleteResult &
      Pick<DeletePlan, 'documentMediaIds' | 'expenseMediaReferences' | 'publicationMediaPaths'>
  > {
    const actor = await this.owner(token);
    await this.assertEntityScope(actor, type, id);
    await this.assertArchived(type, id);
    return this.database.$transaction(async (transaction) => {
      const plan = await this.deletePlan(transaction, type, id);
      if (input.confirmationName.trim() !== plan.name)
        throw new DomainError('VALIDATION', 'Введите точное название объекта для подтверждения.');
      await this.executeDelete(transaction, actor.id, type, id);
      await transaction.auditLog.create({
        data: {
          action: `${type}_PERMANENTLY_DELETED`,
          actorUserId: actor.id,
          detail: JSON.stringify({
            deleted: Object.fromEntries(plan.dependencies.map(({ count, key }) => [key, count])),
            totalDependentRecords: plan.totalDependentRecords,
          }),
          entityId: id,
          entityType: labels[type],
        },
      });
      const documentMediaIds = await this.unreferencedDocumentMedia(
        transaction,
        plan.documentMediaIds,
      );
      const expenseMediaReferences = await this.unreferencedExpenseMedia(
        transaction,
        plan.expenseMediaReferences,
      );
      const publicationMediaPaths = await this.unreferencedPublicationMedia(
        transaction,
        plan.publicationMediaPaths,
      );
      return {
        deleted: plan.dependencies,
        documentMediaIds,
        entityId: id,
        expenseMediaReferences,
        publicationMediaPaths,
        type,
      };
    });
  }

  private async actor(token: string): Promise<AuthenticatedUser> {
    const actor = await this.application.authenticate(token);
    if (actor.role === 'COACH') throw new DomainError('AUTHORIZATION', 'Доступ к архиву запрещён.');
    return actor;
  }

  private async owner(token: string): Promise<AuthenticatedUser> {
    const actor = await this.actor(token);
    if (actor.role !== 'OWNER')
      throw new DomainError('AUTHORIZATION', 'Удаление навсегда доступно только владельцу.');
    return actor;
  }

  private item(
    actor: AuthenticatedUser,
    type: ArchiveEntityType,
    entityId: string,
    name: string,
    archivedAt: Date,
    extra: Pick<ArchiveItem, 'branchId' | 'branchName' | 'context'>,
  ): ArchiveItem {
    return {
      archivedAt: archivedAt.toISOString(),
      canPermanentlyDelete: actor.role === 'OWNER',
      entityId,
      name,
      type,
      ...extra,
    };
  }

  private async assertEntityScope(
    actor: AuthenticatedUser,
    type: ArchiveEntityType,
    id: string,
  ): Promise<void> {
    if (type === 'PUBLICATION') {
      if (actor.role !== 'OWNER') throw new DomainError('AUTHORIZATION', 'Доступ запрещён.');
      await this.database.publication.findUniqueOrThrow({ where: { id } });
      return;
    }
    let branchIds: string[] = [];
    switch (type) {
      case 'STUDENT':
        branchIds = [(await this.database.student.findUniqueOrThrow({ where: { id } })).branchId];
        break;
      case 'TRAINER':
        branchIds = (await this.database.userBranch.findMany({ where: { userId: id } })).map(
          ({ branchId }) => branchId,
        );
        break;
      case 'GROUP':
        branchIds = [
          (await this.database.danceGroup.findUniqueOrThrow({ where: { id } })).branchId,
        ];
        break;
      case 'BRANCH':
        branchIds = [id];
        break;
      case 'ROOM':
        branchIds = [(await this.database.room.findUniqueOrThrow({ where: { id } })).branchId];
        break;
      case 'TARIFF': {
        const branchId = (await this.database.tariff.findUniqueOrThrow({ where: { id } })).branchId;
        if (branchId) branchIds = [branchId];
        else if (actor.role !== 'OWNER' && actor.branchIds.length > 0)
          throw new DomainError('AUTHORIZATION', 'Общий тариф недоступен.');
        break;
      }
      case 'CARD': {
        const card = await this.database.membershipCard.findUniqueOrThrow({
          include: { student: true },
          where: { id },
        });
        if (card.student) branchIds = [card.student.branchId];
        else if (actor.role !== 'OWNER')
          throw new DomainError('AUTHORIZATION', 'Свободная карта доступна только владельцу.');
        break;
      }
      case 'EXPENSE_CATEGORY': {
        const branchId = (await this.database.expenseCategory.findUniqueOrThrow({ where: { id } }))
          .branchId;
        if (branchId) branchIds = [branchId];
        else if (actor.role !== 'OWNER' && actor.branchIds.length > 0)
          throw new DomainError('AUTHORIZATION', 'Общая категория недоступна.');
        break;
      }
      default:
        break;
    }
    for (const branchId of branchIds) assertBranchAccess(actor, branchId);
  }

  private summaries(counts: Record<string, number>): ArchiveDependencySummary[] {
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({ count, key, label: dependencyLabels[key] ?? key }));
  }

  private async deletePlan(
    client: DeleteClient,
    type: ArchiveEntityType,
    id: string,
  ): Promise<DeletePlan> {
    const name = await this.entityName(client, type, id);
    const documentMediaIds: string[] = [];
    const expenseMediaReferences: string[] = [];
    const publicationMediaPaths: string[] = [];
    const preservedSharedRecords: string[] = [];
    const counts: Record<string, number> = {};
    if (type === 'STUDENT') {
      const [documents, paymentIds, cards] = await Promise.all([
        client.studentDocument.findMany({
          select: { attachmentMediaId: true },
          where: { studentId: id },
        }),
        client.payment.findMany({ select: { id: true }, where: { studentId: id } }),
        client.membershipCard.findMany({ select: { id: true }, where: { studentId: id } }),
      ]);
      documentMediaIds.push(
        ...documents.flatMap(({ attachmentMediaId }) => attachmentMediaId ?? []),
      );
      const cardIds = cards.map(({ id: cardId }) => cardId);
      const ids = paymentIds.map(({ id: paymentId }) => paymentId);
      const values = await Promise.all([
        client.attendance.count({ where: { studentId: id } }),
        client.subscription.count({ where: { studentId: id } }),
        client.studentDocument.count({ where: { studentId: id } }),
        client.enrollment.count({ where: { studentId: id } }),
        client.payment.count({ where: { studentId: id } }),
        client.refund.count({ where: { paymentId: { in: ids } } }),
        client.paymentOperation.count({ where: { studentId: id } }),
        client.studentContact.count({ where: { studentId: id } }),
        client.studentNote.count({ where: { studentId: id } }),
        client.membershipCard.count({ where: { studentId: id } }),
        client.cardEvent.count({
          where: {
            OR: [
              { studentId: id },
              { cardId: { in: cardIds } },
              { relatedCardId: { in: cardIds } },
            ],
          },
        }),
        client.cardScanEvent.count({
          where: { OR: [{ studentId: id }, { cardId: { in: cardIds } }] },
        }),
        client.trialAppointment.count({ where: { studentId: id } }),
        client.subscriptionLedger.count({ where: { studentId: id } }),
        client.syncOutbox.count({
          where: { entityType: 'ATTENDANCE_CHECKIN', idempotencyKey: { endsWith: `:${id}` } },
        }),
        client.syncOutbox.count({ where: { entityId: id } }),
        client.auditLog.count({ where: { entityId: id } }),
      ]);
      counts.attendance = values[0];
      counts.subscriptions = values[1] + values[13];
      counts.documents = values[2];
      counts.enrollments = values[3];
      counts.payments = values[4] + values[5];
      counts.paymentOperations = values[6];
      counts.contacts = values[7];
      counts.notes = values[8];
      counts.cards = values[9];
      counts.cardEvents = values[10] + values[11];
      counts.trials = values[12];
      counts.checkInEvents = values[14];
      counts.syncRecords = values[15];
      counts.auditRecords = values[16];
    } else if (type === 'TRAINER') {
      const values = await Promise.all([
        client.payrollRule.count({ where: { coachId: id } }),
        client.trainerPayoutRule.count({ where: { trainerId: id } }),
        client.payrollAccrual.count({ where: { coachId: id } }),
        client.userBranch.count({ where: { userId: id } }),
        client.auditLog.count({ where: { OR: [{ actorUserId: id }, { entityId: id }] } }),
      ]);
      counts.payrollRecords = values[0] + values[1] + values[2];
      counts.enrollments = values[3];
      counts.auditRecords = values[4];
      const [lessons, schedules, groups] = await Promise.all([
        client.lesson.count({ where: { coachId: id } }),
        client.weeklySchedule.count({ where: { coachId: id } }),
        client.danceGroup.count({ where: { OR: [{ coachId: id }, { assistantCoachId: id }] } }),
      ]);
      if (lessons + schedules + groups > 0)
        preservedSharedRecords.push(
          `Занятия, расписания и группы сохранятся; будет удалена только связь с тренером (${String(lessons + schedules + groups)}).`,
        );
    } else if (type === 'GROUP') {
      const [lessonIds, enrollments, schedules, trials, payroll] = await Promise.all([
        client.lesson.findMany({ select: { id: true }, where: { groupId: id } }),
        client.enrollment.count({ where: { groupId: id } }),
        client.weeklySchedule.count({ where: { groupId: id } }),
        client.trialAppointment.count({ where: { groupId: id } }),
        client.payrollRule.count({ where: { groupId: id } }),
      ]);
      const ids = lessonIds.map(({ id: lessonId }) => lessonId);
      counts.enrollments = enrollments;
      counts.schedules = schedules;
      counts.trials = trials;
      counts.lessons = ids.length;
      counts.attendance = await client.attendance.count({ where: { lessonId: { in: ids } } });
      counts.payrollRecords =
        payroll + (await client.payrollAccrual.count({ where: { lessonId: { in: ids } } }));
      preservedSharedRecords.push('Платежи сохранятся; ссылки на удалённые занятия будут очищены.');
    } else if (type === 'ROOM') {
      counts.roomEvents =
        (await client.roomRental.count({ where: { roomId: id } })) +
        (await client.roomClosure.count({ where: { roomId: id } }));
      const links =
        (await client.lesson.count({ where: { roomId: id } })) +
        (await client.weeklySchedule.count({ where: { roomId: id } }));
      if (links)
        preservedSharedRecords.push(
          `Занятия и расписания сохранятся без ссылки на зал (${String(links)}).`,
        );
    } else if (type === 'TARIFF') {
      counts.subscriptions = await client.subscription.count({ where: { tariffId: id } });
      const links =
        (await client.payment.count({ where: { attendanceTariffId: id } })) +
        (await client.paymentOperation.count({
          where: { OR: [{ attendanceTariffId: id }, { saleTariffId: id }] },
        }));
      if (links)
        preservedSharedRecords.push(
          `Финансовые записи сохранятся без ссылки на тариф (${String(links)}).`,
        );
    } else if (type === 'CARD') {
      counts.cardEvents =
        (await client.cardEvent.count({ where: { OR: [{ cardId: id }, { relatedCardId: id }] } })) +
        (await client.cardScanEvent.count({ where: { cardId: id } }));
      preservedSharedRecords.push('Ученик и его посещения сохранятся.');
    } else if (type === 'EXPENSE_CATEGORY') {
      const expenses = await client.expense.findMany({
        select: { attachmentPath: true },
        where: { categoryId: id },
      });
      counts.expenses = expenses.length;
      expenseMediaReferences.push(
        ...expenses.flatMap(({ attachmentPath }) => attachmentPath ?? []),
      );
    } else if (type === 'PUBLICATION') {
      const publication = await client.publication.findUniqueOrThrow({ where: { id } });
      counts.syncRecords = await client.syncOutbox.count({
        where: { entityId: id, entityType: 'PUBLICATION' },
      });
      if (publication.mediaLocalPath) publicationMediaPaths.push(publication.mediaLocalPath);
    } else {
      const values = await Promise.all([
        client.student.count({ where: { branchId: id } }),
        client.danceGroup.count({ where: { branchId: id } }),
        client.lesson.count({ where: { branchId: id } }),
        client.payment.count({ where: { branchId: id } }),
        client.expense.count({ where: { branchId: id } }),
      ]);
      counts.enrollments = values[0];
      counts.lessons = values[1] + values[2];
      counts.payments = values[3];
      counts.expenses = values[4];
      preservedSharedRecords.push(
        'Пользователи сохранятся; будут удалены только назначения в филиал.',
      );
    }
    const dependencies = this.summaries(counts);
    return {
      dependencies,
      documentMediaIds,
      entityId: id,
      expenseMediaReferences,
      name,
      preservedSharedRecords,
      publicationMediaPaths,
      totalDependentRecords: dependencies.reduce((sum, item) => sum + item.count, 0),
      type,
    };
  }

  private async entityName(
    client: DeleteClient,
    type: ArchiveEntityType,
    id: string,
  ): Promise<string> {
    switch (type) {
      case 'STUDENT': {
        const row = await client.student.findUniqueOrThrow({ where: { id } });
        return `${row.lastName} ${row.firstName}`;
      }
      case 'TRAINER':
        return (await client.user.findUniqueOrThrow({ where: { id } })).fullName;
      case 'GROUP':
        return (await client.danceGroup.findUniqueOrThrow({ where: { id } })).name;
      case 'BRANCH':
        return (await client.branch.findUniqueOrThrow({ where: { id } })).name;
      case 'ROOM':
        return (await client.room.findUniqueOrThrow({ where: { id } })).name;
      case 'TARIFF':
        return (await client.tariff.findUniqueOrThrow({ where: { id } })).name;
      case 'CARD':
        return (await client.membershipCard.findUniqueOrThrow({ where: { id } })).barcode;
      case 'EXPENSE_CATEGORY':
        return (await client.expenseCategory.findUniqueOrThrow({ where: { id } })).name;
      case 'PUBLICATION':
        return (await client.publication.findUniqueOrThrow({ where: { id } })).title;
    }
  }

  private async executeDelete(
    transaction: Prisma.TransactionClient,
    actorId: string,
    type: ArchiveEntityType,
    id: string,
  ): Promise<void> {
    switch (type) {
      case 'STUDENT':
        await this.deleteStudent(transaction, id);
        break;
      case 'TRAINER':
        await this.deleteTrainer(transaction, actorId, id);
        break;
      case 'GROUP':
        await this.deleteGroup(transaction, id);
        break;
      case 'BRANCH':
        await this.deleteBranch(transaction, actorId, id);
        break;
      case 'ROOM':
        await this.deleteRoom(transaction, id);
        break;
      case 'TARIFF':
        await this.deleteTariff(transaction, id);
        break;
      case 'CARD':
        await this.deleteCard(transaction, id);
        break;
      case 'EXPENSE_CATEGORY':
        await this.deleteExpenseCategory(transaction, id);
        break;
      case 'PUBLICATION':
        await this.deletePublication(transaction, id);
        break;
    }
  }

  private async deleteStudent(transaction: Prisma.TransactionClient, id: string): Promise<void> {
    const [payments, cards, ledgers] = await Promise.all([
      transaction.payment.findMany({ select: { id: true }, where: { studentId: id } }),
      transaction.membershipCard.findMany({ select: { id: true }, where: { studentId: id } }),
      transaction.subscriptionLedger.findMany({ select: { id: true }, where: { studentId: id } }),
    ]);
    const paymentIds = payments.map(({ id: paymentId }) => paymentId);
    const cardIds = cards.map(({ id: cardId }) => cardId);
    const ledgerIds = ledgers.map(({ id: ledgerId }) => ledgerId);
    const refunds = await transaction.refund.findMany({
      select: { id: true },
      where: { paymentId: { in: paymentIds } },
    });
    await transaction.attendance.deleteMany({ where: { studentId: id } });
    await transaction.subscriptionLedger.updateMany({
      data: { reversesLedgerId: null },
      where: { reversesLedgerId: { in: ledgerIds } },
    });
    await transaction.subscriptionLedger.deleteMany({ where: { studentId: id } });
    await transaction.cardEvent.deleteMany({
      where: {
        OR: [{ studentId: id }, { cardId: { in: cardIds } }, { relatedCardId: { in: cardIds } }],
      },
    });
    await transaction.cardScanEvent.deleteMany({
      where: { OR: [{ studentId: id }, { cardId: { in: cardIds } }] },
    });
    await transaction.membershipCard.deleteMany({ where: { studentId: id } });
    await transaction.cashTransaction.deleteMany({
      where: { sourceId: { in: [...paymentIds, ...refunds.map(({ id: refundId }) => refundId)] } },
    });
    await transaction.paymentOperation.deleteMany({ where: { studentId: id } });
    await transaction.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await transaction.payment.deleteMany({ where: { studentId: id } });
    await transaction.subscription.deleteMany({ where: { studentId: id } });
    await transaction.studentDocument.deleteMany({ where: { studentId: id } });
    await transaction.studentContact.deleteMany({ where: { studentId: id } });
    await transaction.studentNote.deleteMany({ where: { studentId: id } });
    await transaction.trialAppointment.deleteMany({ where: { studentId: id } });
    await transaction.enrollment.deleteMany({ where: { studentId: id } });
    await transaction.webAction.deleteMany({ where: { crmStudentId: id } });
    await transaction.syncOutbox.deleteMany({
      where: {
        OR: [
          { entityId: id },
          { entityType: 'ATTENDANCE_CHECKIN', idempotencyKey: { endsWith: `:${id}` } },
        ],
      },
    });
    await transaction.syncEntityState.deleteMany({
      where: { OR: [{ entityId: id }, { entityId: { endsWith: `:${id}` } }] },
    });
    await transaction.syncConflict.deleteMany({
      where: { OR: [{ entityId: id }, { entityId: { endsWith: `:${id}` } }] },
    });
    await transaction.syncLog.deleteMany({
      where: { OR: [{ entityId: id }, { entityId: { endsWith: `:${id}` } }] },
    });
    await this.deleteSyncRecords(transaction, id);
    await transaction.auditLog.deleteMany({ where: { entityId: id } });
    await transaction.student.delete({ where: { id } });
  }

  private async deleteTrainer(
    transaction: Prisma.TransactionClient,
    actorId: string,
    id: string,
  ): Promise<void> {
    await transaction.payrollAccrual.deleteMany({ where: { coachId: id } });
    await transaction.payrollRule.deleteMany({ where: { coachId: id } });
    await transaction.trainerPayoutRule.deleteMany({ where: { trainerId: id } });
    await transaction.trainerSubstitution.deleteMany({
      where: { OR: [{ substituteTrainerId: id }, { createdByUserId: id }] },
    });
    await transaction.danceGroup.updateMany({ data: { coachId: null }, where: { coachId: id } });
    await transaction.danceGroup.updateMany({
      data: { assistantCoachId: null },
      where: { assistantCoachId: id },
    });
    await transaction.weeklySchedule.updateMany({
      data: { coachId: null },
      where: { coachId: id },
    });
    await transaction.lesson.updateMany({ data: { coachId: null }, where: { coachId: id } });
    await transaction.trainerSubstitution.updateMany({
      data: { originalTrainerId: null },
      where: { originalTrainerId: id },
    });
    await transaction.attendance.updateMany({
      data: { markedByUserId: actorId },
      where: { markedByUserId: id },
    });
    await transaction.subscription.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.payment.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.paymentOperation.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.refund.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.expense.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.expense.updateMany({
      data: { confirmedByUserId: actorId },
      where: { confirmedByUserId: id },
    });
    await transaction.cashTransaction.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.payrollPeriod.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.payrollPeriod.updateMany({
      data: { approvedByUserId: actorId },
      where: { approvedByUserId: id },
    });
    await transaction.roomRental.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.roomClosure.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.trialAppointment.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.membershipCard.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.publication.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.studentNote.updateMany({
      data: { authorUserId: actorId },
      where: { authorUserId: id },
    });
    await transaction.cardEvent.updateMany({
      data: { performedByUserId: null },
      where: { performedByUserId: id },
    });
    await transaction.cardScanEvent.updateMany({
      data: { performedByUserId: null },
      where: { performedByUserId: id },
    });
    await transaction.trainerPayoutRule.updateMany({
      data: { createdByUserId: actorId },
      where: { createdByUserId: id },
    });
    await transaction.subscriptionLedger.updateMany({
      data: { createdByUserId: null },
      where: { createdByUserId: id },
    });
    await transaction.userBranch.deleteMany({ where: { userId: id } });
    await transaction.session.deleteMany({ where: { userId: id } });
    await transaction.auditLog.deleteMany({
      where: { OR: [{ actorUserId: id }, { entityId: id }] },
    });
    await this.deleteSyncRecords(transaction, id);
    await transaction.user.delete({ where: { id } });
  }

  private async deleteGroup(transaction: Prisma.TransactionClient, id: string): Promise<void> {
    const lessons = await transaction.lesson.findMany({
      select: { id: true },
      where: { groupId: id },
    });
    const lessonIds = lessons.map(({ id: lessonId }) => lessonId);
    await transaction.payment.updateMany({
      data: { attendanceLessonId: null },
      where: { attendanceLessonId: { in: lessonIds } },
    });
    await transaction.paymentOperation.updateMany({
      data: { attendanceLessonId: null },
      where: { attendanceLessonId: { in: lessonIds } },
    });
    await transaction.subscriptionLedger.updateMany({
      data: { reversesLedgerId: null },
      where: { lessonId: { in: lessonIds } },
    });
    await transaction.subscriptionLedger.deleteMany({ where: { lessonId: { in: lessonIds } } });
    await transaction.payrollAccrual.deleteMany({ where: { lessonId: { in: lessonIds } } });
    await transaction.trainerSubstitution.deleteMany({ where: { lessonId: { in: lessonIds } } });
    await transaction.trialAppointment.deleteMany({ where: { groupId: id } });
    await transaction.lesson.updateMany({
      data: { makeupForLessonId: null },
      where: { makeupForLessonId: { in: lessonIds } },
    });
    await transaction.attendance.deleteMany({ where: { lessonId: { in: lessonIds } } });
    await transaction.lesson.deleteMany({ where: { groupId: id } });
    await transaction.weeklySchedule.deleteMany({ where: { groupId: id } });
    await transaction.enrollment.deleteMany({ where: { groupId: id } });
    await transaction.payrollRule.deleteMany({ where: { groupId: id } });
    await transaction.publicationAudienceTarget.deleteMany({
      where: { targetId: id, type: 'GROUP' },
    });
    for (const lessonId of lessonIds) await this.deleteSyncRecords(transaction, lessonId);
    await this.deleteSyncRecords(transaction, id);
    await transaction.auditLog.deleteMany({ where: { entityId: { in: [id, ...lessonIds] } } });
    await transaction.danceGroup.delete({ where: { id } });
  }

  private async deleteRoom(transaction: Prisma.TransactionClient, id: string): Promise<void> {
    const room = await transaction.room.findUniqueOrThrow({ where: { id } });
    await transaction.roomRental.deleteMany({ where: { roomId: id } });
    await transaction.roomClosure.deleteMany({ where: { roomId: id } });
    await transaction.lesson.updateMany({
      data: { room: room.name, roomId: null },
      where: { roomId: id },
    });
    await transaction.weeklySchedule.updateMany({
      data: { room: room.name, roomId: null },
      where: { roomId: id },
    });
    await transaction.auditLog.deleteMany({ where: { entityId: id } });
    await this.deleteSyncRecords(transaction, id);
    await transaction.room.delete({ where: { id } });
  }

  private async deleteTariff(transaction: Prisma.TransactionClient, id: string): Promise<void> {
    const subscriptions = await transaction.subscription.findMany({
      select: { id: true },
      where: { tariffId: id },
    });
    const subscriptionIds = subscriptions.map(({ id: subscriptionId }) => subscriptionId);
    const ledgers = await transaction.subscriptionLedger.findMany({
      select: { id: true },
      where: { subscriptionId: { in: subscriptionIds } },
    });
    await transaction.subscriptionLedger.updateMany({
      data: { reversesLedgerId: null },
      where: { reversesLedgerId: { in: ledgers.map(({ id: ledgerId }) => ledgerId) } },
    });
    await transaction.subscriptionLedger.deleteMany({
      where: { subscriptionId: { in: subscriptionIds } },
    });
    await transaction.payment.updateMany({
      data: { subscriptionId: null },
      where: { subscriptionId: { in: subscriptionIds } },
    });
    await transaction.payment.updateMany({
      data: { attendanceTariffId: null },
      where: { attendanceTariffId: id },
    });
    await transaction.paymentOperation.updateMany({
      data: { subscriptionId: null },
      where: { subscriptionId: { in: subscriptionIds } },
    });
    await transaction.paymentOperation.updateMany({
      data: { attendanceTariffId: null, saleTariffId: null },
      where: { OR: [{ attendanceTariffId: id }, { saleTariffId: id }] },
    });
    await transaction.subscription.deleteMany({ where: { tariffId: id } });
    await transaction.auditLog.deleteMany({ where: { entityId: id } });
    await this.deleteSyncRecords(transaction, id);
    await transaction.tariff.delete({ where: { id } });
  }

  private async deleteCard(transaction: Prisma.TransactionClient, id: string): Promise<void> {
    await transaction.cardEvent.deleteMany({
      where: { OR: [{ cardId: id }, { relatedCardId: id }] },
    });
    await transaction.cardScanEvent.deleteMany({ where: { cardId: id } });
    await transaction.auditLog.deleteMany({ where: { entityId: id } });
    await this.deleteSyncRecords(transaction, id);
    await transaction.membershipCard.delete({ where: { id } });
  }

  private async deleteExpenseCategory(
    transaction: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    const expenses = await transaction.expense.findMany({
      select: { id: true },
      where: { categoryId: id },
    });
    const expenseIds = expenses.map(({ id: expenseId }) => expenseId);
    await transaction.cashTransaction.deleteMany({ where: { sourceId: { in: expenseIds } } });
    await transaction.expense.deleteMany({ where: { categoryId: id } });
    await transaction.auditLog.deleteMany({ where: { entityId: { in: [id, ...expenseIds] } } });
    await this.deleteSyncRecords(transaction, id);
    await transaction.expenseCategory.delete({ where: { id } });
  }

  private async deletePublication(
    transaction: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    await transaction.syncOutbox.deleteMany({ where: { entityId: id, entityType: 'PUBLICATION' } });
    await this.deleteSyncRecords(transaction, id);
    await transaction.auditLog.deleteMany({ where: { entityId: id } });
    await transaction.publication.delete({ where: { id } });
  }

  private async deleteBranch(
    transaction: Prisma.TransactionClient,
    actorId: string,
    id: string,
  ): Promise<void> {
    const students = await transaction.student.findMany({
      select: { id: true },
      where: { branchId: id },
    });
    for (const student of students) await this.deleteStudent(transaction, student.id);
    const groups = await transaction.danceGroup.findMany({
      select: { id: true },
      where: { branchId: id },
    });
    for (const group of groups) await this.deleteGroup(transaction, group.id);
    await transaction.payrollAccrual.deleteMany({ where: { branchId: id } });
    await transaction.payrollRule.deleteMany({ where: { branchId: id } });
    const periods = await transaction.payrollPeriod.findMany({
      select: { id: true },
      where: { branchId: id },
    });
    await transaction.payrollAccrual.deleteMany({
      where: { payrollPeriodId: { in: periods.map(({ id: periodId }) => periodId) } },
    });
    await transaction.payrollPeriod.deleteMany({ where: { branchId: id } });
    await transaction.cashTransaction.deleteMany({ where: { branchId: id } });
    await transaction.cashRegister.deleteMany({ where: { branchId: id } });
    const categories = await transaction.expenseCategory.findMany({
      select: { id: true },
      where: { branchId: id },
    });
    for (const category of categories) await this.deleteExpenseCategory(transaction, category.id);
    const tariffs = await transaction.tariff.findMany({
      select: { id: true },
      where: { branchId: id },
    });
    for (const tariff of tariffs) await this.deleteTariff(transaction, tariff.id);
    const rooms = await transaction.room.findMany({
      select: { id: true },
      where: { branchId: id },
    });
    for (const room of rooms) await this.deleteRoom(transaction, room.id);
    await transaction.calendarException.deleteMany({ where: { branchId: id } });
    await transaction.userBranch.deleteMany({ where: { branchId: id } });
    await transaction.publicationAudienceTarget.deleteMany({
      where: { targetId: id, type: 'BRANCH' },
    });
    await transaction.auditLog.deleteMany({ where: { entityId: id } });
    await this.deleteSyncRecords(transaction, id);
    await transaction.branch.delete({ where: { id } });
    void actorId;
  }

  private async deleteSyncRecords(
    transaction: Prisma.TransactionClient,
    entityId: string,
  ): Promise<void> {
    await transaction.syncOutbox.deleteMany({ where: { entityId } });
    await transaction.syncEntityState.deleteMany({ where: { entityId } });
    await transaction.syncConflict.deleteMany({ where: { entityId } });
    await transaction.syncLog.deleteMany({ where: { entityId } });
  }

  private async unreferencedDocumentMedia(
    transaction: Prisma.TransactionClient,
    mediaIds: string[],
  ): Promise<string[]> {
    const unique = [...new Set(mediaIds)];
    const referenced = await transaction.studentDocument.findMany({
      select: { attachmentMediaId: true },
      where: { attachmentMediaId: { in: unique } },
    });
    const retained = new Set(
      referenced.flatMap(({ attachmentMediaId }) => attachmentMediaId ?? []),
    );
    return unique.filter((mediaId) => !retained.has(mediaId));
  }

  private async unreferencedExpenseMedia(
    transaction: Prisma.TransactionClient,
    references: string[],
  ): Promise<string[]> {
    const unique = [...new Set(references)];
    const retained = new Set(
      (
        await transaction.expense.findMany({
          select: { attachmentPath: true },
          where: { attachmentPath: { in: unique } },
        })
      ).flatMap(({ attachmentPath }) => attachmentPath ?? []),
    );
    return unique.filter((reference) => !retained.has(reference));
  }

  private async unreferencedPublicationMedia(
    transaction: Prisma.TransactionClient,
    paths: string[],
  ): Promise<string[]> {
    const unique = [...new Set(paths)];
    const retained = new Set(
      (
        await transaction.publication.findMany({
          select: { mediaLocalPath: true },
          where: { mediaLocalPath: { in: unique } },
        })
      ).flatMap(({ mediaLocalPath }) => mediaLocalPath ?? []),
    );
    return unique.filter((path) => !retained.has(path));
  }

  private async assertArchived(type: ArchiveEntityType, id: string): Promise<void> {
    let archived = false;
    switch (type) {
      case 'STUDENT': {
        const item = await this.database.student.findUniqueOrThrow({ where: { id } });
        archived = item.archivedAt !== null || item.status === 'ARCHIVED';
        break;
      }
      case 'TRAINER': {
        const item = await this.database.user.findUniqueOrThrow({ where: { id } });
        archived = item.role === 'COACH' && !item.isActive;
        break;
      }
      case 'GROUP': {
        const item = await this.database.danceGroup.findUniqueOrThrow({ where: { id } });
        archived = item.archivedAt !== null || item.status === 'ARCHIVED';
        break;
      }
      case 'BRANCH':
        archived =
          (await this.database.branch.findUniqueOrThrow({ where: { id } })).archivedAt !== null;
        break;
      case 'ROOM':
        archived =
          (await this.database.room.findUniqueOrThrow({ where: { id } })).archivedAt !== null;
        break;
      case 'TARIFF':
        archived =
          (await this.database.tariff.findUniqueOrThrow({ where: { id } })).archivedAt !== null;
        break;
      case 'CARD': {
        const item = await this.database.membershipCard.findUniqueOrThrow({ where: { id } });
        archived = item.archivedAt !== null || item.status === 'ARCHIVED';
        break;
      }
      case 'EXPENSE_CATEGORY':
        archived =
          (await this.database.expenseCategory.findUniqueOrThrow({ where: { id } })).archivedAt !==
          null;
        break;
      case 'PUBLICATION':
        archived =
          (await this.database.publication.findUniqueOrThrow({ where: { id } })).archivedAt !==
          null;
        break;
    }
    if (!archived) throw new DomainError('CONFLICT', 'Объект не находится в архиве.');
  }
}
