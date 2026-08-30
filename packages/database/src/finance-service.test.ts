import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '@arava/shared';

import {
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  INITIAL_OWNER_EMAIL,
  INITIAL_OWNER_PASSWORD,
  toSqliteUrl,
  type DatabaseClient,
} from './index';
import { FinanceService } from './finance-service';
import { PaymentOperationService } from './payment-operation-service';
import { ApplicationService } from './services';
import { StudioService } from './studio-service';

const DAY_MS = 86_400_000;
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const freezeInput = (days: number, reason = 'Отпуск ученика') => ({
  endsAt: dateString(new Date(Date.now() + (days - 1) * DAY_MS)),
  reason,
  startsAt: dateString(new Date()),
});

describe('Sprint 3 finance service', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let finance: FinanceService;
  let ownerToken: string;
  let paymentOperations: PaymentOperationService;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-finance-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'finance.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    finance = new FinanceService(database, application);
    paymentOperations = new PaymentOperationService(database, application);
    studio = new StudioService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Secure2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function foundation(capacity = 20) {
    const branch = await application.createBranch(ownerToken, {
      address: 'ул. Финансовая, 1',
      name: 'Центр',
      phone: '+79990000001',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мила',
      lastName: 'Петрова',
      phone: '+79990000002',
      status: 'ACTIVE',
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity,
      direction: 'Хип-хоп',
      name: 'Импульс',
      status: 'ACTIVE',
    });
    const joinedAt = dateString(new Date(Date.now() - 7 * DAY_MS));
    await studio.addEnrollment(ownerToken, group.id, {
      joinedAt,
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    return { branch, group, joinedAt, student };
  }

  async function tariffAndSubscription(options?: {
    freezeDays?: number;
    lessonCount?: number;
    price?: number;
    validityDays?: number;
  }) {
    const base = await foundation();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: base.branch.id,
      currency: 'RUB',
      freezeDays: options?.freezeDays ?? 10,
      isActive: true,
      lessonCount: options?.lessonCount ?? 4,
      name: 'Четыре занятия',
      price: options?.price ?? 100_000,
      type: 'LESSON_PACK',
      validityDays: options?.validityDays ?? 30,
    });
    const subscription = await finance.createSubscription(ownerToken, {
      initialPayment: {
        amount: options?.price ?? 100_000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CARD',
      },
      salePrice: options?.price ?? 100_000,
      startsAt: dateString(new Date(Date.now() - DAY_MS)),
      studentId: base.student.id,
      tariffId: tariff.id,
    });
    return { ...base, subscription, tariff };
  }

  it('tracks post-sale debt, full and partial refunds without deleting history', async () => {
    const { branch, student, subscription } = await tariffAndSubscription();
    expect(subscription).toMatchObject({
      debt: 0,
      paidAmount: 100_000,
      paymentStatus: 'PAID',
      status: 'ACTIVE',
    });
    const salePayment = subscription.payments[0];
    if (!salePayment) throw new Error('Платёж продажи не создан.');
    await finance.createRefund(ownerToken, salePayment.id, {
      amount: 70_000,
      reason: 'Частичный возврат после продажи',
      refundedAt: new Date().toISOString(),
    });
    const payment = await finance.createPayment(ownerToken, {
      amount: 20_000,
      branchId: branch.id,
      paidAt: new Date().toISOString(),
      paymentMethod: 'TRANSFER',
      studentId: student.id,
      subscriptionId: subscription.id,
    });
    expect((await finance.getSubscription(ownerToken, subscription.id)).debt).toBe(50_000);
    const partial = await finance.createRefund(ownerToken, payment.id, {
      amount: 5_000,
      reason: 'Частичный возврат по заявлению',
      refundedAt: new Date().toISOString(),
    });
    expect(partial).toMatchObject({ refundedAmount: 5_000, status: 'PARTIALLY_REFUNDED' });
    const full = await finance.createRefund(ownerToken, payment.id, {
      amount: 15_000,
      reason: 'Возврат оставшейся суммы',
      refundedAt: new Date().toISOString(),
    });
    expect(full).toMatchObject({ refundedAmount: 20_000, status: 'REFUNDED' });
    await expect(
      finance.createRefund(ownerToken, payment.id, {
        amount: 1,
        reason: 'Недопустимый повторный возврат',
        refundedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(t('domain.validation.refundExceedsPayment'));
    expect(await database.payment.count()).toBe(2);
    expect(await database.refund.count()).toBe(3);
    expect(await finance.getSubscription(ownerToken, subscription.id)).toMatchObject({
      debt: 70_000,
      paymentStatus: 'PARTIALLY_PAID',
    });
  });

  it('enforces freeze limits, extends expiry, and audits freeze lifecycle', async () => {
    const { subscription } = await tariffAndSubscription({ freezeDays: 5 });
    const originalExpiry = new Date(subscription.expiresAt ?? 0).getTime();
    const frozen = await finance.freezeSubscription(ownerToken, subscription.id, freezeInput(3));
    expect(frozen.status).toBe('FROZEN');
    await expect(
      finance.freezeSubscription(ownerToken, subscription.id, freezeInput(1)),
    ).rejects.toThrow(t('domain.validation.freezeActiveOnly'));
    const active = await finance.unfreezeSubscription(ownerToken, subscription.id);
    expect(active.status).toBe('ACTIVE');
    expect(active.frozenDaysUsed).toBe(1);
    expect(new Date(active.expiresAt ?? 0).getTime()).toBe(originalExpiry + DAY_MS);
    await expect(
      finance.freezeSubscription(ownerToken, subscription.id, freezeInput(5)),
    ).rejects.toThrow(t('domain.validation.freezeLimit'));
    expect(
      await database.auditLog.count({
        where: { action: { in: ['SUBSCRIPTION_FROZEN', 'SUBSCRIPTION_UNFROZEN'] } },
      }),
    ).toBe(2);
  });

  it('creates planned subscriptions, calculates expiry and keeps cancelled history', async () => {
    const { branch, student } = await foundation();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 8,
      name: 'Восемь занятий',
      price: 80_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const startsAt = dateString(new Date(Date.now() + 3 * DAY_MS));
    const subscription = await finance.createSubscription(ownerToken, {
      initialPayment: {
        amount: tariff.price,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
      },
      salePrice: tariff.price,
      startsAt,
      studentId: student.id,
      tariffId: tariff.id,
    });
    expect(subscription).toMatchObject({
      debt: 0,
      paymentStatus: 'PAID',
      remainingLessons: 8,
      status: 'PENDING',
    });
    const expectedExpiry = new Date(`${startsAt}T00:00:00`);
    expectedExpiry.setDate(expectedExpiry.getDate() + 30);
    const actualExpiry = new Date(subscription.expiresAt ?? 0);
    expect([actualExpiry.getFullYear(), actualExpiry.getMonth(), actualExpiry.getDate()]).toEqual([
      expectedExpiry.getFullYear(),
      expectedExpiry.getMonth(),
      expectedExpiry.getDate(),
    ]);
    expect((await finance.cancelSubscription(ownerToken, subscription.id)).status).toBe(
      'CANCELLED',
    );
    expect(await database.subscription.count({ where: { id: subscription.id } })).toBe(1);
    expect(await database.payment.count({ where: { subscriptionId: subscription.id } })).toBe(1);
  });

  it('uses an explicit sale expiry without changing the tariff or sale price snapshot', async () => {
    const { branch, student } = await foundation();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 8,
      name: 'Гибкий срок',
      price: 82_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const startsAt = '2026-08-25';
    const subscription = await finance.createSubscription(ownerToken, {
      expiresAt: '2026-10-15',
      initialPayment: {
        amount: tariff.price,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
      },
      salePrice: tariff.price,
      startsAt,
      studentId: student.id,
      tariffId: tariff.id,
    });
    expect(subscription.salePrice).toBe(82_000);
    expect(subscription.expiresAt?.slice(0, 10)).toBe('2026-10-15');
    expect((await finance.getTariff(ownerToken, tariff.id)).price).toBe(82_000);
  });

  it('creates a manual sale, payment and cash entry atomically and idempotently', async () => {
    const { branch, student } = await foundation();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 8,
      name: 'Единая продажа',
      price: 33_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const input = {
      idempotencyKey: 'manual-unified-sale-1',
      initialPayment: {
        amount: tariff.price,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH' as const,
      },
      salePrice: tariff.price,
      startsAt: dateString(new Date()),
      studentId: student.id,
      tariffId: tariff.id,
    };
    const first = await finance.createSubscription(ownerToken, input);
    const repeated = await finance.createSubscription(ownerToken, input);
    expect(repeated.id).toBe(first.id);
    expect(first).toMatchObject({
      debt: 0,
      paidAmount: 33_000,
      paymentStatus: 'PAID',
      salePrice: 33_000,
    });
    expect(await database.subscription.count({ where: { studentId: student.id } })).toBe(1);
    expect(await database.payment.count({ where: { subscriptionId: first.id } })).toBe(1);
    expect(await database.cashTransaction.count({ where: { sourceType: 'PAYMENT' } })).toBe(1);
  });

  it('requires full payment before activation and keeps 8 × 3300 debt-free after two visits', async () => {
    const { branch, group, student } = await foundation();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 8,
      name: '8 занятий за 3300 ₽',
      price: 330_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const sale = {
      salePrice: tariff.price,
      startsAt: dateString(new Date(Date.now() - DAY_MS)),
      studentId: student.id,
      tariffId: tariff.id,
    };
    await expect(finance.createSubscription(ownerToken, sale)).rejects.toThrow('полной успешной');
    await expect(
      finance.createSubscription(ownerToken, {
        ...sale,
        initialPayment: {
          amount: 329_999,
          paidAt: new Date().toISOString(),
          paymentMethod: 'CASH',
        },
      }),
    ).rejects.toThrow('полной успешной');
    expect(await database.subscription.count({ where: { studentId: student.id } })).toBe(0);
    expect(await database.payment.count({ where: { studentId: student.id } })).toBe(0);
    expect(
      await database.syncOutbox.count({
        where: { entityType: 'SUBSCRIPTION', entityId: { not: '' } },
      }),
    ).toBe(0);

    const subscription = await finance.createSubscription(ownerToken, {
      ...sale,
      initialPayment: {
        amount: tariff.price,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CARD',
      },
    });
    expect(subscription).toMatchObject({
      debt: 0,
      paidAmount: 330_000,
      paymentStatus: 'PAID',
      remainingLessons: 8,
      status: 'ACTIVE',
    });
    expect(
      await database.syncOutbox.count({
        where: { entityId: subscription.id, entityType: 'SUBSCRIPTION' },
      }),
    ).toBeGreaterThan(0);

    for (const offset of [1, 2]) {
      const startsAt = new Date(Date.now() + offset * 60 * 60_000);
      const lesson = await studio.createLesson(ownerToken, {
        endsAt: new Date(startsAt.getTime() + 45 * 60_000).toISOString(),
        groupId: group.id,
        startsAt: startsAt.toISOString(),
      });
      await studio.saveAttendance(ownerToken, lesson.id, [
        { status: 'PRESENT', studentId: student.id },
      ]);
    }
    expect(await finance.getSubscription(ownerToken, subscription.id)).toMatchObject({
      debt: 0,
      lessonsUsed: 2,
      paidAmount: 330_000,
      remainingLessons: 6,
      status: 'ACTIVE',
    });
  });

  it('blocks every ordinary activation path until a pending subscription is fully paid', async () => {
    const { branch, group, student } = await foundation();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      freezeDays: 5,
      isActive: true,
      lessonCount: 8,
      name: 'Legacy pending fixture',
      price: 330_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const owner = await database.user.findFirstOrThrow({ where: { role: 'OWNER' } });
    const startsAt = new Date(Date.now() - DAY_MS);
    const pending = await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: owner.id,
        expiresAt: new Date(Date.now() + 30 * DAY_MS),
        lessonLimit: 8,
        purchasedAt: startsAt,
        salePrice: tariff.price,
        startsAt,
        status: 'PENDING',
        studentId: student.id,
        tariffId: tariff.id,
      },
    });

    expect((await finance.getSubscription(ownerToken, pending.id)).status).toBe('PENDING');
    expect(
      (await finance.rosterFinance(ownerToken, branch.id, [student.id])).get(student.id),
    ).toEqual({ totalDebt: 330_000 });
    expect(
      (
        await finance.updateSubscription(ownerToken, pending.id, {
          reason: 'Проверка защиты активации',
          startsAt: dateString(startsAt),
          tariffId: tariff.id,
        })
      ).status,
    ).toBe('PENDING');
    expect(
      (
        await finance.adjustSubscription(ownerToken, pending.id, {
          comment: 'Проверка защиты активации',
          lessonDelta: 1,
        })
      ).status,
    ).toBe('PENDING');

    const lessonStartsAt = new Date(Date.now() + 60 * 60_000);
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: new Date(lessonStartsAt.getTime() + 45 * 60_000).toISOString(),
      groupId: group.id,
      startsAt: lessonStartsAt.toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);
    expect((await finance.getSubscription(ownerToken, pending.id)).lessonsUsed).toBe(1);
    expect(
      await database.subscriptionLedger.count({
        where: { attendanceId: `${lesson.id}:${student.id}`, subscriptionId: pending.id },
      }),
    ).toBe(0);

    await database.subscription.update({ data: { status: 'FROZEN' }, where: { id: pending.id } });
    await expect(finance.unfreezeSubscription(ownerToken, pending.id)).rejects.toThrow(
      'полной оплаты',
    );
    await database.subscription.update({ data: { status: 'PENDING' }, where: { id: pending.id } });
    await finance.createPayment(ownerToken, {
      amount: tariff.price,
      branchId: branch.id,
      paidAt: new Date().toISOString(),
      paymentMethod: 'CARD',
      studentId: student.id,
      subscriptionId: pending.id,
    });
    expect(await finance.getSubscription(ownerToken, pending.id)).toMatchObject({
      debt: 0,
      paymentStatus: 'PAID',
      status: 'ACTIVE',
    });
  });

  it('derives paid and refunded subscription payment states from canonical payments', async () => {
    const { branch, student } = await foundation();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 4,
      name: 'Оплачиваемый тариф',
      price: 40_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const subscription = await finance.createSubscription(ownerToken, {
      initialPayment: {
        amount: tariff.price,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
      },
      salePrice: tariff.price,
      startsAt: dateString(new Date()),
      studentId: student.id,
      tariffId: tariff.id,
    });
    const payment = subscription.payments[0];
    if (!payment) throw new Error('Платёж продажи не создан.');
    expect(await finance.getSubscription(ownerToken, subscription.id)).toMatchObject({
      debt: 0,
      paidAmount: 40_000,
      paymentStatus: 'PAID',
    });
    await finance.createRefund(ownerToken, payment.id, {
      amount: 40_000,
      reason: 'Полный возврат по продаже',
      refundedAt: new Date().toISOString(),
    });
    expect(await finance.getSubscription(ownerToken, subscription.id)).toMatchObject({
      debt: 40_000,
      paidAmount: 0,
      paymentStatus: 'REFUNDED',
    });
    expect(await database.subscription.count({ where: { id: subscription.id } })).toBe(1);
  });

  it('uses trial first for trial attendance and paid subscriptions by nearest expiry before unlimited', async () => {
    const { branch, group, student } = await foundation();
    const createTariff = (input: {
      lessonCount?: number;
      name: string;
      type: 'LESSON_PACK' | 'TRIAL' | 'UNLIMITED';
      validityDays?: number;
    }) =>
      finance.createTariff(ownerToken, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: input.lessonCount,
        name: input.name,
        price: 10_000,
        type: input.type,
        validityDays: input.validityDays,
      });
    const [trialTariff, packTariff, unlimitedTariff] = await Promise.all([
      createTariff({ lessonCount: 1, name: 'Пробный', type: 'TRIAL', validityDays: 10 }),
      createTariff({ lessonCount: 1, name: 'Ближайший', type: 'LESSON_PACK', validityDays: 10 }),
      createTariff({ name: 'Безлимитный', type: 'UNLIMITED' }),
    ]);
    const startsAt = dateString(new Date(Date.now() - DAY_MS));
    const issue = (tariffId: string) =>
      finance.createSubscription(ownerToken, {
        initialPayment: {
          amount: 10_000,
          paidAt: new Date().toISOString(),
          paymentMethod: 'CASH',
        },
        salePrice: 10_000,
        startsAt,
        studentId: student.id,
        tariffId,
      });
    const [trial, pack, unlimited] = await Promise.all([
      issue(trialTariff.id),
      issue(packTariff.id),
      issue(unlimitedTariff.id),
    ]);
    const mark = async (offsetMinutes: number, status: 'PRESENT' | 'TRIAL') => {
      const starts = new Date(Date.now() + offsetMinutes * 60_000);
      const lesson = await studio.createLesson(ownerToken, {
        endsAt: new Date(starts.getTime() + 30 * 60_000).toISOString(),
        groupId: group.id,
        startsAt: starts.toISOString(),
      });
      await studio.saveAttendance(ownerToken, lesson.id, [{ status, studentId: student.id }]);
    };
    await mark(0, 'TRIAL');
    await mark(60, 'PRESENT');
    await mark(120, 'PRESENT');
    expect((await finance.getSubscription(ownerToken, trial.id)).lessonsUsed).toBe(1);
    expect((await finance.getSubscription(ownerToken, pack.id)).lessonsUsed).toBe(1);
    const unlimitedResult = await finance.getSubscription(ownerToken, unlimited.id);
    expect(unlimitedResult.lessonsUsed).toBe(1);
    expect(unlimitedResult.remainingLessons).toBeUndefined();
  });

  it('renews atomically and consumes Current then Next exactly once per attendance', async () => {
    const { branch, group, student } = await foundation();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      freezeDays: 10,
      isActive: true,
      lessonCount: 8,
      name: '8 занятий · 3300 ₽',
      price: 330_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const issue = (input: { idempotencyKey: string; sequenceAfterSubscriptionId?: string }) =>
      finance.createSubscription(ownerToken, {
        idempotencyKey: input.idempotencyKey,
        initialPayment: {
          amount: tariff.price,
          paidAt: new Date().toISOString(),
          paymentMethod: 'CARD',
        },
        salePrice: tariff.price,
        ...(input.sequenceAfterSubscriptionId
          ? { sequenceAfterSubscriptionId: input.sequenceAfterSubscriptionId }
          : {}),
        startsAt: dateString(new Date(Date.now() - DAY_MS)),
        studentId: student.id,
        tariffId: tariff.id,
      });
    const current = await issue({ idempotencyKey: 'renew-current-3300' });
    await finance.updateSubscription(ownerToken, current.id, {
      reason: 'Подготовка реалистичного остатка перед продлением',
      remainingLessons: 2,
      startsAt: dateString(new Date(Date.now() - DAY_MS)),
      tariffId: tariff.id,
    });
    const nextInput = {
      idempotencyKey: 'renew-next-3300',
      sequenceAfterSubscriptionId: current.id,
    };
    const next = await issue(nextInput);
    const retried = await issue(nextInput);
    expect(retried.id).toBe(next.id);
    expect(await database.payment.count()).toBe(2);
    expect(await database.subscription.count()).toBe(2);
    expect((await finance.listStudentSubscriptions(ownerToken, student.id)).subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: current.id, lifecyclePosition: 'CURRENT' }),
        expect.objectContaining({ id: next.id, lifecyclePosition: 'NEXT', paymentStatus: 'PAID' }),
      ]),
    );

    const mark = async (offset: number) => {
      const startsAt = new Date(Date.now() + offset * 60_000);
      const lesson = await studio.createLesson(ownerToken, {
        endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
        groupId: group.id,
        startsAt: startsAt.toISOString(),
      });
      await studio.saveAttendance(ownerToken, lesson.id, [
        { status: 'PRESENT', studentId: student.id },
      ]);
      await studio.saveAttendance(ownerToken, lesson.id, [
        { status: 'PRESENT', studentId: student.id },
      ]);
      expect(
        await database.subscriptionLedger.count({
          where: { attendanceId: `${lesson.id}:${student.id}`, type: 'LESSON_WRITE_OFF' },
        }),
      ).toBe(1);
    };
    await mark(60);
    expect(await finance.getSubscription(ownerToken, current.id)).toMatchObject({
      debt: 0,
      remainingLessons: 1,
    });
    expect((await finance.getSubscription(ownerToken, next.id)).remainingLessons).toBe(8);
    await mark(120);
    expect(await finance.getSubscription(ownerToken, current.id)).toMatchObject({
      debt: 0,
      remainingLessons: 0,
      status: 'USED_UP',
    });
    expect((await finance.getSubscription(ownerToken, next.id)).remainingLessons).toBe(8);
    await mark(180);
    expect(await finance.getSubscription(ownerToken, next.id)).toMatchObject({
      debt: 0,
      remainingLessons: 7,
      status: 'ACTIVE',
    });
  });

  it('blocks frozen write-offs and records OWNER correction with a required reason', async () => {
    const { group, student, subscription, tariff } = await tariffAndSubscription({
      freezeDays: 5,
      lessonCount: 8,
      price: 330_000,
    });
    const originalExpiry = new Date(subscription.expiresAt ?? 0).getTime();
    const frozen = await finance.freezeSubscription(ownerToken, subscription.id, freezeInput(3));
    expect(frozen.status).toBe('FROZEN');
    const startsAt = new Date();
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
      groupId: group.id,
      startsAt: startsAt.toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);
    expect((await finance.getSubscription(ownerToken, subscription.id)).lessonsUsed).toBe(0);
    expect(
      (await finance.listStudentSubscriptions(ownerToken, student.id)).uncoveredAttendances,
    ).toHaveLength(1);
    const unfrozen = await finance.unfreezeSubscription(ownerToken, subscription.id);
    expect(unfrozen.frozenDaysUsed).toBe(1);
    expect(new Date(unfrozen.expiresAt ?? 0).getTime()).toBe(originalExpiry + DAY_MS);
    await expect(
      finance.updateSubscription(ownerToken, subscription.id, {
        reason: ' ',
        remainingLessons: 6,
        startsAt: dateString(new Date(subscription.startsAt)),
        tariffId: tariff.id,
      }),
    ).rejects.toThrow(t('validation.adjustmentReason'));
    const corrected = await finance.updateSubscription(ownerToken, subscription.id, {
      reason: 'Компенсация отменённого занятия',
      remainingLessons: 6,
      startsAt: dateString(new Date(subscription.startsAt)),
      tariffId: tariff.id,
    });
    expect(corrected.remainingLessons).toBe(6);
    expect(
      corrected.history?.some(
        ({ summary, type }) =>
          type === 'CORRECTION' && summary.includes('Компенсация отменённого занятия'),
      ),
    ).toBe(true);
  });

  it('writes off attendance once, reverses corrections, and reverses a cancelled lesson', async () => {
    const { branch, group, student, subscription } = await tariffAndSubscription({
      lessonCount: 2,
    });
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      groupId: group.id,
      startsAt: new Date().toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);
    expect((await finance.getSubscription(ownerToken, subscription.id)).lessonsUsed).toBe(1);
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);
    expect(await database.subscriptionLedger.count({ where: { type: 'LESSON_WRITE_OFF' } })).toBe(
      1,
    );
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'EXCUSED', studentId: student.id },
    ]);
    expect((await finance.getSubscription(ownerToken, subscription.id)).lessonsUsed).toBe(0);
    await studio.saveAttendance(ownerToken, lesson.id, [{ status: 'LATE', studentId: student.id }]);
    expect((await finance.getSubscription(ownerToken, subscription.id)).lessonsUsed).toBe(1);
    await studio.cancelLesson(ownerToken, lesson.id, { cancellationReason: 'Зал недоступен' });
    expect((await finance.getSubscription(ownerToken, subscription.id)).lessonsUsed).toBe(0);
    expect(await database.subscriptionLedger.count({ where: { type: 'REVERSAL' } })).toBe(2);
    await expect(
      studio.saveAttendance(ownerToken, lesson.id, [{ status: 'PRESENT', studentId: student.id }]),
    ).rejects.toThrow(t('domain.validation.attendanceCancelled'));
    expect(
      await database.auditLog.count({ where: { action: 'SUBSCRIPTION_WRITE_OFF_REVERSED' } }),
    ).toBe(2);
    expect(branch.id).toBeTruthy();
  });

  it('prices uncovered PRESENT attendance and retroactively covers it exactly once', async () => {
    const { branch, group, student } = await foundation();
    await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 1,
      name: 'Разовое посещение',
      price: 1_500,
      type: 'SINGLE_LESSON',
    });
    const lessonStartsAt = new Date(Date.now() - 3 * DAY_MS);
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: new Date(lessonStartsAt.getTime() + 3_600_000).toISOString(),
      groupId: group.id,
      startsAt: lessonStartsAt.toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);
    const uncovered = await finance.listStudentSubscriptions(ownerToken, student.id);
    expect(uncovered).toMatchObject({ totalDebt: 1_500, uncoveredDebt: 1_500 });
    expect(uncovered.uncoveredAttendances).toHaveLength(1);

    const pack = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 4,
      name: 'Абонемент на четыре занятия',
      price: 5_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const subscription = await finance.createSubscription(ownerToken, {
      initialPayment: {
        amount: 5_000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
      },
      salePrice: 5_000,
      startsAt: dateString(new Date(lessonStartsAt.getTime() - DAY_MS)),
      studentId: student.id,
      tariffId: pack.id,
    });
    expect(subscription.lessonsUsed).toBe(1);
    const covered = await finance.listStudentSubscriptions(ownerToken, student.id);
    expect(covered.uncoveredAttendances).toHaveLength(0);
    expect(covered.totalDebt).toBe(0);
    await finance.updateSubscription(ownerToken, subscription.id, {
      expiresAt: dateString(new Date(lessonStartsAt.getTime() + 10 * DAY_MS)),
      reason: 'Уточнение срока действия',
      startsAt: dateString(new Date(lessonStartsAt.getTime() - DAY_MS)),
      tariffId: pack.id,
    });
    expect(
      await database.subscriptionLedger.count({
        where: { attendanceId: `${lesson.id}:${student.id}`, type: 'LESSON_WRITE_OFF' },
      }),
    ).toBe(1);
  });

  it('pays one uncovered attendance directly, prevents duplicates, and uncovers it after refund', async () => {
    const { branch, group, student } = await foundation();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 1,
      name: 'Разовое посещение',
      price: 1_500,
      type: 'SINGLE_LESSON',
    });
    await finance.createTariff(ownerToken, {
      currency: 'RUB',
      isActive: true,
      lessonCount: 1,
      name: 'Глобальное разовое посещение',
      price: 1_800,
      type: 'SINGLE_LESSON',
    });
    const startsAt = new Date(Date.now() - DAY_MS);
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      groupId: group.id,
      startsAt: startsAt.toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);
    const choice = (await finance.listStudentSubscriptions(ownerToken, student.id))
      .uncoveredAttendances[0];
    expect(choice).toMatchObject({ amount: undefined, paymentStatus: 'UNPAID' });
    expect(choice?.tariffs).toHaveLength(2);

    const payment = await finance.createPayment(ownerToken, {
      amount: tariff.price,
      attendanceLessonId: lesson.id,
      attendanceTariffId: tariff.id,
      branchId: branch.id,
      paidAt: new Date().toISOString(),
      paymentMethod: 'CASH',
      studentId: student.id,
    });
    expect(
      (await finance.listStudentSubscriptions(ownerToken, student.id)).uncoveredAttendances,
    ).toHaveLength(0);
    await expect(
      finance.createPayment(ownerToken, {
        amount: tariff.price,
        attendanceLessonId: lesson.id,
        attendanceTariffId: tariff.id,
        branchId: branch.id,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CARD',
        studentId: student.id,
      }),
    ).rejects.toThrow('уже оплачено');
    await expect(
      studio.saveAttendance(ownerToken, lesson.id, [{ status: 'ABSENT', studentId: student.id }]),
    ).rejects.toThrow('Сначала отмените');
    const pack = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 4,
      name: 'Абонемент после разовой оплаты',
      price: 5_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const subscription = await finance.createSubscription(ownerToken, {
      initialPayment: {
        amount: 5_000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
      },
      salePrice: 5_000,
      startsAt: dateString(new Date(startsAt.getTime() - DAY_MS)),
      studentId: student.id,
      tariffId: pack.id,
    });
    expect(subscription.lessonsUsed).toBe(0);
    await finance.createRefund(ownerToken, payment.id, {
      amount: tariff.price,
      reason: 'Возврат разовой оплаты',
      refundedAt: new Date().toISOString(),
    });
    expect(
      (await finance.listStudentSubscriptions(ownerToken, student.id)).uncoveredAttendances,
    ).toHaveLength(1);
    const operation = await paymentOperations.create(ownerToken, {
      amount: tariff.price,
      attendanceLessonId: lesson.id,
      attendanceTariffId: tariff.id,
      branchId: branch.id,
      currency: 'RUB',
      idempotencyKey: 'direct-attendance-aqsi',
      providerType: 'ACQUIRING',
      purpose: 'Разовое посещение',
      studentId: student.id,
    });
    expect(
      (await finance.listStudentSubscriptions(ownerToken, student.id)).uncoveredAttendances[0],
    ).toMatchObject({ paymentStatus: 'PENDING' });
    await paymentOperations.transition(ownerToken, operation.id, 'WAITING_FOR_PAYMENT');
    await paymentOperations.finalizeTrusted(operation.id, { paymentMethod: 'ACQUIRING' });
    expect(
      (await finance.listStudentSubscriptions(ownerToken, student.id)).uncoveredAttendances,
    ).toHaveLength(0);
    expect(await database.payment.count({ where: { attendanceLessonId: lesson.id } })).toBe(2);
    expect(
      await database.auditLog.count({
        where: { action: 'ATTENDANCE_DIRECT_PAYMENT_COMPLETED' },
      }),
    ).toBe(2);
  });

  it('reverses coverage after moving startsAt forward without changing attendance or payments', async () => {
    const { group, student, subscription, tariff } = await tariffAndSubscription({
      lessonCount: 4,
    });
    const lessonStartsAt = new Date();
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: new Date(lessonStartsAt.getTime() + 3_600_000).toISOString(),
      groupId: group.id,
      startsAt: lessonStartsAt.toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);
    expect((await finance.getSubscription(ownerToken, subscription.id)).lessonsUsed).toBe(1);
    const paymentsBefore = await database.payment.count({
      where: { subscriptionId: subscription.id },
    });
    const updated = await finance.updateSubscription(ownerToken, subscription.id, {
      reason: 'Исправление даты начала',
      startsAt: dateString(new Date(lessonStartsAt.getTime() + 2 * DAY_MS)),
      tariffId: tariff.id,
    });
    expect(updated.lessonsUsed).toBe(0);
    expect(await database.attendance.count({ where: { lessonId: lesson.id } })).toBe(1);
    expect(await database.payment.count({ where: { subscriptionId: subscription.id } })).toBe(
      paymentsBefore,
    );
    expect(
      await database.auditLog.count({
        where: { action: { in: ['SUBSCRIPTION_UPDATED', 'SUBSCRIPTION_WRITE_OFF_REVERSED'] } },
      }),
    ).toBe(2);
    const summary = await finance.listStudentSubscriptions(ownerToken, student.id);
    expect(summary.uncoveredAttendances).toHaveLength(1);
  });

  it('enforces manager branch limits and blocks coach payments and manager refunds or corrections', async () => {
    const { branch, student, subscription } = await tariffAndSubscription();
    const other = await application.createBranch(ownerToken, {
      address: 'ул. Другая, 2',
      name: 'Север',
      phone: '+79990000003',
    });
    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'manager-finance@arava.local',
      fullName: 'Управляющий финансами',
      password: 'Manager!Finance2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach-finance@arava.local',
      fullName: 'Тренер',
      password: 'Coach!Finance2026',
      role: 'COACH',
    });
    const manager = await application.login({
      email: 'manager-finance@arava.local',
      password: 'Manager!Finance2026',
    });
    const coach = await application.login({
      email: 'coach-finance@arava.local',
      password: 'Coach!Finance2026',
    });
    await application.changePassword(manager.token, {
      currentPassword: 'Manager!Finance2026',
      newPassword: 'Manager!Changed2026',
    });
    await application.changePassword(coach.token, {
      currentPassword: 'Coach!Finance2026',
      newPassword: 'Coach!Changed2026',
    });
    await expect(
      finance.createTariff(manager.token, {
        currency: 'RUB',
        isActive: true,
        lessonCount: 1,
        name: 'Общий',
        price: 100,
        type: 'SINGLE_LESSON',
      }),
    ).rejects.toThrow(t('domain.authorization.globalTariff'));
    await expect(
      finance.createTariff(manager.token, {
        branchId: other.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 1,
        name: 'Чужой',
        price: 100,
        type: 'SINGLE_LESSON',
      }),
    ).rejects.toThrow(t('domain.authorization.branchDenied'));
    const payment = await finance.createPayment(manager.token, {
      amount: 1_000,
      branchId: branch.id,
      paidAt: new Date().toISOString(),
      paymentMethod: 'CASH',
      studentId: student.id,
    });
    await expect(
      finance.createRefund(manager.token, payment.id, {
        amount: 100,
        reason: 'Нет полномочий на возврат',
        refundedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(t('domain.authorization.permissionDenied'));
    await expect(
      finance.adjustSubscription(manager.token, subscription.id, {
        comment: 'Нет полномочий на корректировку',
        lessonDelta: 1,
      }),
    ).rejects.toThrow(t('domain.authorization.permissionDenied'));
    await expect(
      finance.updateSubscription(manager.token, subscription.id, {
        expiresAt: subscription.expiresAt?.slice(0, 10),
        reason: 'Допустимое исправление даты администратором',
        startsAt: subscription.startsAt.slice(0, 10),
        tariffId: subscription.tariffId,
      }),
    ).resolves.toMatchObject({ id: subscription.id });
    await expect(
      finance.updateSubscription(manager.token, subscription.id, {
        expiresAt: subscription.expiresAt?.slice(0, 10),
        reason: 'Администратор не меняет остаток занятий',
        remainingLessons: subscription.remainingLessons,
        startsAt: subscription.startsAt.slice(0, 10),
        tariffId: subscription.tariffId,
      }),
    ).rejects.toThrow(t('domain.authorization.permissionDenied'));
    await expect(
      finance.createPayment(coach.token, {
        amount: 100,
        branchId: branch.id,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
        studentId: student.id,
      }),
    ).rejects.toThrow(t('domain.authorization.permissionDenied'));
  });
});
