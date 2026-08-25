import { createHash, randomUUID } from 'node:crypto';

import type {
  AuthenticatedUser,
  StudentBulkAction,
  StudentBulkAddToGroupInput,
  StudentBulkChangeStatusInput,
  StudentBulkExecutionResult,
  StudentBulkItemPreview,
  StudentBulkMoveToGroupInput,
  StudentBulkPreview,
  StudentBulkRemoveFromGroupInput,
} from '@arava/shared';
import type { EnrollmentStatus, Prisma } from '@prisma/client';

import type { DatabaseClient } from './index';
import { assertBranchAccess, assertPermission } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';

const CURRENT_ENROLLMENTS: EnrollmentStatus[] = ['ACTIVE', 'TRIAL', 'FROZEN'];
const TARGET_GROUP_STATUSES: readonly string[] = ['ACTIVE', 'RECRUITING'];

type DatabaseExecutor = DatabaseClient | Prisma.TransactionClient;

interface PreviewContext {
  actor: AuthenticatedUser;
  client: DatabaseExecutor;
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function fullName(student: {
  firstName: string;
  lastName: string;
  middleName: string | null;
}): string {
  return [student.lastName, student.firstName, student.middleName].filter(Boolean).join(' ');
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function counts(items: StudentBulkItemPreview[]) {
  return {
    eligibleCount: items.filter(({ outcome }) => outcome === 'ELIGIBLE').length,
    invalidCount: items.filter(({ outcome }) => outcome === 'INVALID').length,
    skippedCount: items.filter(({ outcome }) => outcome === 'SKIPPED').length,
  };
}

function noChangesReason(eligibleCount: number): string | undefined {
  return eligibleCount === 0
    ? 'Нет учеников, для которых можно выполнить это действие.'
    : undefined;
}

export class StudentBulkService {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async previewAddToGroup(
    token: string,
    input: StudentBulkAddToGroupInput,
  ): Promise<StudentBulkPreview> {
    const actor = await this.manage(token);
    return this.buildAddPreview({ actor, client: this.database }, input);
  }

  async previewMoveToGroup(
    token: string,
    input: StudentBulkMoveToGroupInput,
  ): Promise<StudentBulkPreview> {
    const actor = await this.manage(token);
    return this.buildMovePreview({ actor, client: this.database }, input);
  }

  async previewRemoveFromGroup(
    token: string,
    input: StudentBulkRemoveFromGroupInput,
  ): Promise<StudentBulkPreview> {
    const actor = await this.manage(token);
    return this.buildRemovePreview({ actor, client: this.database }, input);
  }

  async previewChangeStatus(
    token: string,
    input: StudentBulkChangeStatusInput,
  ): Promise<StudentBulkPreview> {
    const actor = await this.manage(token);
    return this.buildStatusPreview({ actor, client: this.database }, input);
  }

  async addToGroup(
    token: string,
    input: StudentBulkAddToGroupInput,
    previewKey: string,
  ): Promise<StudentBulkExecutionResult> {
    const actor = await this.manage(token);
    return this.withLock('student-bulk', () =>
      this.database.$transaction(async (transaction) => {
        const preview = await this.buildAddPreview({ actor, client: transaction }, input);
        this.assertExecutable(preview, previewKey);
        const correlationId = randomUUID();
        const joinedAt = dateOnly(input.effectiveDate);
        const eligible = preview.items.filter(({ outcome }) => outcome === 'ELIGIBLE');
        for (const item of eligible) {
          const enrollment = await transaction.enrollment.create({
            data: {
              groupId: input.groupId,
              joinedAt,
              status: 'ACTIVE',
              studentId: item.studentId,
            },
          });
          await this.audit(transaction, actor.id, 'ENROLLMENT_ADDED', enrollment.id, {
            batchAction: preview.action,
            correlationId,
            effectiveDate: input.effectiveDate,
            groupId: input.groupId,
            studentId: item.studentId,
          });
          if (preview.capacity?.exceedsCapacity && input.overrideCapacity)
            await this.audit(
              transaction,
              actor.id,
              'CAPACITY_OVERRIDDEN',
              input.groupId,
              {
                batchAction: preview.action,
                capacity: preview.capacity.capacity,
                correlationId,
                studentId: item.studentId,
              },
              'DanceGroup',
            );
        }
        return this.result(preview, correlationId);
      }),
    );
  }

  async moveToGroup(
    token: string,
    input: StudentBulkMoveToGroupInput,
    previewKey: string,
  ): Promise<StudentBulkExecutionResult> {
    const actor = await this.manage(token);
    return this.withLock('student-bulk', () =>
      this.database.$transaction(async (transaction) => {
        const preview = await this.buildMovePreview({ actor, client: transaction }, input);
        this.assertExecutable(preview, previewKey);
        const correlationId = randomUUID();
        const effectiveDate = dateOnly(input.effectiveDate);
        const eligibleIds = preview.items
          .filter(({ outcome }) => outcome === 'ELIGIBLE')
          .map(({ studentId }) => studentId);
        const sourceMemberships = await transaction.enrollment.findMany({
          where: {
            groupId: input.sourceGroupId,
            leftAt: null,
            status: { in: CURRENT_ENROLLMENTS },
            studentId: { in: eligibleIds },
          },
        });
        const byStudent = new Map(
          sourceMemberships.map((membership) => [membership.studentId, membership]),
        );
        for (const studentId of eligibleIds) {
          const source = byStudent.get(studentId);
          if (!source)
            throw new DomainError('CONFLICT', 'Состав группы изменился. Повторите проверку.');
          await transaction.enrollment.update({
            data: { leftAt: effectiveDate, status: 'LEFT' },
            where: { id: source.id },
          });
          await this.audit(transaction, actor.id, 'ENROLLMENT_LEFT', source.id, {
            batchAction: preview.action,
            correlationId,
            effectiveDate: input.effectiveDate,
            groupId: input.sourceGroupId,
            studentId,
            targetGroupId: input.targetGroupId,
          });
          const target = await transaction.enrollment.create({
            data: {
              groupId: input.targetGroupId,
              joinedAt: effectiveDate,
              status: source.status,
              studentId,
            },
          });
          await this.audit(transaction, actor.id, 'ENROLLMENT_ADDED', target.id, {
            batchAction: preview.action,
            correlationId,
            effectiveDate: input.effectiveDate,
            sourceGroupId: input.sourceGroupId,
            studentId,
            groupId: input.targetGroupId,
          });
          if (preview.capacity?.exceedsCapacity && input.overrideCapacity)
            await this.audit(
              transaction,
              actor.id,
              'CAPACITY_OVERRIDDEN',
              input.targetGroupId,
              {
                batchAction: preview.action,
                capacity: preview.capacity.capacity,
                correlationId,
                studentId,
              },
              'DanceGroup',
            );
        }
        return this.result(preview, correlationId);
      }),
    );
  }

  async removeFromGroup(
    token: string,
    input: StudentBulkRemoveFromGroupInput,
    previewKey: string,
  ): Promise<StudentBulkExecutionResult> {
    const actor = await this.manage(token);
    return this.withLock('student-bulk', () =>
      this.database.$transaction(async (transaction) => {
        const preview = await this.buildRemovePreview({ actor, client: transaction }, input);
        this.assertExecutable(preview, previewKey);
        const correlationId = randomUUID();
        const effectiveDate = dateOnly(input.effectiveDate);
        const eligibleIds = preview.items
          .filter(({ outcome }) => outcome === 'ELIGIBLE')
          .map(({ studentId }) => studentId);
        const memberships = await transaction.enrollment.findMany({
          where: {
            groupId: input.groupId,
            leftAt: null,
            status: { in: CURRENT_ENROLLMENTS },
            studentId: { in: eligibleIds },
          },
        });
        const byStudent = new Map(
          memberships.map((membership) => [membership.studentId, membership]),
        );
        for (const studentId of eligibleIds) {
          const membership = byStudent.get(studentId);
          if (!membership)
            throw new DomainError('CONFLICT', 'Состав группы изменился. Повторите проверку.');
          await transaction.enrollment.update({
            data: { leftAt: effectiveDate, status: 'LEFT' },
            where: { id: membership.id },
          });
          await this.audit(transaction, actor.id, 'ENROLLMENT_LEFT', membership.id, {
            batchAction: preview.action,
            correlationId,
            effectiveDate: input.effectiveDate,
            groupId: input.groupId,
            studentId,
          });
        }
        return this.result(preview, correlationId);
      }),
    );
  }

  async changeStatus(
    token: string,
    input: StudentBulkChangeStatusInput,
    previewKey: string,
  ): Promise<StudentBulkExecutionResult> {
    const actor = await this.manage(token);
    return this.withLock('student-bulk', () =>
      this.database.$transaction(async (transaction) => {
        const preview = await this.buildStatusPreview({ actor, client: transaction }, input);
        this.assertExecutable(preview, previewKey);
        const correlationId = randomUUID();
        const eligibleIds = preview.items
          .filter(({ outcome }) => outcome === 'ELIGIBLE')
          .map(({ studentId }) => studentId);
        for (const studentId of eligibleIds) {
          await transaction.student.update({
            data:
              input.status === 'ARCHIVED'
                ? { archivedAt: new Date(), status: 'ARCHIVED' }
                : { status: input.status },
            where: { id: studentId },
          });
          await transaction.auditLog.create({
            data: {
              action: input.status === 'ARCHIVED' ? 'STUDENT_ARCHIVED' : 'STUDENT_UPDATED',
              actorUserId: actor.id,
              detail: JSON.stringify({
                batchAction: preview.action,
                correlationId,
                status: input.status,
              }),
              entityId: studentId,
              entityType: 'Student',
            },
          });
        }
        return this.result(preview, correlationId);
      }),
    );
  }

  private async buildAddPreview(
    context: PreviewContext,
    input: StudentBulkAddToGroupInput,
  ): Promise<StudentBulkPreview> {
    const group = await this.requireGroup(context, input.groupId, true);
    const students = await this.studentsForPreview(context, input.studentIds, [group.id]);
    const items = input.studentIds.map((studentId): StudentBulkItemPreview => {
      const student = students.get(studentId);
      if (!student)
        return {
          outcome: 'INVALID',
          reason: 'Ученик не найден.',
          studentId,
          studentName: 'Неизвестный ученик',
        };
      const studentName = fullName(student);
      if (student.archivedAt || student.status === 'ARCHIVED')
        return { outcome: 'INVALID', reason: 'Ученик находится в архиве.', studentId, studentName };
      if (student.branchId !== group.branchId)
        return {
          outcome: 'INVALID',
          reason: 'Ученик и группа относятся к разным филиалам.',
          studentId,
          studentName,
        };
      if (student.enrollments.length > 0)
        return { outcome: 'SKIPPED', reason: 'Уже состоит в группе.', studentId, studentName };
      return { outcome: 'ELIGIBLE', studentId, studentName };
    });
    return this.groupPreview(context, 'ADD_TO_GROUP', input, group, items, students);
  }

  private async buildMovePreview(
    context: PreviewContext,
    input: StudentBulkMoveToGroupInput,
  ): Promise<StudentBulkPreview> {
    if (input.sourceGroupId === input.targetGroupId)
      throw new DomainError('VALIDATION', 'Исходная и целевая группы должны отличаться.');
    const [source, target] = await Promise.all([
      this.requireGroup(context, input.sourceGroupId, false),
      this.requireGroup(context, input.targetGroupId, true),
    ]);
    if (source.branchId !== target.branchId)
      throw new DomainError(
        'VALIDATION',
        'Перевод между филиалами недоступен: выберите группы одного филиала.',
      );
    const students = await this.studentsForPreview(context, input.studentIds, [
      source.id,
      target.id,
    ]);
    const effectiveDate = dateOnly(input.effectiveDate);
    const items = input.studentIds.map((studentId): StudentBulkItemPreview => {
      const student = students.get(studentId);
      if (!student)
        return {
          outcome: 'INVALID',
          reason: 'Ученик не найден.',
          studentId,
          studentName: 'Неизвестный ученик',
        };
      const studentName = fullName(student);
      if (student.archivedAt || student.status === 'ARCHIVED')
        return { outcome: 'INVALID', reason: 'Ученик находится в архиве.', studentId, studentName };
      if (student.branchId !== source.branchId)
        return {
          outcome: 'INVALID',
          reason: 'Ученик относится к другому филиалу.',
          studentId,
          studentName,
        };
      const sourceMembership = student.enrollments.find(({ groupId }) => groupId === source.id);
      if (!sourceMembership)
        return {
          outcome: 'INVALID',
          reason: 'Не состоит в исходной группе.',
          studentId,
          studentName,
        };
      if (student.enrollments.some(({ groupId }) => groupId === target.id))
        return {
          outcome: 'SKIPPED',
          reason: 'Уже состоит в целевой группе.',
          studentId,
          studentName,
        };
      if (sourceMembership.joinedAt > effectiveDate)
        return {
          outcome: 'INVALID',
          reason: 'Дата перевода раньше даты вступления.',
          studentId,
          studentName,
        };
      return { outcome: 'ELIGIBLE', studentId, studentName };
    });
    const preview = await this.groupPreview(
      context,
      'MOVE_TO_GROUP',
      input,
      target,
      items,
      students,
    );
    return {
      ...preview,
      sourceGroup: { id: source.id, name: source.name },
    };
  }

  private async buildRemovePreview(
    context: PreviewContext,
    input: StudentBulkRemoveFromGroupInput,
  ): Promise<StudentBulkPreview> {
    const group = await this.requireGroup(context, input.groupId, false);
    const students = await this.studentsForPreview(context, input.studentIds, [group.id]);
    const effectiveDate = dateOnly(input.effectiveDate);
    const items = input.studentIds.map((studentId): StudentBulkItemPreview => {
      const student = students.get(studentId);
      if (!student)
        return {
          outcome: 'INVALID',
          reason: 'Ученик не найден.',
          studentId,
          studentName: 'Неизвестный ученик',
        };
      const studentName = fullName(student);
      const membership = student.enrollments[0];
      if (!membership)
        return {
          outcome: 'SKIPPED',
          reason: 'Не состоит в выбранной группе.',
          studentId,
          studentName,
        };
      if (membership.joinedAt > effectiveDate)
        return {
          outcome: 'INVALID',
          reason: 'Дата выхода раньше даты вступления.',
          studentId,
          studentName,
        };
      return { outcome: 'ELIGIBLE', studentId, studentName };
    });
    const itemCounts = counts(items);
    const blockingReason = noChangesReason(itemCounts.eligibleCount);
    return {
      action: 'REMOVE_FROM_GROUP',
      blockingReason,
      canExecute: !blockingReason,
      effectiveDate: input.effectiveDate,
      ...itemCounts,
      items,
      previewKey: this.previewKey('REMOVE_FROM_GROUP', input, group, students),
      skippedCount: itemCounts.skippedCount,
      sourceGroup: { id: group.id, name: group.name },
    };
  }

  private async buildStatusPreview(
    context: PreviewContext,
    input: StudentBulkChangeStatusInput,
  ): Promise<StudentBulkPreview> {
    const students = await this.studentsForPreview(context, input.studentIds, []);
    const items = input.studentIds.map((studentId): StudentBulkItemPreview => {
      const student = students.get(studentId);
      if (!student)
        return {
          outcome: 'INVALID',
          reason: 'Ученик не найден.',
          studentId,
          studentName: 'Неизвестный ученик',
        };
      const studentName = fullName(student);
      if (student.status === input.status)
        return {
          outcome: 'SKIPPED',
          reason: 'Этот статус уже установлен.',
          studentId,
          studentName,
        };
      if (student.archivedAt && input.status !== 'ARCHIVED')
        return {
          outcome: 'INVALID',
          reason: 'Восстановление из архива выполняется отдельно.',
          studentId,
          studentName,
        };
      return { outcome: 'ELIGIBLE', studentId, studentName };
    });
    const itemCounts = counts(items);
    const blockingReason = noChangesReason(itemCounts.eligibleCount);
    return {
      action: 'CHANGE_STATUS',
      blockingReason,
      canExecute: !blockingReason,
      ...itemCounts,
      items,
      previewKey: this.previewKey('CHANGE_STATUS', input, undefined, students),
      targetStatus: input.status,
    };
  }

  private async groupPreview(
    context: PreviewContext,
    action: 'ADD_TO_GROUP' | 'MOVE_TO_GROUP',
    input: StudentBulkAddToGroupInput | StudentBulkMoveToGroupInput,
    group: { capacity: number; id: string; name: string; updatedAt: Date },
    items: StudentBulkItemPreview[],
    students: Map<
      string,
      {
        archivedAt: Date | null;
        branchId: string;
        enrollments: unknown[];
        id: string;
        status: string;
        updatedAt: Date;
      }
    >,
  ): Promise<StudentBulkPreview> {
    const currentCount = await context.client.enrollment.count({
      where: { groupId: group.id, leftAt: null, status: { in: CURRENT_ENROLLMENTS } },
    });
    const itemCounts = counts(items);
    const capacity = {
      addedCount: itemCounts.eligibleCount,
      capacity: group.capacity,
      currentCount,
      exceedsCapacity: currentCount + itemCounts.eligibleCount > group.capacity,
      resultingCount: currentCount + itemCounts.eligibleCount,
    };
    const capacityBlocked = capacity.exceedsCapacity && !input.overrideCapacity;
    const blockingReason = capacityBlocked
      ? 'После операции будет превышена вместимость группы.'
      : noChangesReason(itemCounts.eligibleCount);
    return {
      action,
      blockingReason,
      canExecute: !blockingReason,
      capacity,
      effectiveDate: input.effectiveDate,
      ...itemCounts,
      items,
      previewKey: this.previewKey(action, input, group, students),
      targetGroup: { id: group.id, name: group.name },
    };
  }

  private async studentsForPreview(
    context: PreviewContext,
    studentIds: string[],
    groupIds?: string[],
  ) {
    const students = await context.client.student.findMany({
      include: {
        enrollments: {
          orderBy: { createdAt: 'desc' },
          where: {
            ...(groupIds ? { groupId: { in: groupIds } } : {}),
            leftAt: null,
            status: { in: CURRENT_ENROLLMENTS },
          },
        },
      },
      where: { id: { in: studentIds } },
    });
    for (const student of students) assertBranchAccess(context.actor, student.branchId);
    return new Map(students.map((student) => [student.id, student]));
  }

  private async requireGroup(context: PreviewContext, groupId: string, target: boolean) {
    const group = await context.client.danceGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new DomainError('NOT_FOUND', 'Группа не найдена.');
    assertBranchAccess(context.actor, group.branchId);
    if (target && (group.archivedAt || !TARGET_GROUP_STATUSES.includes(group.status)))
      throw new DomainError('VALIDATION', 'В выбранную группу сейчас нельзя добавлять учеников.');
    return group;
  }

  private previewKey(
    action: StudentBulkAction,
    input: unknown,
    group: { capacity: number; id: string; updatedAt: Date } | undefined,
    students: Map<
      string,
      {
        archivedAt: Date | null;
        branchId: string;
        enrollments: unknown[];
        id: string;
        status: string;
        updatedAt: Date;
      }
    >,
  ): string {
    return digest({
      action,
      group,
      input,
      students: [...students.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((student) => ({
          archivedAt: student.archivedAt,
          branchId: student.branchId,
          enrollments: student.enrollments,
          id: student.id,
          status: student.status,
          updatedAt: student.updatedAt,
        })),
    });
  }

  private async manage(token: string): Promise<AuthenticatedUser> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'students:manage');
    assertPermission(actor, 'groups:manage');
    return actor;
  }

  private assertExecutable(preview: StudentBulkPreview, previewKey: string): void {
    if (preview.previewKey !== previewKey)
      throw new DomainError(
        'CONFLICT',
        'Данные изменились после проверки. Обновите предварительный просмотр.',
      );
    if (!preview.canExecute)
      throw new DomainError('VALIDATION', preview.blockingReason ?? 'Операцию выполнить нельзя.');
  }

  private result(preview: StudentBulkPreview, correlationId: string): StudentBulkExecutionResult {
    return {
      action: preview.action,
      changedCount: preview.eligibleCount,
      correlationId,
      invalidCount: preview.invalidCount,
      skippedCount: preview.skippedCount,
    };
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    action: string,
    entityId: string,
    detail: Record<string, unknown>,
    entityType = 'Enrollment',
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        action,
        actorUserId,
        detail: JSON.stringify(detail),
        entityId,
        entityType,
      },
    });
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release: () => void = () => {
      throw new Error('Очередь массовых операций не инициализирована.');
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.queues.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.queues.get(key) === tail) this.queues.delete(key);
    }
  }
}
