import type {
  ArchiveEntityType,
  ArchiveItem,
  ArchiveListResult,
  ArchiveQuery,
  AuthenticatedUser,
} from '@arava/shared';

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

  async deletePermanently(token: string, type: ArchiveEntityType, id: string): Promise<void> {
    const actor = await this.actor(token);
    if (actor.role !== 'OWNER')
      throw new DomainError('AUTHORIZATION', 'Удаление навсегда доступно только владельцу.');
    await this.assertEntityScope(actor, type, id);
    await this.assertArchived(type, id);
    const reason = await this.deleteBlockReason(type, id);
    if (reason) throw new DomainError('CONFLICT', reason);
    await this.database.$transaction(async (transaction) => {
      await transaction.auditLog.create({
        data: {
          action: `${type}_PERMANENTLY_DELETED`,
          actorUserId: actor.id,
          entityId: id,
          entityType: labels[type],
        },
      });
      switch (type) {
        case 'STUDENT':
          await transaction.student.delete({ where: { id } });
          break;
        case 'TRAINER':
          await transaction.user.delete({ where: { id } });
          break;
        case 'GROUP':
          await transaction.danceGroup.delete({ where: { id } });
          break;
        case 'BRANCH':
          await transaction.branch.delete({ where: { id } });
          break;
        case 'ROOM':
          await transaction.room.delete({ where: { id } });
          break;
        case 'TARIFF':
          await transaction.tariff.delete({ where: { id } });
          break;
        case 'CARD':
          await transaction.membershipCard.delete({ where: { id } });
          break;
        case 'EXPENSE_CATEGORY':
          await transaction.expenseCategory.delete({ where: { id } });
          break;
        case 'PUBLICATION':
          await transaction.publication.delete({ where: { id } });
          break;
      }
    });
  }

  private async actor(token: string): Promise<AuthenticatedUser> {
    const actor = await this.application.authenticate(token);
    if (actor.role === 'COACH') throw new DomainError('AUTHORIZATION', 'Доступ к архиву запрещён.');
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

  private async deleteBlockReason(
    type: ArchiveEntityType,
    id: string,
  ): Promise<string | undefined> {
    let dependencies = 0;
    switch (type) {
      case 'STUDENT':
        dependencies = await this.database.$transaction(
          async (tx) =>
            (await tx.attendance.count({ where: { studentId: id } })) +
            (await tx.subscription.count({ where: { studentId: id } })) +
            (await tx.payment.count({ where: { studentId: id } })) +
            (await tx.paymentOperation.count({ where: { studentId: id } })) +
            (await tx.enrollment.count({ where: { studentId: id } })) +
            (await tx.studentDocument.count({ where: { studentId: id } })) +
            (await tx.trialAppointment.count({ where: { studentId: id } })) +
            (await tx.membershipCard.count({ where: { studentId: id } })),
        );
        break;
      case 'TRAINER':
        dependencies =
          (await this.database.lesson.count({ where: { coachId: id } })) +
          (await this.database.weeklySchedule.count({ where: { coachId: id } })) +
          (await this.database.danceGroup.count({
            where: { OR: [{ coachId: id }, { assistantCoachId: id }] },
          })) +
          (await this.database.payrollAccrual.count({ where: { coachId: id } })) +
          (await this.database.trainerPayoutRule.count({ where: { trainerId: id } })) +
          (await this.database.auditLog.count({ where: { actorUserId: id } }));
        break;
      case 'GROUP':
        dependencies =
          (await this.database.enrollment.count({ where: { groupId: id } })) +
          (await this.database.lesson.count({ where: { groupId: id } })) +
          (await this.database.weeklySchedule.count({ where: { groupId: id } })) +
          (await this.database.trialAppointment.count({ where: { groupId: id } }));
        break;
      case 'BRANCH':
        dependencies =
          (await this.database.student.count({ where: { branchId: id } })) +
          (await this.database.danceGroup.count({ where: { branchId: id } })) +
          (await this.database.lesson.count({ where: { branchId: id } })) +
          (await this.database.payment.count({ where: { branchId: id } })) +
          (await this.database.expense.count({ where: { branchId: id } }));
        break;
      case 'ROOM':
        dependencies =
          (await this.database.lesson.count({ where: { roomId: id } })) +
          (await this.database.weeklySchedule.count({ where: { roomId: id } })) +
          (await this.database.roomRental.count({ where: { roomId: id } })) +
          (await this.database.roomClosure.count({ where: { roomId: id } }));
        break;
      case 'TARIFF':
        dependencies =
          (await this.database.subscription.count({ where: { tariffId: id } })) +
          (await this.database.payment.count({ where: { attendanceTariffId: id } })) +
          (await this.database.paymentOperation.count({
            where: { OR: [{ attendanceTariffId: id }, { saleTariffId: id }] },
          }));
        break;
      case 'CARD':
        dependencies =
          (await this.database.cardEvent.count({
            where: { OR: [{ cardId: id }, { relatedCardId: id }] },
          })) + (await this.database.cardScanEvent.count({ where: { cardId: id } }));
        break;
      case 'EXPENSE_CATEGORY':
        dependencies = await this.database.expense.count({ where: { categoryId: id } });
        break;
      case 'PUBLICATION':
        dependencies = await this.database.auditLog.count({
          where: { action: 'PUBLICATION_PUBLISHED', entityId: id },
        });
        break;
    }
    return dependencies > 0
      ? `Нельзя удалить ${labels[type].toLocaleLowerCase('ru-RU')}: с объектом связана значимая история.`
      : undefined;
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
