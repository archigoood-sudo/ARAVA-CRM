import {
  permissionsForRole,
  type AuthenticatedUser,
  type PaymentMethod,
  type PaymentOperationCreateInput,
  type PaymentOperationStatus,
  type PaymentOperationSummary,
} from '@arava/shared';
import { Prisma } from '@prisma/client';

import { assertDirectAttendancePayment, createCanonicalPayment } from './finance-service';
import type { DatabaseClient } from './index';
import { assertBranchAccess, assertPermission } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';

const operationInclude = {
  createdByUser: {
    include: { branchAssignments: { select: { branchId: true } } },
  },
  student: { select: { firstName: true, lastName: true, middleName: true } },
  subscription: { include: { tariff: { select: { name: true } } } },
} satisfies Prisma.PaymentOperationInclude;

type OperationRecord = Prisma.PaymentOperationGetPayload<{ include: typeof operationInclude }>;

const transitions: Record<PaymentOperationStatus, readonly PaymentOperationStatus[]> = {
  CANCELLED: [],
  CREATED: ['WAITING_FOR_PAYMENT', 'CANCELLED'],
  EXPIRED: [],
  FAILED: [],
  PROCESSING: ['FAILED', 'CANCELLED', 'EXPIRED'],
  SUCCEEDED: [],
  WAITING_FOR_PAYMENT: ['PROCESSING', 'FAILED', 'CANCELLED', 'EXPIRED'],
};

function fullName(person: {
  firstName: string;
  lastName: string;
  middleName: string | null;
}): string {
  return [person.lastName, person.firstName, person.middleName].filter(Boolean).join(' ');
}

function summary(operation: OperationRecord): PaymentOperationSummary {
  return {
    amount: operation.amount,
    branchId: operation.branchId,
    ...(operation.cancellationReason ? { cancellationReason: operation.cancellationReason } : {}),
    ...(operation.completedAt ? { completedAt: operation.completedAt.toISOString() } : {}),
    createdAt: operation.createdAt.toISOString(),
    createdByName: operation.createdByUser.fullName,
    currency: 'RUB',
    ...(operation.failureReason ? { failureReason: operation.failureReason } : {}),
    id: operation.id,
    idempotencyKey: operation.idempotencyKey,
    ...(operation.paymentId ? { paymentId: operation.paymentId } : {}),
    providerType: operation.providerType,
    ...(operation.providerOperationId
      ? { providerOperationId: operation.providerOperationId }
      : {}),
    purpose: operation.purpose,
    status: operation.status,
    studentId: operation.studentId,
    studentName: fullName(operation.student),
    ...(operation.subscriptionId ? { subscriptionId: operation.subscriptionId } : {}),
    ...(operation.subscription ? { subscriptionName: operation.subscription.tariff.name } : {}),
    updatedAt: operation.updatedAt.toISOString(),
  };
}

function sameRequest(operation: OperationRecord, input: PaymentOperationCreateInput): boolean {
  return (
    operation.amount === input.amount &&
    operation.branchId === input.branchId &&
    operation.currency === input.currency &&
    operation.providerType === input.providerType &&
    operation.purpose === input.purpose.trim() &&
    operation.studentId === input.studentId &&
    operation.subscriptionId === (input.subscriptionId ?? null) &&
    operation.attendanceLessonId === (input.attendanceLessonId ?? null) &&
    operation.attendanceTariffId === (input.attendanceTariffId ?? null)
  );
}

export interface TrustedPaymentCompletion {
  paymentMethod: Extract<PaymentMethod, 'ONLINE' | 'SBP' | 'ACQUIRING'>;
  providerOperationId?: string | undefined;
  providerResultId?: string | undefined;
}

