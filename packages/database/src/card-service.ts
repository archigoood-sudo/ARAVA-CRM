import type {
  CardActionInput,
  CardAssignInput,
  CardHistorySummary,
  CardListQuery,
  CardListResult,
  CardRegisterInput,
  CardReplaceInput,
  CardScanHistorySummary,
  CardScanResolution,
  MembershipCardSummary,
  AuthenticatedUser,
} from '@arava/shared';
import { Prisma, type CardEventType, type CardScanResult } from '@prisma/client';

import type { DatabaseClient } from './index';
import { accessibleBranchIds, assertBranchAccess, assertPermission } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';

const cardInclude = {
  scans: { orderBy: { occurredAt: 'desc' as const }, take: 1 },
  student: { include: { branch: true } },
} satisfies Prisma.MembershipCardInclude;

type CardRecord = Prisma.MembershipCardGetPayload<{ include: typeof cardInclude }>;

const optional = (value?: string): string | null => {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : null;
};

function cardSummary(card: CardRecord): MembershipCardSummary {
  const studentName = card.student
    ? `${card.student.lastName} ${card.student.firstName}${card.student.middleName ? ` ${card.student.middleName}` : ''}`
    : undefined;
  return {
    archivedAt: card.archivedAt?.toISOString(),
    barcode: card.barcode,
    blockedAt: card.blockedAt?.toISOString(),
    branchId: card.student?.branchId,
    branchName: card.student?.branch.name,
    createdAt: card.createdAt.toISOString(),
    id: card.id,
    issuedAt: card.issuedAt?.toISOString(),
    lastScanAt: card.scans[0]?.occurredAt.toISOString(),
    notes: card.notes ?? undefined,
    status: card.status,
    studentId: card.studentId ?? undefined,
    studentName,
    unassignedAt: card.unassignedAt?.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

export class CardService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async listCards(token: string, query: CardListQuery): Promise<CardListResult> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'cards:read');
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const branchIds = accessibleBranchIds(actor);
    const tokens = query.search?.split(/\s+/u).filter(Boolean) ?? [];
    const cards = await this.database.membershipCard.findMany({
      include: cardInclude,
      where: {
        AND: tokens.map((search) => ({
          OR: [
            { barcode: { contains: search } },
            { student: { firstName: { contains: search } } },
            { student: { lastName: { contains: search } } },
            { student: { middleName: { contains: search } } },
            { student: { phone: { contains: search } } },
          ],
        })),
        ...(query.branchId
          ? { student: { branchId: query.branchId } }
          : branchIds
            ? { OR: [{ studentId: null }, { student: { branchId: { in: branchIds } } }] }
            : {}),
        ...(query.status ? { status: query.status } : {}),
      },
    });
    const direction = query.sortDirection === 'asc' ? 1 : -1;
    cards.sort((left, right) => {
      if (query.sortBy === 'barcode') return left.barcode.localeCompare(right.barcode) * direction;
      const leftValue =
        query.sortBy === 'lastScan'
          ? (left.scans[0]?.occurredAt.getTime() ?? 0)
          : left.createdAt.getTime();
      const rightValue =
        query.sortBy === 'lastScan'
          ? (right.scans[0]?.occurredAt.getTime() ?? 0)
          : right.createdAt.getTime();
      return (leftValue - rightValue) * direction;
    });
    const total = cards.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      items: cards.slice(start, start + query.pageSize).map(cardSummary),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findCard(token: string, barcode: string): Promise<MembershipCardSummary | undefined> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'cards:read');
    const card = await this.database.membershipCard.findUnique({
      include: cardInclude,
      where: { barcode },
    });
    if (!card) return undefined;
    if (card.student) assertBranchAccess(actor, card.student.branchId);
    return cardSummary(card);
  }

  async currentStudentCard(
    token: string,
    studentId: string,
  ): Promise<MembershipCardSummary | undefined> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'students:read');
    const student = await this.requireAccessibleStudent(actor, studentId);
    const card = await this.database.membershipCard.findFirst({
      include: cardInclude,
      orderBy: { issuedAt: 'desc' },
      where: { status: { in: ['ASSIGNED', 'BLOCKED', 'LOST'] }, studentId: student.id },
    });
    return card ? cardSummary(card) : undefined;
  }

  async registerCard(token: string, input: CardRegisterInput): Promise<MembershipCardSummary> {
    const actor = await this.manager(token);
    try {
      const card = await this.database.$transaction(async (transaction) => {
        const created = await transaction.membershipCard.create({
          data: {
            barcode: input.barcode,
            createdByUserId: actor.id,
            notes: optional(input.notes),
          },
        });
        await this.event(transaction, created.id, 'REGISTERED', actor.id, undefined, input.notes);
        await this.audit(transaction, actor.id, 'CARD_REGISTERED', created.id);
        return transaction.membershipCard.findUniqueOrThrow({
          include: cardInclude,
          where: { id: created.id },
        });
      });
      return cardSummary(card);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new DomainError('VALIDATION', 'Карта с таким штрихкодом уже зарегистрирована.');
      throw error;
    }
  }

  async assignCard(token: string, input: CardAssignInput): Promise<MembershipCardSummary> {
    const actor = await this.manager(token);
    const student = await this.requireAccessibleStudent(actor, input.studentId);
    return this.assign(actor, student.id, input);
  }

  async unassignCard(
    token: string,
    id: string,
    input: CardActionInput,
  ): Promise<MembershipCardSummary> {
    const { actor, card } = await this.manageCard(token, id);
    if (card.status !== 'ASSIGNED' || !card.studentId)
      throw new DomainError('VALIDATION', 'Карта не привязана к клиенту.');
    const studentId = card.studentId;
    const updated = await this.database.$transaction(async (transaction) => {
      const result = await transaction.membershipCard.update({
        data: { status: 'FREE', studentId: null, unassignedAt: new Date() },
        where: { id },
      });
      await this.event(transaction, id, 'UNASSIGNED', actor.id, studentId, input.comment);
      await this.audit(transaction, actor.id, 'CARD_UNASSIGNED', id, { studentId });
      return transaction.membershipCard.findUniqueOrThrow({
        include: cardInclude,
        where: { id: result.id },
      });
    });
    return cardSummary(updated);
  }

  async blockCard(
    token: string,
    id: string,
    input: CardActionInput,
  ): Promise<MembershipCardSummary> {
    return this.changeStatus(token, id, 'BLOCKED', 'BLOCKED', 'CARD_BLOCKED', input, {
      blockedAt: new Date(),
    });
  }

  async markLost(
    token: string,
    id: string,
    input: CardActionInput,
  ): Promise<MembershipCardSummary> {
    return this.changeStatus(token, id, 'LOST', 'MARKED_LOST', 'CARD_MARKED_LOST', input, {
      blockedAt: new Date(),
    });
  }

  async reactivateCard(
    token: string,
    id: string,
    input: CardActionInput,
  ): Promise<MembershipCardSummary> {
    const { actor, card } = await this.manageCard(token, id);
    if (card.status !== 'BLOCKED' && card.status !== 'LOST')
      throw new DomainError(
        'VALIDATION',
        'Разблокировать можно только заблокированную или утерянную карту.',
      );
    if (card.studentId) await this.assertNoActiveCard(card.studentId, id);
    const status = card.studentId ? 'ASSIGNED' : 'FREE';
    const updated = await this.database.$transaction(async (transaction) => {
      await transaction.membershipCard.update({
        data: { blockedAt: null, status },
        where: { id },
      });
      await this.event(
        transaction,
        id,
        'REACTIVATED',
        actor.id,
        card.studentId ?? undefined,
        input.comment,
      );
      await this.audit(transaction, actor.id, 'CARD_REACTIVATED', id, { status });
      return transaction.membershipCard.findUniqueOrThrow({ include: cardInclude, where: { id } });
    });
    return cardSummary(updated);
  }

  async archiveCard(
    token: string,
    id: string,
    input: CardActionInput,
  ): Promise<MembershipCardSummary> {
    const { actor, card } = await this.manageCard(token, id);
    if (actor.role !== 'OWNER')
      throw new DomainError('AUTHORIZATION', 'Архивировать карты может только владелец.');
    const updated = await this.database.$transaction(async (transaction) => {
      await transaction.membershipCard.update({
        data: { archivedAt: new Date(), blockedAt: new Date(), status: 'ARCHIVED' },
        where: { id },
      });
      await this.event(
        transaction,
        id,
        'ARCHIVED',
        actor.id,
        card.studentId ?? undefined,
        input.comment,
      );
      await this.audit(transaction, actor.id, 'CARD_ARCHIVED', id);
      return transaction.membershipCard.findUniqueOrThrow({ include: cardInclude, where: { id } });
    });
    return cardSummary(updated);
  }

  async replaceCard(token: string, input: CardReplaceInput): Promise<MembershipCardSummary> {
    const actor = await this.manager(token);
    const student = await this.requireAccessibleStudent(actor, input.studentId);
    const oldCard = await this.database.membershipCard.findUnique({
      where: { id: input.oldCardId },
    });
    if (oldCard?.studentId !== student.id || oldCard.status !== 'ASSIGNED')
      throw new DomainError('VALIDATION', 'Текущая карта клиента не найдена.');
    if (oldCard.barcode === input.newBarcode)
      throw new DomainError('VALIDATION', 'Для замены отсканируйте другую карту.');

    try {
      const replacement = await this.database.$transaction(async (transaction) => {
        let newCard = await transaction.membershipCard.findUnique({
          where: { barcode: input.newBarcode },
        });
        if (!newCard) {
          if (!input.registerIfUnknown)
            throw new DomainError('NOT_FOUND', 'Карта не зарегистрирована.');
          newCard = await transaction.membershipCard.create({
            data: { barcode: input.newBarcode, createdByUserId: actor.id },
          });
          await this.event(transaction, newCard.id, 'REGISTERED', actor.id);
        }
        if (newCard.status !== 'FREE' || newCard.studentId)
          throw new DomainError('VALIDATION', 'Новая карта уже занята или недоступна.');

        await transaction.membershipCard.update({
          data: {
            blockedAt: new Date(),
            status: input.oldCardStatus,
          },
          where: { id: oldCard.id },
        });
        await transaction.membershipCard.update({
          data: { issuedAt: new Date(), status: 'ASSIGNED', studentId: student.id },
          where: { id: newCard.id },
        });
        await this.event(
          transaction,
          oldCard.id,
          input.oldCardStatus === 'LOST' ? 'MARKED_LOST' : 'BLOCKED',
          actor.id,
          student.id,
          input.comment,
          newCard.id,
        );
        await this.event(
          transaction,
          oldCard.id,
          'REPLACED',
          actor.id,
          student.id,
          input.comment,
          newCard.id,
        );
        await this.event(
          transaction,
          newCard.id,
          'ASSIGNED',
          actor.id,
          student.id,
          input.comment,
          oldCard.id,
        );
        await this.audit(transaction, actor.id, 'CARD_REPLACED', oldCard.id, {
          newCardId: newCard.id,
          oldStatus: input.oldCardStatus,
          studentId: student.id,
        });
        return transaction.membershipCard.findUniqueOrThrow({
          include: cardInclude,
          where: { id: newCard.id },
        });
      });
      return cardSummary(replacement);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new DomainError('VALIDATION', 'Карта с таким штрихкодом уже зарегистрирована.');
      throw error;
    }
  }

  async resolveScan(token: string, barcode: string): Promise<CardScanResolution> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'cards:scan');
    const card = await this.database.membershipCard.findUnique({
      include: cardInclude,
      where: { barcode },
    });
    if (!card) {
      await this.scan(barcode, 'UNKNOWN', actor.id);
      return { barcode, result: 'UNKNOWN' };
    }

    let result: CardScanResult = card.status === 'ASSIGNED' ? 'OPENED' : card.status;
    if (card.student) {
      const accessible = await this.canAccessStudent(actor, card.student.id, card.student.branchId);
      if (!accessible) result = 'ACCESS_DENIED';
    }
    await this.database.$transaction(async (transaction) => {
      await transaction.cardScanEvent.create({
        data: {
          barcode,
          cardId: card.id,
          performedByUserId: actor.id,
          result,
          studentId: result === 'ACCESS_DENIED' ? null : card.studentId,
        },
      });
      await this.event(
        transaction,
        card.id,
        'SCANNED',
        actor.id,
        result === 'ACCESS_DENIED' ? undefined : (card.studentId ?? undefined),
        result,
      );
    });
    return {
      barcode,
      card: result === 'ACCESS_DENIED' ? undefined : cardSummary(card),
      result,
      studentId: result === 'OPENED' ? (card.studentId ?? undefined) : undefined,
      studentName: result === 'OPENED' ? cardSummary(card).studentName : undefined,
    };
  }

  async cardHistory(token: string, cardId: string): Promise<CardHistorySummary[]> {
    const { card } = await this.readCard(token, cardId);
    const events = await this.database.cardEvent.findMany({
      include: {
        performedByUser: { select: { fullName: true } },
        relatedCard: { select: { barcode: true } },
        student: { select: { firstName: true, lastName: true, middleName: true } },
      },
      orderBy: { occurredAt: 'desc' },
      where: { cardId: card.id },
    });
    return events.map((event) => ({
      comment: event.comment ?? undefined,
      eventType: event.eventType,
      id: event.id,
      occurredAt: event.occurredAt.toISOString(),
      performedByName: event.performedByUser?.fullName,
      relatedCardBarcode: event.relatedCard?.barcode,
      relatedCardId: event.relatedCardId ?? undefined,
      studentId: event.studentId ?? undefined,
      studentName: event.student
        ? `${event.student.lastName} ${event.student.firstName}${event.student.middleName ? ` ${event.student.middleName}` : ''}`
        : undefined,
    }));
  }

  async scanHistory(token: string, cardId?: string): Promise<CardScanHistorySummary[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'cards:read');
    if (cardId) await this.readCard(token, cardId);
    const branchIds = accessibleBranchIds(actor);
    const scans = await this.database.cardScanEvent.findMany({
      include: { performedByUser: { select: { fullName: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 500,
      where: {
        ...(cardId ? { cardId } : {}),
        ...(branchIds
          ? {
              OR: [{ studentId: null }, { student: { branchId: { in: branchIds } } }],
            }
          : {}),
      },
    });
    return scans.map((scan) => ({
      barcode: scan.barcode,
      cardId: scan.cardId ?? undefined,
      id: scan.id,
      occurredAt: scan.occurredAt.toISOString(),
      performedByName: scan.performedByUser?.fullName,
      result: scan.result,
      studentId: scan.studentId ?? undefined,
    }));
  }

  private async assign(
    actor: AuthenticatedUser,
    studentId: string,
    input: CardAssignInput,
  ): Promise<MembershipCardSummary> {
    await this.assertNoActiveCard(studentId);
    const occupied = await this.database.membershipCard.findUnique({
      include: { student: { select: { branchId: true, firstName: true, lastName: true } } },
      where: { barcode: input.barcode },
    });
    if (occupied?.status === 'ASSIGNED' && occupied.studentId !== studentId) {
      await this.database.auditLog.create({
        data: {
          action: 'CARD_ASSIGN_OCCUPIED_REJECTED',
          actorUserId: actor.id,
          detail: JSON.stringify({ requestedStudentId: studentId }),
          entityId: occupied.id,
          entityType: 'MembershipCard',
        },
      });
      const canNameHolder = occupied.student
        ? await this.canAccessStudent(actor, occupied.studentId ?? '', occupied.student.branchId)
        : false;
      const holder =
        canNameHolder && occupied.student
          ? `${occupied.student.lastName} ${occupied.student.firstName}`
          : undefined;
      throw new DomainError(
        'VALIDATION',
        holder
          ? `Эта карта уже привязана к другому клиенту: ${holder}.`
          : 'Эта карта уже привязана к другому клиенту.',
      );
    }
    try {
      const assigned = await this.database.$transaction(async (transaction) => {
        let card = await transaction.membershipCard.findUnique({
          include: { student: { select: { firstName: true, lastName: true } } },
          where: { barcode: input.barcode },
        });
        if (!card) {
          if (!input.registerIfUnknown)
            throw new DomainError('NOT_FOUND', 'Карта не зарегистрирована.');
          card = await transaction.membershipCard.create({
            include: { student: { select: { firstName: true, lastName: true } } },
            data: {
              barcode: input.barcode,
              createdByUserId: actor.id,
              notes: optional(input.notes),
            },
          });
          await this.event(transaction, card.id, 'REGISTERED', actor.id, undefined, input.notes);
        }
        if (card.status === 'ASSIGNED' && card.studentId !== studentId) {
          const holder = card.student
            ? `${card.student.lastName} ${card.student.firstName}`
            : undefined;
          throw new DomainError(
            'VALIDATION',
            holder
              ? `Эта карта уже привязана к другому клиенту: ${holder}.`
              : 'Эта карта уже привязана к другому клиенту.',
          );
        }
        if (card.status !== 'FREE' || card.studentId)
          throw new DomainError('VALIDATION', 'Карта недоступна для привязки.');
        await transaction.membershipCard.update({
          data: {
            issuedAt: new Date(),
            notes: optional(input.notes) ?? card.notes,
            status: 'ASSIGNED',
            studentId,
            unassignedAt: null,
          },
          where: { id: card.id },
        });
        await this.event(transaction, card.id, 'ASSIGNED', actor.id, studentId, input.notes);
        await this.audit(transaction, actor.id, 'CARD_ASSIGNED', card.id, { studentId });
        return transaction.membershipCard.findUniqueOrThrow({
          include: cardInclude,
          where: { id: card.id },
        });
      });
      return cardSummary(assigned);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new DomainError('VALIDATION', 'Карта с таким штрихкодом уже зарегистрирована.');
      throw error;
    }
  }

  private async changeStatus(
    token: string,
    id: string,
    status: 'BLOCKED' | 'LOST',
    eventType: CardEventType,
    auditAction: string,
    input: CardActionInput,
    data: Prisma.MembershipCardUpdateInput,
  ): Promise<MembershipCardSummary> {
    const { actor, card } = await this.manageCard(token, id);
    if (card.status === 'ARCHIVED')
      throw new DomainError('VALIDATION', 'Архивную карту изменить нельзя.');
    const updated = await this.database.$transaction(async (transaction) => {
      await transaction.membershipCard.update({ data: { ...data, status }, where: { id } });
      await this.event(
        transaction,
        id,
        eventType,
        actor.id,
        card.studentId ?? undefined,
        input.comment,
      );
      await this.audit(transaction, actor.id, auditAction, id, { studentId: card.studentId });
      return transaction.membershipCard.findUniqueOrThrow({ include: cardInclude, where: { id } });
    });
    return cardSummary(updated);
  }

  private async manager(token: string) {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'cards:manage');
    return actor;
  }

  private async manageCard(token: string, id: string) {
    const actor = await this.manager(token);
    const card = await this.requireCard(id);
    if (card.student) assertBranchAccess(actor, card.student.branchId);
    return { actor, card };
  }

  private async readCard(token: string, id: string) {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'cards:read');
    const card = await this.requireCard(id);
    if (card.student) assertBranchAccess(actor, card.student.branchId);
    return { actor, card };
  }

  private async requireCard(id: string): Promise<CardRecord> {
    const card = await this.database.membershipCard.findUnique({
      include: cardInclude,
      where: { id },
    });
    if (!card) throw new DomainError('NOT_FOUND', 'Карта не найдена.');
    return card;
  }

  private async requireAccessibleStudent(
    actor: Awaited<ReturnType<ApplicationService['authenticate']>>,
    studentId: string,
  ) {
    const student = await this.database.student.findUnique({ where: { id: studentId } });
    if (!student) throw new DomainError('NOT_FOUND', 'Клиент не найден.');
    assertBranchAccess(actor, student.branchId);
    if (!(await this.canAccessStudent(actor, student.id, student.branchId)))
      throw new DomainError('AUTHORIZATION', 'Нет доступа к этому клиенту.');
    return student;
  }

  private async canAccessStudent(
    actor: Awaited<ReturnType<ApplicationService['authenticate']>>,
    studentId: string,
    branchId: string,
  ): Promise<boolean> {
    const branchIds = accessibleBranchIds(actor);
    if (branchIds && !branchIds.includes(branchId)) return false;
    if (actor.role !== 'COACH') return true;
    return (
      (await this.database.enrollment.count({
        where: {
          group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] },
          leftAt: null,
          status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] },
          studentId,
        },
      })) > 0
    );
  }

  private async assertNoActiveCard(studentId: string, exceptId?: string): Promise<void> {
    const existing = await this.database.membershipCard.findFirst({
      where: { ...(exceptId ? { id: { not: exceptId } } : {}), status: 'ASSIGNED', studentId },
    });
    if (existing)
      throw new DomainError('VALIDATION', 'У клиента уже есть активная пластиковая карта.');
  }

  private async scan(barcode: string, result: CardScanResult, actorId: string): Promise<void> {
    await this.database.cardScanEvent.create({
      data: { barcode, performedByUserId: actorId, result },
    });
  }

  private async event(
    transaction: Prisma.TransactionClient,
    cardId: string,
    eventType: CardEventType,
    performedByUserId?: string,
    studentId?: string,
    comment?: string,
    relatedCardId?: string,
  ): Promise<void> {
    await transaction.cardEvent.create({
      data: {
        cardId,
        comment: optional(comment),
        eventType,
        performedByUserId: performedByUserId ?? null,
        relatedCardId: relatedCardId ?? null,
        studentId: studentId ?? null,
      },
    });
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    action: string,
    entityId: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        action,
        actorUserId,
        detail: detail ? JSON.stringify(detail) : null,
        entityId,
        entityType: 'MembershipCard',
      },
    });
  }
}
