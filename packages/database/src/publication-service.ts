import type { PublicationInput, PublicationOptions, PublicationSummary } from '@arava/shared';
import type { AuthenticatedUser } from '@arava/shared';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

import type { DatabaseClient } from './index';
import { accessibleBranchIds, assertBranchAccess } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';

type PublicationRow = Prisma.PublicationGetPayload<{
  include: { createdBy: { select: { fullName: true } }; targets: true };
}>;

export interface PublicationMediaInfo {
  contentType: string;
  fileName: string;
  localPath: string;
}

export class PublicationService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  private async actor(token: string): Promise<AuthenticatedUser> {
    const actor = await this.application.authenticate(token);
    if (actor.role === 'COACH')
      throw new DomainError('AUTHORIZATION', 'У тренера нет доступа к управлению публикациями.');
    return actor;
  }

  async options(token: string): Promise<PublicationOptions> {
    const actor = await this.actor(token);
    const ids = accessibleBranchIds(actor);
    const [branches, groups] = await Promise.all([
      this.database.branch.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
        where: { archivedAt: null, isActive: true, ...(ids ? { id: { in: ids } } : {}) },
      }),
      this.database.danceGroup.findMany({
        orderBy: { name: 'asc' },
        select: { branchId: true, id: true, name: true },
        where: { archivedAt: null, ...(ids ? { branchId: { in: ids } } : {}) },
      }),
    ]);
    return { branches, groups };
  }

  async list(token: string): Promise<PublicationSummary[]> {
    const actor = await this.actor(token);
    const rows = await this.database.publication.findMany({
      include: { createdBy: { select: { fullName: true } }, targets: true },
      orderBy: { createdAt: 'desc' },
    });
    const groupBranch = new Map(
      (await this.database.danceGroup.findMany({ select: { branchId: true, id: true } })).map(
        (group) => [group.id, group.branchId],
      ),
    );
    const scoped =
      actor.role === 'OWNER' || actor.branchIds.length === 0
        ? rows
        : rows.filter((row) =>
            row.audienceMode === 'BRANCHES'
              ? row.targets.every((target) => actor.branchIds.includes(target.targetId))
              : row.audienceMode === 'GROUPS' &&
                row.targets.every((target) =>
                  actor.branchIds.includes(groupBranch.get(target.targetId) ?? ''),
                ),
          );
    return Promise.all(scoped.map((row) => this.summary(row)));
  }

  async create(
    token: string,
    input: PublicationInput,
    media?: PublicationMediaInfo,
  ): Promise<PublicationSummary> {
    const actor = await this.actor(token);
    await this.assertAudience(actor, input);
    const row = await this.database.$transaction(async (transaction) => {
      const publication = await transaction.publication.create({
        data: {
          audienceMode: input.audienceMode,
          body: input.body,
          createdByUserId: actor.id,
          eventLocation: input.eventLocation ?? null,
          eventStartsAt: date(input.eventStartsAt) ?? null,
          expiresAt: date(input.expiresAt) ?? null,
          mediaContentType: media?.contentType ?? null,
          mediaFileName: media?.fileName ?? null,
          mediaLocalPath: media?.localPath ?? null,
          publishAt: date(input.publishAt) ?? null,
          title: input.title,
          type: input.type,
          targets: {
            create: input.targetIds.map((targetId) => ({
              targetId,
              type: input.audienceMode === 'BRANCHES' ? 'BRANCH' : 'GROUP',
            })),
          },
        },
        include: { createdBy: { select: { fullName: true } }, targets: true },
      });
      await this.audit(transaction, actor.id, 'PUBLICATION_CREATED', publication.id);
      return publication;
    });
    return this.summary(row);
  }

  async update(
    token: string,
    id: string,
    input: PublicationInput,
    media?: PublicationMediaInfo,
  ): Promise<PublicationSummary> {
    const actor = await this.actor(token);
    await this.assertAudience(actor, input);
    const current = await this.requireEditable(actor, id);
    const row = await this.database.$transaction(async (transaction) => {
      await transaction.publicationAudienceTarget.deleteMany({ where: { publicationId: id } });
      const publication = await transaction.publication.update({
        data: {
          audienceMode: input.audienceMode,
          body: input.body,
          eventLocation: input.eventLocation ?? null,
          eventStartsAt: date(input.eventStartsAt) ?? null,
          expiresAt: date(input.expiresAt) ?? null,
          publishAt: date(input.publishAt) ?? null,
          title: input.title,
          type: input.type,
          ...(media
            ? {
                mediaContentType: media.contentType,
                mediaFileName: media.fileName,
                mediaLocalPath: media.localPath,
                mediaRef: null,
              }
            : {}),
          targets: {
            create: input.targetIds.map((targetId) => ({
              targetId,
              type: input.audienceMode === 'BRANCHES' ? 'BRANCH' : 'GROUP',
            })),
          },
        },
        include: { createdBy: { select: { fullName: true } }, targets: true },
        where: { id },
      });
      if (current.status === 'PUBLISHED') await this.queue(transaction, publication.id, 'UPSERT');
      await this.audit(transaction, actor.id, 'PUBLICATION_UPDATED', id);
      return publication;
    });
    return this.summary(row);
  }

  async publish(token: string, id: string): Promise<PublicationSummary> {
    const actor = await this.actor(token);
    await this.requireEditable(actor, id);
    const row = await this.database.$transaction(async (transaction) => {
      const publication = await transaction.publication.update({
        data: { archivedAt: null, status: 'PUBLISHED' },
        include: { createdBy: { select: { fullName: true } }, targets: true },
        where: { id },
      });
      await this.queue(transaction, id, 'UPSERT');
      await this.audit(transaction, actor.id, 'PUBLICATION_PUBLISHED', id);
      return publication;
    });
    return this.summary(row);
  }

  async archive(token: string, id: string): Promise<PublicationSummary> {
    const actor = await this.actor(token);
    await this.requireEditable(actor, id);
    const row = await this.database.$transaction(async (transaction) => {
      const publication = await transaction.publication.update({
        data: { archivedAt: new Date(), status: 'ARCHIVED' },
        include: { createdBy: { select: { fullName: true } }, targets: true },
        where: { id },
      });
      await this.queue(transaction, id, 'ARCHIVE');
      await this.audit(transaction, actor.id, 'PUBLICATION_ARCHIVED', id);
      return publication;
    });
    return this.summary(row);
  }

  async retry(token: string, id: string): Promise<PublicationSummary> {
    const actor = await this.actor(token);
    const row = await this.requireEditable(actor, id);
    await this.database.syncOutbox.updateMany({
      data: { lastErrorCode: null, nextAttemptAt: new Date(), status: 'PENDING' },
      where: { entityId: id, entityType: 'PUBLICATION', status: 'FAILED' },
    });
    return this.summary(row);
  }

  private async requireEditable(actor: AuthenticatedUser, id: string) {
    const row = await this.database.publication.findUnique({
      include: { createdBy: { select: { fullName: true } }, targets: true },
      where: { id },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Публикация не найдена.');
    if (actor.role === 'ADMIN' && actor.branchIds.length > 0) {
      if (row.audienceMode === 'ALL_CLIENTS' || row.audienceMode === 'TRAINERS')
        throw new DomainError('AUTHORIZATION', 'Публикация недоступна в вашей области доступа.');
      if (row.audienceMode === 'BRANCHES')
        row.targets.forEach((target) => assertBranchAccess(actor, target.targetId));
      if (row.audienceMode === 'GROUPS') {
        const groups = await this.database.danceGroup.findMany({
          select: { branchId: true },
          where: { id: { in: row.targets.map(({ targetId }) => targetId) } },
        });
        groups.forEach((group) => assertBranchAccess(actor, group.branchId));
      }
    }
    return row;
  }

  private async assertAudience(actor: AuthenticatedUser, input: PublicationInput): Promise<void> {
    if (
      actor.role === 'ADMIN' &&
      actor.branchIds.length > 0 &&
      (input.audienceMode === 'ALL_CLIENTS' || input.audienceMode === 'TRAINERS')
    )
      throw new DomainError(
        'AUTHORIZATION',
        'Ограниченный администратор может выбирать только свои филиалы и группы.',
      );
    if (input.audienceMode === 'BRANCHES') {
      const branches = await this.database.branch.findMany({
        where: { id: { in: input.targetIds }, archivedAt: null },
      });
      if (branches.length !== new Set(input.targetIds).size)
        throw new DomainError('VALIDATION', 'Один из филиалов не найден.');
      branches.forEach((branch) => assertBranchAccess(actor, branch.id));
    }
    if (input.audienceMode === 'GROUPS') {
      const groups = await this.database.danceGroup.findMany({
        where: { id: { in: input.targetIds }, archivedAt: null },
      });
      if (groups.length !== new Set(input.targetIds).size)
        throw new DomainError('VALIDATION', 'Одна из групп не найдена.');
      groups.forEach((group) => assertBranchAccess(actor, group.branchId));
    }
  }

  private async summary(row: PublicationRow): Promise<PublicationSummary> {
    const outbox = await this.database.syncOutbox.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { entityId: row.id, entityType: 'PUBLICATION' },
    });
    const syncState =
      row.status === 'DRAFT'
        ? 'LOCAL'
        : outbox?.status === 'SYNCED'
          ? 'SYNCED'
          : outbox?.status === 'FAILED'
            ? 'ERROR'
            : 'PENDING';
    return {
      audienceMode: row.audienceMode,
      authorName: row.createdBy.fullName,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      status: row.status,
      syncState,
      targetIds: row.targets.map(({ targetId }) => targetId),
      title: row.title,
      type: row.type,
      updatedAt: row.updatedAt.toISOString(),
      ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
      ...(row.eventLocation ? { eventLocation: row.eventLocation } : {}),
      ...(row.eventStartsAt ? { eventStartsAt: row.eventStartsAt.toISOString() } : {}),
      ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
      ...(row.mediaFileName ? { mediaFileName: row.mediaFileName } : {}),
      ...(row.publishAt ? { publishAt: row.publishAt.toISOString() } : {}),
    };
  }

  private async queue(
    transaction: Prisma.TransactionClient,
    id: string,
    operation: 'UPSERT' | 'ARCHIVE',
  ): Promise<void> {
    await transaction.syncOutbox.create({
      data: {
        entityId: id,
        entityType: 'PUBLICATION',
        idempotencyKey: `publication:${id}:${randomUUID()}`,
        operation,
      },
    });
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    action: string,
    entityId: string,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: { action, actorUserId, entityId, entityType: 'Publication' },
    });
  }
}

function date(value?: string): Date | undefined {
  return value ? new Date(value) : undefined;
}