export class PaymentOperationService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async create(
    token: string,
    input: PaymentOperationCreateInput,
  ): Promise<PaymentOperationSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payments:manage');
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
      throw new DomainError('VALIDATION', 'Укажите корректную сумму оплаты в рублях.');
    assertBranchAccess(actor, input.branchId);
    const existing = await this.database.paymentOperation.findUnique({
      include: operationInclude,
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (!sameRequest(existing, input))
        throw new DomainError('CONFLICT', 'Ключ операции уже использован для другой оплаты.');
      return summary(existing);
    }
    const student = await this.database.student.findUnique({ where: { id: input.studentId } });
    if (!student) throw new DomainError('NOT_FOUND', 'Ученик не найден.');
    if (student.branchId !== input.branchId)
      throw new DomainError('VALIDATION', 'Ученик относится к другому филиалу.');
    if (input.subscriptionId) {
      const subscription = await this.database.subscription.findUnique({
        where: { id: input.subscriptionId },
      });
      if (subscription?.studentId !== input.studentId || subscription.branchId !== input.branchId)
        throw new DomainError('VALIDATION', 'Абонемент не принадлежит указанному ученику.');
    }
    if (Boolean(input.attendanceLessonId) !== Boolean(input.attendanceTariffId))
      throw new DomainError('VALIDATION', 'Для оплаты посещения выберите занятие и тариф.');
    if (input.attendanceLessonId && input.subscriptionId)
      throw new DomainError(
        'VALIDATION',
        'Оплата посещения не может одновременно оплачивать абонемент.',
      );
    try {
      const created = await this.database.$transaction(async (transaction) => {
        if (input.attendanceLessonId)
          await assertDirectAttendancePayment(transaction, {
            amount: input.amount,
            branchId: input.branchId,
            lessonId: input.attendanceLessonId,
            studentId: input.studentId,
            tariffId: input.attendanceTariffId ?? '',
          });
        const operation = await transaction.paymentOperation.create({
          data: {
            amount: input.amount,
            branchId: input.branchId,
            createdByUserId: actor.id,
            currency: 'RUB',
            idempotencyKey: input.idempotencyKey,
            providerType: input.providerType,
            purpose: input.purpose.trim(),
            studentId: input.studentId,
            subscriptionId: input.subscriptionId ?? null,
            attendanceLessonId: input.attendanceLessonId ?? null,
            attendanceTariffId: input.attendanceTariffId ?? null,
          },
        });
        if (input.attendanceLessonId) {
          const claimed = await transaction.attendance.updateMany({
            data: {
              directPaymentOperationId: operation.id,
              directPaymentTariffId: input.attendanceTariffId ?? null,
            },
            where: {
              directPaymentId: null,
              directPaymentOperationId: null,
              lessonId: input.attendanceLessonId,
              studentId: input.studentId,
            },
          });
          if (claimed.count !== 1)
            throw new DomainError('CONFLICT', 'Это посещение уже оплачено или находится в оплате.');
        }
        await transaction.auditLog.create({
          data: {
            action: 'PAYMENT_OPERATION_CREATED',
            actorUserId: actor.id,
            detail: JSON.stringify({ amount: input.amount, providerType: input.providerType }),
            entityId: operation.id,
            entityType: 'PaymentOperation',
          },
        });
        if (input.attendanceLessonId)
          await transaction.auditLog.create({
            data: {
              action: 'ATTENDANCE_DIRECT_PAYMENT_STARTED',
              actorUserId: actor.id,
              detail: JSON.stringify({
                amount: input.amount,
                tariffId: input.attendanceTariffId,
              }),
              entityId: `${input.attendanceLessonId}:${input.studentId}`,
              entityType: 'Attendance',
            },
          });
        return operation;
      });
      return await this.get(token, created.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const repeated = await this.database.paymentOperation.findUnique({
          include: operationInclude,
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (repeated && sameRequest(repeated, input)) return summary(repeated);
      }
      throw error;
    }
  }

  async get(token: string, id: string): Promise<PaymentOperationSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payments:read');
    const operation = await this.requireOperation(id);
    assertBranchAccess(actor, operation.branchId);
    return summary(operation);
  }

  async listStudent(token: string, studentId: string): Promise<PaymentOperationSummary[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payments:read');
    const student = await this.database.student.findUnique({ where: { id: studentId } });
    if (!student) throw new DomainError('NOT_FOUND', 'Ученик не найден.');
    assertBranchAccess(actor, student.branchId);
    return (
      await this.database.paymentOperation.findMany({
        include: operationInclude,
        orderBy: { createdAt: 'desc' },
        where: { studentId },
      })
    ).map(summary);
  }

  async transition(
    token: string,
    id: string,
    nextStatus: Exclude<PaymentOperationStatus, 'SUCCEEDED'>,
    reason?: string,
    providerOperationId?: string,
  ): Promise<PaymentOperationSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payments:manage');
    const operation = await this.requireOperation(id);
    assertBranchAccess(actor, operation.branchId);
    await this.applyTransition(operation, nextStatus, actor.id, reason, providerOperationId);
    return this.get(token, id);
  }

  async cancel(token: string, id: string, reason: string): Promise<PaymentOperationSummary> {
    return this.transition(token, id, 'CANCELLED', reason.trim());
  }

  async failTrusted(id: string, reason: string): Promise<void> {
    const operation = await this.requireOperation(id);
    await this.applyTransition(operation, 'FAILED', operation.createdByUserId, reason.trim());
  }

  async expireTrusted(id: string, reason = 'Истекло время ожидания оплаты.'): Promise<void> {
    const operation = await this.requireOperation(id);
    await this.applyTransition(operation, 'EXPIRED', operation.createdByUserId, reason);
  }

  async finalizeTrusted(
    id: string,
    completion: TrustedPaymentCompletion,
  ): Promise<PaymentOperationSummary> {
    const current = await this.requireOperation(id);
    if (current.status === 'SUCCEEDED') {
      await this.database.auditLog.create({
        data: {
          action: 'PAYMENT_OPERATION_DUPLICATE_COMPLETION_IGNORED',
          actorUserId: current.createdByUserId,
          entityId: current.id,
          entityType: 'PaymentOperation',
        },
      });
      return summary(await this.requireOperation(id));
    }
    if (!['WAITING_FOR_PAYMENT', 'PROCESSING'].includes(current.status))
      throw new DomainError('CONFLICT', 'Операция не может быть завершена в текущем состоянии.');
    const actor: AuthenticatedUser = {
      branchIds: [current.branchId],
      email: current.createdByUser.email,
      fullName: current.createdByUser.fullName,
      id: current.createdByUser.id,
      mustChangePassword: current.createdByUser.mustChangePassword,
      permissions: permissionsForRole('ADMIN'),
      role: 'ADMIN',
    };
    await this.database.$transaction(async (transaction) => {
      const locked = await transaction.paymentOperation.findUniqueOrThrow({ where: { id } });
      if (locked.status === 'SUCCEEDED') return;
      if (!['WAITING_FOR_PAYMENT', 'PROCESSING'].includes(locked.status))
        throw new DomainError('CONFLICT', 'Операция не может быть завершена в текущем состоянии.');
      const payment = await createCanonicalPayment(transaction, actor, {
        amount: locked.amount,
        branchId: locked.branchId,
        comment: locked.purpose,
        externalReference:
          completion.providerResultId ?? completion.providerOperationId ?? locked.id,
        paidAt: new Date().toISOString(),
        paymentMethod: completion.paymentMethod,
        studentId: locked.studentId,
        ...(locked.subscriptionId ? { subscriptionId: locked.subscriptionId } : {}),
        ...(locked.attendanceLessonId
          ? {
              attendanceLessonId: locked.attendanceLessonId,
              attendancePaymentOperationId: locked.id,
              attendanceTariffId: locked.attendanceTariffId ?? undefined,
            }
          : {}),
      });
      const completedAt = new Date();
      await transaction.paymentOperation.update({
        data: {
          completedAt,
          failureReason: null,
          paymentId: payment.id,
          providerOperationId: completion.providerOperationId ?? null,
          status: 'SUCCEEDED',
        },
        where: { id, status: locked.status },
      });
      await transaction.auditLog.create({
        data: {
          action: 'PAYMENT_OPERATION_SUCCEEDED',
          actorUserId: locked.createdByUserId,
          detail: JSON.stringify({ amount: locked.amount, paymentId: payment.id }),
          entityId: id,
          entityType: 'PaymentOperation',
        },
      });
    });
    return summary(await this.requireOperation(id));
  }

  private async applyTransition(
    operation: OperationRecord,
    nextStatus: Exclude<PaymentOperationStatus, 'SUCCEEDED'>,
    actorUserId: string,
    reason?: string,
    providerOperationId?: string,
  ): Promise<void> {
    if (!transitions[operation.status].includes(nextStatus))
      throw new DomainError('CONFLICT', 'Переход операции оплаты недоступен.');
    const action =
      nextStatus === 'WAITING_FOR_PAYMENT'
        ? 'PAYMENT_OPERATION_INITIATED'
        : `PAYMENT_OPERATION_${nextStatus}`;
    await this.database.$transaction(async (transaction) => {
      const updated = await transaction.paymentOperation.updateMany({
        data: {
          ...(nextStatus === 'CANCELLED' ? { cancellationReason: reason ?? null } : {}),
          ...(['FAILED', 'EXPIRED'].includes(nextStatus) ? { failureReason: reason ?? null } : {}),
          ...(providerOperationId ? { providerOperationId } : {}),
          status: nextStatus,
        },
        where: { id: operation.id, status: operation.status },
      });
      if (updated.count !== 1)
        throw new DomainError('CONFLICT', 'Состояние операции уже изменилось.');
      if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(nextStatus))
        await transaction.attendance.updateMany({
          data: { directPaymentOperationId: null, directPaymentTariffId: null },
          where: { directPaymentOperationId: operation.id },
        });
      await transaction.auditLog.create({
        data: {
          action,
          actorUserId,
          detail: reason ? JSON.stringify({ reason: reason.slice(0, 500) }) : null,
          entityId: operation.id,
          entityType: 'PaymentOperation',
        },
      });
    });
  }

  private async requireOperation(id: string): Promise<OperationRecord> {
    const operation = await this.database.paymentOperation.findUnique({
      include: operationInclude,
      where: { id },
    });
    if (!operation) throw new DomainError('NOT_FOUND', 'Операция оплаты не найдена.');
    return operation;
  }
}
