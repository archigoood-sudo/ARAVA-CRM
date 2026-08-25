import type {
  AuthenticatedUser,
  FinanceStats,
  LedgerEntrySummary,
  PaymentDetail,
  PaymentInput,
  PaymentListQuery,
  PaymentSummary,
  RefundInput,
  RefundSummary,
  StaffOption,
  StudentFinanceSummary,
  SubscriptionAdjustmentInput,
  SubscriptionCreateInput,
  SubscriptionDetail,
  SubscriptionFreezeInput,
  SubscriptionSummary,
  SubscriptionUpdateInput,
  TariffInput,
  TariffListQuery,
  TariffSummary,
} from '@arava/shared';
import { t } from '@arava/shared';
import type { Prisma, Subscription, Tariff } from '@prisma/client';

import type { DatabaseClient } from './index';
import { accessibleBranchIds, assertBranchAccess, assertPermission } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';
import {
  addDays,
  reconcileStudentAttendanceCoverage,
  subscriptionStatusAt,
} from './subscription-ledger';
import { DAY_MS, isExpiringSoon, isLowLessonBalance } from './attention-rules';

const subscriptionInclude = {
  branch: { select: { name: true } },
  payments: { include: { refunds: true } },
  student: { select: { firstName: true, lastName: true, middleName: true } },
  tariff: true,
} satisfies Prisma.SubscriptionInclude;

const paymentInclude = {
  branch: { select: { name: true } },
  createdByUser: { select: { fullName: true } },
  refunds: {
    include: { createdByUser: { select: { fullName: true } } },
    orderBy: { refundedAt: 'desc' },
  },
  student: {
    select: { firstName: true, lastName: true, middleName: true, phone: true },
  },
  subscription: { include: { tariff: { select: { name: true } } } },
} satisfies Prisma.PaymentInclude;

type SubscriptionRecord = Prisma.SubscriptionGetPayload<{ include: typeof subscriptionInclude }>;
type PaymentRecord = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;
type FinanceClient = DatabaseClient | Prisma.TransactionClient;

async function ensurePaymentRegister(
  client: FinanceClient,
  branchId: string,
  paymentMethod: PaymentInput['paymentMethod'],
) {
  const type =
    paymentMethod === 'CASH'
      ? 'CASH'
      : ['ONLINE', 'SBP', 'ACQUIRING'].includes(paymentMethod)
        ? 'ONLINE'
        : 'BANK';
  const name =
    type === 'CASH' ? 'Основная касса' : type === 'ONLINE' ? 'Онлайн-касса' : 'Расчётный счёт';
  const existing = await client.cashRegister.findFirst({
    where: { branchId, isActive: true, type },
  });
  return (
    existing ?? client.cashRegister.create({ data: { branchId, name, openingBalance: 0, type } })
  );
}

function optionalValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : null;
}

function dateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function endOfDate(value: string): Date {
  const result = dateOnly(value);
  result.setHours(23, 59, 59, 999);
  return result;
}

function fullName(person: {
  firstName: string;
  lastName: string;
  middleName: string | null;
}): string {
  return [person.lastName, person.firstName, person.middleName].filter(Boolean).join(' ');
}

function tariffSummary(tariff: Tariff & { branch?: { name: string } | null }): TariffSummary {
  return {
    archivedAt: tariff.archivedAt?.toISOString(),
    branchId: tariff.branchId ?? undefined,
    branchName: tariff.branch?.name,
    createdAt: tariff.createdAt.toISOString(),
    currency: tariff.currency,
    description: tariff.description ?? undefined,
    freezeDays: tariff.freezeDays ?? undefined,
    id: tariff.id,
    isActive: tariff.isActive,
    lessonCount: tariff.lessonCount ?? undefined,
    name: tariff.name,
    price: tariff.price,
    type: tariff.type,
    updatedAt: tariff.updatedAt.toISOString(),
    validityDays: tariff.validityDays ?? undefined,
  };
}

function paidAmount(subscription: SubscriptionRecord): number {
  return subscription.payments
    .filter(({ status }) => status !== 'CANCELLED')
    .reduce(
      (total, payment) =>
        total + payment.amount - payment.refunds.reduce((sum, refund) => sum + refund.amount, 0),
      0,
    );
}

function subscriptionSummary(
  subscription: SubscriptionRecord,
  now = new Date(),
): SubscriptionSummary {
  const paid = paidAmount(subscription);
  const hasRefund = subscription.payments.some((payment) => payment.refunds.length > 0);
  const remainingLessons =
    subscription.lessonLimit === null
      ? undefined
      : Math.max(0, subscription.lessonLimit - subscription.lessonsUsed);
  return {
    branchId: subscription.branchId,
    branchName: subscription.branch.name,
    createdAt: subscription.createdAt.toISOString(),
    currency: subscription.tariff.currency,
    debt: Math.max(0, subscription.salePrice - paid),
    expiresAt: subscription.expiresAt?.toISOString(),
    expiringSoon: Boolean(subscription.expiresAt && isExpiringSoon(subscription.expiresAt, now)),
    freezeEndsAt: subscription.freezeEndsAt?.toISOString(),
    freezeStartedAt: subscription.freezeStartedAt?.toISOString(),
    frozenDaysUsed: subscription.frozenDaysUsed,
    id: subscription.id,
    lessonLimit: subscription.lessonLimit ?? undefined,
    lessonsUsed: subscription.lessonsUsed,
    lowBalance: isLowLessonBalance(remainingLessons),
    notes: subscription.notes ?? undefined,
    paidAmount: paid,
    paymentStatus:
      paid >= subscription.salePrice
        ? 'PAID'
        : paid > 0
          ? 'PARTIALLY_PAID'
          : hasRefund
            ? 'REFUNDED'
            : 'UNPAID',
    purchasedAt: subscription.purchasedAt.toISOString(),
    remainingLessons,
    salePrice: subscription.salePrice,
    startsAt: subscription.startsAt.toISOString(),
    status: subscription.status,
    studentId: subscription.studentId,
    studentName: fullName(subscription.student),
    tariffId: subscription.tariffId,
    tariffName: subscription.tariff.name,
    tariffType: subscription.tariff.type,
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

const reservingPaymentOperationStatuses = ['CREATED', 'WAITING_FOR_PAYMENT', 'PROCESSING'] as const;

export async function availableSubscriptionPaymentAmount(
  client: FinanceClient,
  subscriptionId: string,
  excludeOperationId?: string,
): Promise<number> {
  const subscription = await client.subscription.findUnique({
    include: subscriptionInclude,
    where: { id: subscriptionId },
  });
  if (!subscription) throw new DomainError('NOT_FOUND', t('domain.notFound.subscription'));
  const reserved = await client.paymentOperation.aggregate({
    _sum: { amount: true },
    where: {
      ...(excludeOperationId ? { id: { not: excludeOperationId } } : {}),
      status: { in: [...reservingPaymentOperationStatuses] },
      subscriptionId,
    },
  });
  return Math.max(0, subscriptionSummary(subscription).debt - (reserved._sum.amount ?? 0));
}

function refundSummary(refund: PaymentRecord['refunds'][number]): RefundSummary {
  return {
    amount: refund.amount,
    createdAt: refund.createdAt.toISOString(),
    createdByName: refund.createdByUser.fullName,
    id: refund.id,
    paymentId: refund.paymentId,
    reason: refund.reason,
    refundedAt: refund.refundedAt.toISOString(),
  };
}

function paymentSummary(payment: PaymentRecord): PaymentSummary {
  const refundedAmount = payment.refunds.reduce((sum, refund) => sum + refund.amount, 0);
  return {
    amount: payment.amount,
    branchId: payment.branchId,
    branchName: payment.branch.name,
    comment: payment.comment ?? undefined,
    createdAt: payment.createdAt.toISOString(),
    createdByName: payment.createdByUser.fullName,
    externalReference: payment.externalReference ?? undefined,
    id: payment.id,
    netAmount: payment.status === 'CANCELLED' ? 0 : payment.amount - refundedAmount,
    paidAt: payment.paidAt.toISOString(),
    paymentMethod: payment.paymentMethod,
    refundedAmount,
    status: payment.status,
    studentId: payment.studentId,
    studentName: fullName(payment.student),
    studentPhone: payment.student.phone ?? undefined,
    subscriptionId: payment.subscriptionId ?? undefined,
    subscriptionName: payment.subscription?.tariff.name,
    updatedAt: payment.updatedAt.toISOString(),
  };
}

export async function createCanonicalPayment(
  client: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  input: PaymentInput & {
    attendancePaymentOperationId?: string | undefined;
    subscriptionPaymentOperationId?: string | undefined;
  },
): Promise<{ id: string }> {
  assertPermission(actor, 'payments:manage');
  if (!Number.isInteger(input.amount) || input.amount <= 0)
    throw new DomainError('VALIDATION', t('validation.moneyPositive'));
  assertBranchAccess(actor, input.branchId);
  const student = await client.student.findUnique({ where: { id: input.studentId } });
  if (!student) throw new DomainError('NOT_FOUND', t('domain.notFound.student'));
  if (student.branchId !== input.branchId)
    throw new DomainError('VALIDATION', t('domain.validation.paymentBranch'));
  if (input.subscriptionId) {
    const subscription = await client.subscription.findUnique({
      include: subscriptionInclude,
      where: { id: input.subscriptionId },
    });
    if (!subscription) throw new DomainError('NOT_FOUND', t('domain.notFound.subscription'));
    if (subscription.studentId !== input.studentId || subscription.branchId !== input.branchId)
      throw new DomainError('VALIDATION', t('domain.validation.paymentSubscription'));
    const available = await availableSubscriptionPaymentAmount(
      client,
      input.subscriptionId,
      input.subscriptionPaymentOperationId,
    );
    if (input.amount > available)
      throw new DomainError('VALIDATION', t('domain.validation.paymentExceedsDebt'));
  }
  if (Boolean(input.attendanceLessonId) !== Boolean(input.attendanceTariffId))
    throw new DomainError('VALIDATION', 'Для оплаты посещения выберите занятие и тариф.');
  if (input.attendanceLessonId) {
    if (input.subscriptionId)
      throw new DomainError(
        'VALIDATION',
        'Оплата посещения не может одновременно оплачивать абонемент.',
      );
    await assertDirectAttendancePayment(client, {
      amount: input.amount,
      branchId: input.branchId,
      lessonId: input.attendanceLessonId,
      studentId: input.studentId,
      tariffId: input.attendanceTariffId ?? '',
      operationId: input.attendancePaymentOperationId,
    });
  }
  const created = await client.payment.create({
    data: {
      amount: input.amount,
      branchId: input.branchId,
      comment: optionalValue(input.comment),
      createdByUserId: actor.id,
      externalReference: optionalValue(input.externalReference),
      paidAt: new Date(input.paidAt),
      paymentMethod: input.paymentMethod,
      studentId: input.studentId,
      subscriptionId: input.subscriptionId ?? null,
      attendanceLessonId: input.attendanceLessonId ?? null,
      attendanceTariffId: input.attendanceTariffId ?? null,
    },
  });
  if (input.attendanceLessonId) {
    const claimed = await client.attendance.updateMany({
      data: {
        directPaymentId: created.id,
        directPaymentOperationId: null,
        directPaymentTariffId: input.attendanceTariffId ?? null,
      },
      where: {
        directPaymentId: null,
        directPaymentOperationId: input.attendancePaymentOperationId ?? null,
        lessonId: input.attendanceLessonId,
        studentId: input.studentId,
      },
    });
    if (claimed.count !== 1)
      throw new DomainError('CONFLICT', 'Это посещение уже оплачено или находится в оплате.');
  }
  const register = await ensurePaymentRegister(client, input.branchId, input.paymentMethod);
  await client.cashTransaction.create({
    data: {
      amount: input.amount,
      branchId: input.branchId,
      cashRegisterId: register.id,
      comment: optionalValue(input.comment) ?? 'Оплата ученика',
      createdByUserId: actor.id,
      occurredAt: new Date(input.paidAt),
      sourceId: created.id,
      sourceType: 'PAYMENT',
      type: 'INCOME',
    },
  });
  await client.auditLog.create({
    data: {
      action: 'PAYMENT_CREATED',
      actorUserId: actor.id,
      detail: JSON.stringify({ amount: input.amount, subscriptionId: input.subscriptionId }),
      entityId: created.id,
      entityType: 'Payment',
    },
  });
  if (input.attendanceLessonId)
    await client.auditLog.create({
      data: {
        action: 'ATTENDANCE_DIRECT_PAYMENT_COMPLETED',
        actorUserId: actor.id,
        detail: JSON.stringify({
          amount: input.amount,
          lessonId: input.attendanceLessonId,
          tariffId: input.attendanceTariffId,
        }),
        entityId: `${input.attendanceLessonId}:${input.studentId}`,
        entityType: 'Attendance',
      },
    });
  return created;
}

export async function assertDirectAttendancePayment(
  client: FinanceClient,
  input: {
    amount: number;
    branchId: string;
    lessonId: string;
    operationId?: string | undefined;
    studentId: string;
    tariffId: string;
  },
): Promise<void> {
  const [attendance, tariff, writeOffs] = await Promise.all([
    client.attendance.findUnique({
      include: { lesson: { select: { branchId: true, status: true } } },
      where: { lessonId_studentId: { lessonId: input.lessonId, studentId: input.studentId } },
    }),
    client.tariff.findUnique({ where: { id: input.tariffId } }),
    client.subscriptionLedger.findMany({
      include: { reversals: { select: { id: true } } },
      where: {
        attendanceId: `${input.lessonId}:${input.studentId}`,
        type: 'LESSON_WRITE_OFF',
      },
    }),
  ]);
  if (!attendance) throw new DomainError('NOT_FOUND', 'Посещение не найдено.');
  if (!['PRESENT', 'LATE'].includes(attendance.status) || attendance.lesson.status === 'CANCELLED')
    throw new DomainError('VALIDATION', 'Оплатить можно только состоявшееся посещение.');
  if (attendance.lesson.branchId !== input.branchId)
    throw new DomainError('VALIDATION', 'Посещение относится к другому филиалу.');
  if (
    attendance.directPaymentId ||
    (attendance.directPaymentOperationId &&
      attendance.directPaymentOperationId !== input.operationId)
  )
    throw new DomainError('CONFLICT', 'Это посещение уже оплачено или находится в оплате.');
  if (writeOffs.some(({ reversals }) => reversals.length === 0))
    throw new DomainError('CONFLICT', 'Посещение уже списано с абонемента.');
  if (
    tariff?.type !== 'SINGLE_LESSON' ||
    !tariff.isActive ||
    tariff.archivedAt ||
    (tariff.branchId !== null && tariff.branchId !== input.branchId)
  )
    throw new DomainError('VALIDATION', 'Выбранный разовый тариф недоступен для этого филиала.');
  if (tariff.price !== input.amount)
    throw new DomainError('VALIDATION', 'Стоимость должна совпадать с выбранным тарифом.');
}

export class FinanceService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async listTariffs(token: string, query: TariffListQuery): Promise<TariffSummary[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'tariffs:read');
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const branchIds = accessibleBranchIds(actor);
    const tariffs = await this.database.tariff.findMany({
      include: { branch: { select: { name: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      where: {
        ...(query.branchId
          ? { OR: [{ branchId: null }, { branchId: query.branchId }] }
          : branchIds
            ? { OR: [{ branchId: null }, { branchId: { in: branchIds } }] }
            : {}),
        ...(query.includeArchived ? {} : { archivedAt: null, isActive: true }),
        ...(query.search ? { name: { contains: query.search.trim() } } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
    });
    return tariffs.map(tariffSummary);
  }

  async getTariff(token: string, id: string): Promise<TariffSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'tariffs:read');
    const tariff = await this.requireTariff(id);
    if (tariff.branchId) assertBranchAccess(actor, tariff.branchId);
    return tariffSummary(tariff);
  }

  async createTariff(token: string, input: TariffInput): Promise<TariffSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'tariffs:manage');
    this.assertTariffInput(input);
    this.assertTariffBranch(actor, input.branchId);
    const tariff = await this.database.$transaction(async (transaction) => {
      const created = await transaction.tariff.create({
        data: this.tariffData(input),
        include: { branch: { select: { name: true } } },
      });
      await this.audit(transaction, actor.id, 'TARIFF_CREATED', 'Tariff', created.id);
      return created;
    });
    return tariffSummary(tariff);
  }

  async updateTariff(token: string, id: string, input: TariffInput): Promise<TariffSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'tariffs:manage');
    this.assertTariffInput(input);
    const current = await this.requireTariff(id);
    this.assertTariffBranch(actor, current.branchId ?? undefined);
    this.assertTariffBranch(actor, input.branchId);
    if (
      (current.type !== input.type || current.lessonCount !== (input.lessonCount ?? null)) &&
      (await this.database.subscription.count({ where: { tariffId: id } })) > 0
    )
      throw new DomainError('VALIDATION', t('domain.validation.soldTariffStructure'));
    const tariff = await this.database.$transaction(async (transaction) => {
      const updated = await transaction.tariff.update({
        data: this.tariffData(input),
        include: { branch: { select: { name: true } } },
        where: { id },
      });
      await this.audit(transaction, actor.id, 'TARIFF_UPDATED', 'Tariff', id);
      return updated;
    });
    return tariffSummary(tariff);
  }

  async archiveTariff(token: string, id: string): Promise<TariffSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'tariffs:manage');
    const current = await this.requireTariff(id);
    this.assertTariffBranch(actor, current.branchId ?? undefined);
    const tariff = await this.database.$transaction(async (transaction) => {
      const archived = await transaction.tariff.update({
        data: { archivedAt: new Date(), isActive: false },
        include: { branch: { select: { name: true } } },
        where: { id },
      });
      await this.audit(transaction, actor.id, 'TARIFF_ARCHIVED', 'Tariff', id);
      return archived;
    });
    return tariffSummary(tariff);
  }

  async createSubscription(
    token: string,
    input: SubscriptionCreateInput,
  ): Promise<SubscriptionDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'subscriptions:manage');
    if (!Number.isInteger(input.salePrice) || input.salePrice < 0)
      throw new DomainError('VALIDATION', t('validation.money'));
    if (
      input.initialPayment &&
      (!Number.isInteger(input.initialPayment.amount) ||
        input.initialPayment.amount <= 0 ||
        input.initialPayment.amount > input.salePrice)
    )
      throw new DomainError('VALIDATION', t('validation.payment.exceedsSale'));
    const student = await this.database.student.findUnique({ where: { id: input.studentId } });
    if (!student) throw new DomainError('NOT_FOUND', t('domain.notFound.student'));
    if (student.archivedAt)
      throw new DomainError('VALIDATION', t('domain.validation.studentArchived'));
    const tariff = await this.requireTariff(input.tariffId);
    if (!tariff.isActive || tariff.archivedAt)
      throw new DomainError('VALIDATION', t('domain.validation.tariffArchived'));
    const branchId = tariff.branchId ?? student.branchId;
    if (tariff.branchId && tariff.branchId !== student.branchId)
      throw new DomainError('VALIDATION', t('domain.validation.tariffBranch'));
    assertBranchAccess(actor, branchId);
    const startsAt = dateOnly(input.startsAt);
    const lessonLimit = tariff.type === 'UNLIMITED' ? null : tariff.lessonCount;
    const expiresAt = input.expiresAt
      ? endOfDate(input.expiresAt)
      : tariff.validityDays
        ? addDays(startsAt, tariff.validityDays)
        : null;
    if (expiresAt && expiresAt < startsAt)
      throw new DomainError('VALIDATION', 'Дата окончания не может быть раньше даты начала.');
    const status = startsAt > new Date() ? 'PENDING' : 'ACTIVE';
    const subscriptionId = await this.database.$transaction(async (transaction) => {
      const subscription = await transaction.subscription.create({
        data: {
          branchId,
          createdByUserId: actor.id,
          expiresAt,
          lessonLimit,
          notes: optionalValue(input.notes),
          purchasedAt: new Date(),
          salePrice: input.salePrice,
          startsAt,
          status,
          studentId: input.studentId,
          tariffId: input.tariffId,
        },
      });
      await transaction.subscriptionLedger.create({
        data: {
          amountDelta: input.salePrice,
          comment: t('ledger.comment.purchase'),
          createdByUserId: actor.id,
          studentId: input.studentId,
          subscriptionId: subscription.id,
          type: 'PURCHASE',
        },
      });
      if (input.initialPayment) {
        const payment = await transaction.payment.create({
          data: {
            amount: input.initialPayment.amount,
            branchId,
            comment: optionalValue(input.initialPayment.comment),
            createdByUserId: actor.id,
            paidAt: new Date(input.initialPayment.paidAt),
            paymentMethod: input.initialPayment.paymentMethod,
            studentId: input.studentId,
            subscriptionId: subscription.id,
          },
        });
        await this.audit(transaction, actor.id, 'PAYMENT_CREATED', 'Payment', payment.id, {
          amount: input.initialPayment.amount,
          subscriptionId: subscription.id,
        });
      }
      await this.audit(
        transaction,
        actor.id,
        'SUBSCRIPTION_CREATED',
        'Subscription',
        subscription.id,
        {
          salePrice: input.salePrice,
          studentId: input.studentId,
          tariffId: input.tariffId,
        },
      );
      await reconcileStudentAttendanceCoverage(transaction, {
        actorUserId: actor.id,
        studentId: input.studentId,
      });
      return subscription.id;
    });
    return this.getSubscription(token, subscriptionId);
  }

  async listStudentSubscriptions(token: string, studentId: string): Promise<StudentFinanceSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'subscriptions:read');
    await this.assertStudentFinanceAccess(actor, studentId);
    await this.refreshStudentSubscriptions(studentId, actor.id);
    const subscriptions = await this.database.subscription.findMany({
      include: subscriptionInclude,
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      where: { studentId },
    });
    const summaries = subscriptions.map((subscription) => subscriptionSummary(subscription));
    const uncoveredAttendances = await this.uncoveredAttendances(studentId);
    const uncoveredDebt = uncoveredAttendances.reduce(
      (sum, attendance) => sum + (attendance.amount ?? 0),
      0,
    );
    return {
      activeSubscriptions: summaries.filter(
        ({ status }) => status === 'ACTIVE' || status === 'FROZEN',
      ).length,
      expiringSoon: summaries.filter(({ expiringSoon }) => expiringSoon).length,
      lowBalance: summaries.filter(({ lowBalance }) => lowBalance).length,
      subscriptions: summaries,
      totalDebt:
        summaries.reduce((sum, subscription) => sum + subscription.debt, 0) + uncoveredDebt,
      uncoveredAttendances,
      uncoveredDebt,
      unpricedUncoveredAttendanceCount: uncoveredAttendances.filter(
        ({ amount }) => amount === undefined,
      ).length,
    };
  }

  async updateSubscription(
    token: string,
    id: string,
    input: SubscriptionUpdateInput,
  ): Promise<SubscriptionDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'subscriptions:manage');
    const current = await this.requireSubscription(id);
    assertBranchAccess(actor, current.branchId);
    if (current.status === 'CANCELLED')
      throw new DomainError('VALIDATION', 'Отменённый абонемент нельзя изменить.');
    const tariff = await this.requireTariff(input.tariffId);
    if (!tariff.isActive || tariff.archivedAt)
      throw new DomainError('VALIDATION', t('domain.validation.tariffArchived'));
    if (tariff.branchId && tariff.branchId !== current.branchId)
      throw new DomainError('VALIDATION', t('domain.validation.tariffBranch'));
    const changingTariff = current.tariffId !== input.tariffId;
    if (changingTariff) {
      const [payments, operations] = await Promise.all([
        this.database.payment.count({ where: { subscriptionId: id } }),
        this.database.paymentOperation.count({ where: { subscriptionId: id } }),
      ]);
      if (payments || operations)
        throw new DomainError(
          'VALIDATION',
          'Тариф нельзя изменить после проведения оплаты. Даты и примечание можно исправить.',
        );
    }
    const startsAt = dateOnly(input.startsAt);
    const expiresAt = input.expiresAt
      ? endOfDate(input.expiresAt)
      : tariff.validityDays
        ? addDays(startsAt, tariff.validityDays)
        : null;
    if (expiresAt && expiresAt < startsAt)
      throw new DomainError('VALIDATION', 'Дата окончания не может быть раньше даты начала.');
    const lessonLimit = tariff.type === 'UNLIMITED' ? null : tariff.lessonCount;
    if (lessonLimit !== null && current.lessonsUsed > lessonLimit)
      throw new DomainError('VALIDATION', 'Новый тариф не может вместить уже учтённые занятия.');
    await this.database.$transaction(async (transaction) => {
      await transaction.subscription.update({
        data: {
          expiresAt,
          lessonLimit,
          notes: optionalValue(input.notes),
          startsAt,
          status: subscriptionStatusAt({
            ...current,
            expiresAt,
            lessonLimit,
            startsAt,
          }),
          tariffId: input.tariffId,
        },
        where: { id },
      });
      await reconcileStudentAttendanceCoverage(transaction, {
        actorUserId: actor.id,
        studentId: current.studentId,
      });
      await this.audit(transaction, actor.id, 'SUBSCRIPTION_UPDATED', 'Subscription', id, {
        after: { expiresAt, notes: optionalValue(input.notes), startsAt, tariffId: input.tariffId },
        before: {
          expiresAt: current.expiresAt,
          notes: current.notes,
          startsAt: current.startsAt,
          tariffId: current.tariffId,
        },
      });
    });
    return this.getSubscription(token, id);
  }

  async getSubscription(token: string, id: string): Promise<SubscriptionDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'subscriptions:read');
    await this.refreshSubscription(id, actor.id);
    const subscription = await this.requireSubscription(id);
    await this.assertStudentFinanceAccess(actor, subscription.studentId);
    const ledger = await this.database.subscriptionLedger.findMany({
      include: { createdByUser: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      where: { subscriptionId: id },
    });
    const payments = await this.database.payment.findMany({
      include: paymentInclude,
      orderBy: { paidAt: 'desc' },
      where: { subscriptionId: id },
    });
    return {
      ...subscriptionSummary(subscription),
      ledger: ledger.map((entry): LedgerEntrySummary => ({
        amountDelta: entry.amountDelta ?? undefined,
        attendanceId: entry.attendanceId ?? undefined,
        comment: entry.comment ?? undefined,
        createdAt: entry.createdAt.toISOString(),
        createdByName: entry.createdByUser?.fullName,
        id: entry.id,
        lessonDelta: entry.lessonDelta,
        lessonId: entry.lessonId ?? undefined,
        reversesLedgerId: entry.reversesLedgerId ?? undefined,
        type: entry.type,
      })),
      payments: payments.map(paymentSummary),
    };
  }

  async freezeSubscription(
    token: string,
    id: string,
    input: SubscriptionFreezeInput,
    webAction?: { id: string; processedByUserId: string },
  ): Promise<SubscriptionDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'subscriptions:manage');
    if (!Number.isInteger(input.days) || input.days < 1)
      throw new DomainError('VALIDATION', t('validation.freezeDays'));
    await this.refreshSubscription(id, actor.id);
    const subscription = await this.requireSubscription(id);
    assertBranchAccess(actor, subscription.branchId);
    if (subscription.status !== 'ACTIVE')
      throw new DomainError('VALIDATION', t('domain.validation.freezeActiveOnly'));
    const allowance = subscription.tariff.freezeDays ?? 0;
    if (input.days > allowance - subscription.frozenDaysUsed)
      throw new DomainError('VALIDATION', t('domain.validation.freezeLimit'));
    await this.database.$transaction(async (transaction) => {
      const now = new Date();
      await transaction.subscription.update({
        data: { freezeEndsAt: addDays(now, input.days), freezeStartedAt: now, status: 'FROZEN' },
        where: { id },
      });
      const ledger = await transaction.subscriptionLedger.create({
        data: {
          comment: t('ledger.comment.freeze', { days: input.days }),
          createdByUserId: actor.id,
          studentId: subscription.studentId,
          subscriptionId: id,
          type: 'FREEZE',
        },
      });
      await this.audit(transaction, actor.id, 'SUBSCRIPTION_FROZEN', 'Subscription', id, {
        days: input.days,
        ledgerId: ledger.id,
      });
      if (webAction) {
        await transaction.webAction.update({
          data: {
            nextCompletionAttemptAt: now,
            processedAt: now,
            processedByUserId: webAction.processedByUserId,
            safeError: null,
            safeResultJson: JSON.stringify({ status: 'SUCCEEDED' }),
            status: 'SUCCEEDED_ACK_PENDING',
          },
          where: { id: webAction.id, status: 'CLAIMED' },
        });
      }
    });
    return this.getSubscription(token, id);
  }

  async unfreezeSubscription(token: string, id: string): Promise<SubscriptionDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'subscriptions:manage');
    const subscription = await this.requireSubscription(id);
    assertBranchAccess(actor, subscription.branchId);
    if (subscription.status !== 'FROZEN')
      throw new DomainError('VALIDATION', t('domain.validation.notFrozen'));
    await this.unfreeze(this.database, subscription, actor.id, new Date());
    return this.getSubscription(token, id);
  }

  async adjustSubscription(
    token: string,
    id: string,
    input: SubscriptionAdjustmentInput,
  ): Promise<SubscriptionDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'subscriptions:adjust');
    if (!Number.isInteger(input.lessonDelta) || input.lessonDelta === 0)
      throw new DomainError('VALIDATION', t('validation.adjustmentDelta'));
    if (input.comment.trim().length < 3)
      throw new DomainError('VALIDATION', t('validation.adjustmentReason'));
    const subscription = await this.requireSubscription(id);
    const lessonsUsed = subscription.lessonsUsed + input.lessonDelta;
    if (lessonsUsed < 0)
      throw new DomainError('VALIDATION', t('domain.validation.negativeLessonUsage'));
    await this.database.$transaction(async (transaction) => {
      await transaction.subscription.update({
        data: { lessonsUsed, status: subscriptionStatusAt({ ...subscription, lessonsUsed }) },
        where: { id },
      });
      const ledger = await transaction.subscriptionLedger.create({
        data: {
          comment: input.comment.trim(),
          createdByUserId: actor.id,
          lessonDelta: input.lessonDelta,
          studentId: subscription.studentId,
          subscriptionId: id,
          type: 'MANUAL_ADJUSTMENT',
        },
      });
      await this.audit(transaction, actor.id, 'SUBSCRIPTION_BALANCE_ADJUSTED', 'Subscription', id, {
        lessonDelta: input.lessonDelta,
        ledgerId: ledger.id,
      });
    });
    return this.getSubscription(token, id);
  }

  async cancelSubscription(token: string, id: string): Promise<SubscriptionDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'subscriptions:manage');
    const subscription = await this.requireSubscription(id);
    assertBranchAccess(actor, subscription.branchId);
    await this.database.$transaction(async (transaction) => {
      await transaction.subscription.update({ data: { status: 'CANCELLED' }, where: { id } });
      await this.audit(transaction, actor.id, 'SUBSCRIPTION_CANCELLED', 'Subscription', id);
    });
    return this.getSubscription(token, id);
  }

  async createPayment(token: string, input: PaymentInput): Promise<PaymentDetail> {
    const actor = await this.application.authenticate(token);
    const payment = await this.database.$transaction((transaction) =>
      createCanonicalPayment(transaction, actor, input),
    );
    return this.getPayment(token, payment.id);
  }

  async listPayments(token: string, query: PaymentListQuery): Promise<PaymentSummary[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payments:read');
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const branchIds = accessibleBranchIds(actor);
    const searchTokens = query.search?.split(/\s+/u).filter(Boolean) ?? [];
    const payments = await this.database.payment.findMany({
      include: paymentInclude,
      orderBy: { paidAt: 'desc' },
      where: {
        AND: searchTokens.map((search) => ({
          OR: [
            { student: { firstName: { contains: search } } },
            { student: { lastName: { contains: search } } },
            { student: { middleName: { contains: search } } },
            { student: { phone: { contains: search } } },
          ],
        })),
        ...(query.branchId
          ? { branchId: query.branchId }
          : branchIds
            ? { branchId: { in: branchIds } }
            : {}),
        ...(query.createdByUserId ? { createdByUserId: query.createdByUserId } : {}),
        ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
        ...(query.status ? { status: query.status } : {}),
        paidAt: { gte: new Date(query.dateFrom), lte: new Date(query.dateTo) },
      },
    });
    return payments.map(paymentSummary);
  }

  async getPayment(token: string, id: string): Promise<PaymentDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payments:read');
    const payment = await this.requirePayment(id);
    assertBranchAccess(actor, payment.branchId);
    return { ...paymentSummary(payment), refunds: payment.refunds.map(refundSummary) };
  }

  async cancelPayment(token: string, id: string): Promise<PaymentDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'refunds:manage');
    const payment = await this.requirePayment(id);
    if (payment.status !== 'COMPLETED' || payment.refunds.length)
      throw new DomainError('VALIDATION', t('domain.validation.paymentCancellation'));
    await this.database.$transaction(async (transaction) => {
      await transaction.payment.update({ data: { status: 'CANCELLED' }, where: { id } });
      await transaction.attendance.updateMany({
        data: { directPaymentId: null, directPaymentTariffId: null },
        where: { directPaymentId: id },
      });
      const income = await transaction.cashTransaction.findFirst({
        where: { sourceId: id, sourceType: 'PAYMENT', type: 'INCOME' },
      });
      const register = income
        ? await transaction.cashRegister.findUniqueOrThrow({ where: { id: income.cashRegisterId } })
        : await ensurePaymentRegister(transaction, payment.branchId, payment.paymentMethod);
      await transaction.cashTransaction.create({
        data: {
          amount: payment.amount,
          branchId: payment.branchId,
          cashRegisterId: register.id,
          comment: 'Отмена платежа',
          createdByUserId: actor.id,
          occurredAt: new Date(),
          sourceId: id,
          sourceType: 'REFUND',
          type: 'EXPENSE',
        },
      });
      await this.audit(transaction, actor.id, 'PAYMENT_CANCELLED', 'Payment', id, {
        amount: payment.amount,
      });
    });
    return this.getPayment(token, id);
  }

  async createRefund(token: string, paymentId: string, input: RefundInput): Promise<PaymentDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'refunds:manage');
    if (!Number.isInteger(input.amount) || input.amount <= 0)
      throw new DomainError('VALIDATION', t('validation.moneyPositive'));
    if (input.reason.trim().length < 3)
      throw new DomainError('VALIDATION', t('validation.refundReason'));
    await this.database.$transaction(async (transaction) => {
      const payment = await transaction.payment.findUnique({
        include: paymentInclude,
        where: { id: paymentId },
      });
      if (!payment) throw new DomainError('NOT_FOUND', t('domain.notFound.payment'));
      if (payment.status === 'CANCELLED')
        throw new DomainError('VALIDATION', t('domain.validation.refundCancelled'));
      const refunded = payment.refunds.reduce((sum, refund) => sum + refund.amount, 0);
      if (refunded + input.amount > payment.amount)
        throw new DomainError('VALIDATION', t('domain.validation.refundExceedsPayment'));
      const refund = await transaction.refund.create({
        data: {
          amount: input.amount,
          createdByUserId: actor.id,
          paymentId,
          reason: input.reason.trim(),
          refundedAt: new Date(input.refundedAt),
        },
      });
      const income = await transaction.cashTransaction.findFirst({
        where: { sourceId: paymentId, sourceType: 'PAYMENT', type: 'INCOME' },
      });
      const register = income
        ? await transaction.cashRegister.findUniqueOrThrow({ where: { id: income.cashRegisterId } })
        : await ensurePaymentRegister(transaction, payment.branchId, payment.paymentMethod);
      await transaction.cashTransaction.create({
        data: {
          amount: input.amount,
          branchId: payment.branchId,
          cashRegisterId: register.id,
          comment: input.reason.trim(),
          createdByUserId: actor.id,
          occurredAt: new Date(input.refundedAt),
          sourceId: refund.id,
          sourceType: 'REFUND',
          type: 'EXPENSE',
        },
      });
      const total = refunded + input.amount;
      await transaction.payment.update({
        data: { status: total === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
        where: { id: paymentId },
      });
      if (total === payment.amount)
        await transaction.attendance.updateMany({
          data: { directPaymentId: null, directPaymentTariffId: null },
          where: { directPaymentId: paymentId },
        });
      await this.audit(transaction, actor.id, 'PAYMENT_REFUNDED', 'Refund', refund.id, {
        amount: input.amount,
        paymentId,
        reason: input.reason,
      });
    });
    return this.getPayment(token, paymentId);
  }

  async listFinanceEmployees(token: string): Promise<StaffOption[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'finance:read');
    const branchIds = accessibleBranchIds(actor);
    return this.database.user.findMany({
      orderBy: { fullName: 'asc' },
      select: { fullName: true, id: true, role: true },
      where: {
        isActive: true,
        role: { in: ['OWNER', 'ADMIN'] },
        ...(branchIds ? { branchAssignments: { some: { branchId: { in: branchIds } } } } : {}),
      },
    });
  }

  async financeStats(token: string, branchId?: string): Promise<FinanceStats> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'finance:read');
    if (branchId) assertBranchAccess(actor, branchId);
    const branchIds = accessibleBranchIds(actor);
    const scope = branchId ? { branchId } : branchIds ? { branchId: { in: branchIds } } : {};
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [payments, refunds, subscriptions] = await Promise.all([
      this.database.payment.findMany({
        where: { ...scope, paidAt: { gte: monthStart }, status: { not: 'CANCELLED' } },
      }),
      this.database.refund.findMany({
        include: { payment: { select: { paymentMethod: true } } },
        where: { payment: scope, refundedAt: { gte: monthStart } },
      }),
      this.database.subscription.findMany({
        include: subscriptionInclude,
        where: { ...scope, status: { not: 'CANCELLED' } },
      }),
    ]);
    const revenueThisMonth =
      payments.reduce((sum, payment) => sum + payment.amount, 0) -
      refunds.reduce((sum, refund) => sum + refund.amount, 0);
    const revenueToday =
      payments
        .filter(({ paidAt }) => paidAt >= dayStart)
        .reduce((sum, payment) => sum + payment.amount, 0) -
      refunds
        .filter(({ refundedAt }) => refundedAt >= dayStart)
        .reduce((sum, refund) => sum + refund.amount, 0);
    const methodTotals = new Map<string, number>();
    for (const payment of payments)
      methodTotals.set(
        payment.paymentMethod,
        (methodTotals.get(payment.paymentMethod) ?? 0) + payment.amount,
      );
    for (const refund of refunds)
      methodTotals.set(
        refund.payment.paymentMethod,
        (methodTotals.get(refund.payment.paymentMethod) ?? 0) - refund.amount,
      );
    return {
      methodBreakdown: [...methodTotals].map(([method, amount]) => ({
        amount,
        method: method as FinanceStats['methodBreakdown'][number]['method'],
      })),
      outstandingDebt: subscriptions.reduce(
        (sum, subscription) => sum + subscriptionSummary(subscription).debt,
        0,
      ),
      revenueThisMonth,
      revenueToday,
    };
  }

  private async uncoveredAttendances(studentId: string) {
    const [attendances, writeOffs, tariffs] = await Promise.all([
      this.database.attendance.findMany({
        include: {
          lesson: {
            include: {
              branch: { select: { name: true } },
              coach: { select: { fullName: true } },
              group: { select: { name: true } },
              substitution: {
                include: { substituteTrainer: { select: { fullName: true } } },
              },
            },
          },
        },
        orderBy: { markedAt: 'desc' },
        where: {
          lesson: { status: { not: 'CANCELLED' } },
          status: { in: ['PRESENT', 'LATE'] },
          studentId,
        },
      }),
      this.database.subscriptionLedger.findMany({
        include: { reversals: { select: { id: true } } },
        where: { studentId, type: 'LESSON_WRITE_OFF' },
      }),
      this.database.tariff.findMany({
        where: { archivedAt: null, isActive: true, type: 'SINGLE_LESSON' },
      }),
    ]);
    const covered = new Set(
      writeOffs.flatMap(({ attendanceId, reversals }) =>
        attendanceId && reversals.length === 0 ? [attendanceId] : [],
      ),
    );
    return attendances.flatMap((attendance) => {
      if (
        covered.has(`${attendance.lessonId}:${attendance.studentId}`) ||
        attendance.directPaymentId
      )
        return [];
      const branchTariffs = tariffs.filter(
        ({ branchId }) => branchId === attendance.lesson.branchId,
      );
      const globalTariffs = tariffs.filter(({ branchId }) => branchId === null);
      const eligibleTariffs = [...branchTariffs, ...globalTariffs];
      const priceSource = eligibleTariffs.length === 1 ? eligibleTariffs[0] : undefined;
      return [
        {
          amount: priceSource?.price,
          branchId: attendance.lesson.branchId,
          branchName: attendance.lesson.branch.name,
          groupName: attendance.lesson.group.name,
          lessonId: attendance.lessonId,
          paymentStatus: attendance.directPaymentOperationId
            ? ('PENDING' as const)
            : ('UNPAID' as const),
          startsAt: attendance.lesson.startsAt.toISOString(),
          status: attendance.status,
          tariffId: priceSource?.id,
          tariffs: eligibleTariffs.map(({ id, name, price }) => ({ id, name, price })),
          trainerName:
            attendance.lesson.substitution?.substituteTrainer.fullName ??
            attendance.lesson.coach?.fullName ??
            undefined,
        },
      ];
    });
  }

  private tariffData(input: TariffInput): Prisma.TariffUncheckedCreateInput {
    return {
      branchId: input.branchId ?? null,
      currency: input.currency,
      description: optionalValue(input.description),
      freezeDays: input.freezeDays ?? null,
      isActive: input.isActive,
      lessonCount: input.lessonCount ?? null,
      name: input.name.trim(),
      price: input.price,
      type: input.type,
      validityDays: input.validityDays ?? null,
    };
  }

  private assertTariffInput(input: TariffInput): void {
    if (!Number.isInteger(input.price) || input.price < 0)
      throw new DomainError('VALIDATION', t('validation.money'));
    if (input.type === 'LESSON_PACK' && !input.lessonCount)
      throw new DomainError('VALIDATION', t('validation.tariff.lessonPackCount'));
    if (input.type === 'UNLIMITED' && input.lessonCount !== undefined)
      throw new DomainError('VALIDATION', t('validation.tariff.unlimitedCount'));
    if ((input.type === 'SINGLE_LESSON' || input.type === 'TRIAL') && input.lessonCount !== 1)
      throw new DomainError('VALIDATION', t('validation.tariff.singleCount'));
  }

  private assertTariffBranch(actor: AuthenticatedUser, branchId: string | undefined): void {
    if (actor.role === 'ADMIN' && actor.branchIds.length > 0 && !branchId)
      throw new DomainError('AUTHORIZATION', t('domain.authorization.globalTariff'));
    if (branchId) assertBranchAccess(actor, branchId);
  }

  private async requireTariff(id: string): Promise<Tariff & { branch: { name: string } | null }> {
    const tariff = await this.database.tariff.findUnique({
      include: { branch: { select: { name: true } } },
      where: { id },
    });
    if (!tariff) throw new DomainError('NOT_FOUND', t('domain.notFound.tariff'));
    return tariff;
  }

  private async requireSubscription(id: string): Promise<SubscriptionRecord> {
    const subscription = await this.database.subscription.findUnique({
      include: subscriptionInclude,
      where: { id },
    });
    if (!subscription) throw new DomainError('NOT_FOUND', t('domain.notFound.subscription'));
    return subscription;
  }

  private async requirePayment(id: string): Promise<PaymentRecord> {
    const payment = await this.database.payment.findUnique({
      include: paymentInclude,
      where: { id },
    });
    if (!payment) throw new DomainError('NOT_FOUND', t('domain.notFound.payment'));
    return payment;
  }

  private async assertStudentFinanceAccess(
    actor: AuthenticatedUser,
    studentId: string,
  ): Promise<void> {
    const student = await this.database.student.findUnique({
      include: {
        enrollments: {
          include: { group: { select: { assistantCoachId: true, coachId: true } } },
          where: { leftAt: null, status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] } },
        },
      },
      where: { id: studentId },
    });
    if (!student) throw new DomainError('NOT_FOUND', t('domain.notFound.student'));
    assertBranchAccess(actor, student.branchId);
    if (
      actor.role === 'COACH' &&
      !student.enrollments.some(
        ({ group }) => group.coachId === actor.id || group.assistantCoachId === actor.id,
      )
    )
      throw new DomainError('AUTHORIZATION', t('domain.authorization.groupCoach'));
  }

  private async refreshStudentSubscriptions(studentId: string, actorUserId: string): Promise<void> {
    const subscriptions = await this.database.subscription.findMany({ where: { studentId } });
    for (const subscription of subscriptions) await this.refreshRecord(subscription, actorUserId);
  }

  private async refreshSubscription(id: string, actorUserId: string): Promise<void> {
    const subscription = await this.database.subscription.findUnique({ where: { id } });
    if (!subscription) throw new DomainError('NOT_FOUND', t('domain.notFound.subscription'));
    await this.refreshRecord(subscription, actorUserId);
  }

  private async refreshRecord(subscription: Subscription, actorUserId: string): Promise<void> {
    const now = new Date();
    if (
      subscription.status === 'FROZEN' &&
      subscription.freezeEndsAt &&
      subscription.freezeEndsAt <= now
    ) {
      await this.unfreeze(this.database, subscription, actorUserId, subscription.freezeEndsAt);
      return;
    }
    const status = subscriptionStatusAt(subscription, now);
    if (status !== subscription.status)
      await this.database.subscription.update({ data: { status }, where: { id: subscription.id } });
  }

  private async unfreeze(
    client: DatabaseClient,
    subscription: Subscription,
    actorUserId: string,
    endedAt: Date,
  ): Promise<void> {
    if (!subscription.freezeStartedAt)
      throw new DomainError('VALIDATION', t('domain.validation.notFrozen'));
    const actualDays = Math.max(
      1,
      Math.ceil((endedAt.getTime() - subscription.freezeStartedAt.getTime()) / DAY_MS),
    );
    const frozenDaysUsed = subscription.frozenDaysUsed + actualDays;
    const expiresAt = subscription.expiresAt ? addDays(subscription.expiresAt, actualDays) : null;
    await client.$transaction(async (transaction) => {
      const updated = await transaction.subscription.update({
        data: {
          expiresAt,
          freezeEndsAt: null,
          freezeStartedAt: null,
          frozenDaysUsed,
          status: 'ACTIVE',
        },
        where: { id: subscription.id },
      });
      await transaction.subscription.update({
        data: { status: subscriptionStatusAt(updated) },
        where: { id: subscription.id },
      });
      const ledger = await transaction.subscriptionLedger.create({
        data: {
          comment: t('ledger.comment.unfreeze', { days: actualDays }),
          createdByUserId: actorUserId,
          studentId: subscription.studentId,
          subscriptionId: subscription.id,
          type: 'UNFREEZE',
        },
      });
      await this.audit(
        transaction,
        actorUserId,
        'SUBSCRIPTION_UNFROZEN',
        'Subscription',
        subscription.id,
        {
          actualDays,
          ledgerId: ledger.id,
        },
      );
    });
  }

  private async audit(
    client: FinanceClient,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        action,
        actorUserId,
        detail: detail ? JSON.stringify(detail) : null,
        entityId,
        entityType,
      },
    });
  }
}
