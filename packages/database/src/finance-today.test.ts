import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function localDate(value: Date): string {
  return [
    String(value.getFullYear()),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

describe('Finance Today overview', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let finance: FinanceService;
  let ownerId: string;
  let ownerToken: string;
  let operations: PaymentOperationService;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-finance-today-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'finance-today.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    finance = new FinanceService(database, application);
    operations = new PaymentOperationService(database, application);
    studio = new StudioService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerId = owner.user.id;
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!FinanceToday2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function foundation(name = 'Центр') {
    const branch = await application.createBranch(ownerToken, { name });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Анна',
      lastName: name,
      status: 'ACTIVE',
    });
    return { branch, student };
  }

  it('returns a stable zero state for a day without finance records', async () => {
    expect(await finance.financeToday(ownerToken, { date: localDate(new Date()) })).toMatchObject({
      byMethod: [],
      directAttendance: { amount: 0, count: 0 },
      failedCount: 0,
      net: 0,
      pendingCount: 0,
      received: 0,
      recentOperations: [],
      refunds: 0,
      subscriptionSales: { count: 0, value: 0 },
      successfulCount: 0,
    });
  });

  it('counts canonical payments once, excludes provider states, and respects local-day boundaries', async () => {
    const { branch, student } = await foundation();
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const first = await finance.createPayment(ownerToken, {
      amount: 12_300,
      branchId: branch.id,
      paidAt: new Date(dayStart.getTime() + 30 * 60_000).toISOString(),
      paymentMethod: 'CASH',
      studentId: student.id,
    });
    const cardOperation = await operations.create(ownerToken, {
      amount: 8_700,
      branchId: branch.id,
      currency: 'RUB',
      idempotencyKey: 'finance-today-card-operation',
      providerType: 'ACQUIRING',
      purpose: 'Оплата картой',
      studentId: student.id,
    });
    await operations.transition(ownerToken, cardOperation.id, 'WAITING_FOR_PAYMENT');
    await operations.finalizeTrusted(cardOperation.id, { paymentMethod: 'ACQUIRING' });
    const sbpOperation = await operations.create(ownerToken, {
      amount: 16_500,
      branchId: branch.id,
      currency: 'RUB',
      idempotencyKey: 'finance-today-sbp-operation',
      providerType: 'SBP',
      purpose: 'Оплата по СБП',
      studentId: student.id,
    });
    await operations.transition(ownerToken, sbpOperation.id, 'WAITING_FOR_PAYMENT');
    await operations.finalizeTrusted(sbpOperation.id, { paymentMethod: 'SBP' });
    await finance.createPayment(ownerToken, {
      amount: 99_999,
      branchId: branch.id,
      paidAt: new Date(dayStart.getTime() - 1).toISOString(),
      paymentMethod: 'TRANSFER',
      studentId: student.id,
    });
    await finance.createRefund(ownerToken, first.id, {
      amount: 1_000,
      reason: 'Частичный возврат за занятие',
      refundedAt: new Date(dayStart.getTime() + 2 * 60 * 60_000).toISOString(),
    });
    const pending = await operations.create(ownerToken, {
      amount: 5_000,
      branchId: branch.id,
      currency: 'RUB',
      idempotencyKey: 'finance-today-pending-operation',
      providerType: 'SBP',
      purpose: 'Ожидает подтверждения',
      studentId: student.id,
    });
    await operations.transition(ownerToken, pending.id, 'WAITING_FOR_PAYMENT');
    const failed = await operations.create(ownerToken, {
      amount: 6_000,
      branchId: branch.id,
      currency: 'RUB',
      idempotencyKey: 'finance-today-failed-operation',
      providerType: 'ACQUIRING',
      purpose: 'Ошибка терминала',
      studentId: student.id,
    });
    await operations.transition(ownerToken, failed.id, 'WAITING_FOR_PAYMENT');
    await operations.transition(ownerToken, failed.id, 'FAILED', 'Сетевая ошибка');

    const overview = await finance.financeToday(ownerToken, { date: localDate(now) });
    expect(overview).toMatchObject({
      failedCount: 1,
      net: 36_500,
      pendingCount: 1,
      received: 37_500,
      refunds: 1_000,
      successfulCount: 4,
    });
    expect(overview.byMethod).toEqual(
      expect.arrayContaining([
        { amount: 12_300, count: 1, method: 'CASH' },
        { amount: 8_700, count: 1, method: 'ACQUIRING' },
        { amount: 16_500, count: 1, method: 'SBP' },
      ]),
    );
    expect(overview.recentOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 1_000, kind: 'REFUND' }),
        expect.objectContaining({ amount: 12_300, kind: 'PAYMENT' }),
      ]),
    );
    expect(await database.payment.count()).toBe(4);
    expect(overview.received).not.toBe(46_200);
  });

  it('separates subscription sale value, partial payment, top-up, direct attendance, trial, and debt', async () => {
    const { branch, student } = await foundation();
    const date = localDate(new Date());
    const pack = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 8,
      name: 'Восемь занятий',
      price: 33_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const subscription = await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: ownerId,
        lessonLimit: 8,
        purchasedAt: new Date(),
        salePrice: 33_000,
        startsAt: new Date(),
        status: 'ACTIVE',
        studentId: student.id,
        tariffId: pack.id,
      },
    });
    await database.payment.create({
      data: {
        amount: 20_000,
        branchId: branch.id,
        createdByUserId: ownerId,
        paidAt: new Date(),
        paymentMethod: 'CASH',
        studentId: student.id,
        subscriptionId: subscription.id,
      },
    });
    await finance.createPayment(ownerToken, {
      amount: 5_000,
      branchId: branch.id,
      paidAt: new Date().toISOString(),
      paymentMethod: 'TRANSFER',
      studentId: student.id,
      subscriptionId: subscription.id,
    });
    const issuedOnly = await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: ownerId,
        lessonLimit: 8,
        purchasedAt: new Date(),
        salePrice: 10_000,
        startsAt: new Date(),
        status: 'ACTIVE',
        studentId: student.id,
        tariffId: pack.id,
      },
    });
    const trial = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 1,
      name: 'Пробное',
      price: 0,
      type: 'TRIAL',
    });
    await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: ownerId,
        lessonLimit: 1,
        purchasedAt: new Date(),
        salePrice: 0,
        startsAt: new Date(),
        status: 'ACTIVE',
        studentId: student.id,
        tariffId: trial.id,
      },
    });
    await database.payment.create({
      data: {
        amount: 1_500,
        attendanceLessonId: 'lesson-direct',
        attendanceTariffId: 'tariff-direct',
        branchId: branch.id,
        createdByUserId: ownerId,
        paidAt: new Date(),
        paymentMethod: 'CASH',
        studentId: student.id,
      },
    });

    const overview = await finance.financeToday(ownerToken, { date });
    expect(overview.received).toBe(26_500);
    expect(overview.subscriptionSales).toEqual({ count: 2, value: 43_000 });
    expect(overview.directAttendance).toEqual({ amount: 1_500, count: 1 });
    expect(overview.debt).toMatchObject({
      studentCount: 1,
      subscriptionAmount: 18_000,
      totalAmount: 18_000,
    });
    expect(overview.recentOperations.map(({ purpose }) => purpose)).toEqual(
      expect.arrayContaining([
        'Абонемент «Восемь занятий»',
        'Доплата по абонементу «Восемь занятий»',
        'Разовое посещение',
      ]),
    );
    expect((await finance.getSubscription(ownerToken, issuedOnly.id)).debt).toBe(10_000);
  });

  it('includes priced uncovered attendance debt without counting a free trial', async () => {
    const { branch, student } = await foundation();
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      direction: 'Танцы',
      name: 'Группа долга',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, group.id, {
      joinedAt: localDate(new Date(Date.now() - 86_400_000)),
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 1,
      name: 'Разовое посещение',
      price: 1_800,
      type: 'SINGLE_LESSON',
    });
    const startsAt = new Date(Date.now() - 3_600_000);
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      groupId: group.id,
      startsAt: startsAt.toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);

    const overview = await finance.financeToday(ownerToken, { date: localDate(new Date()) });
    expect(overview.debt).toMatchObject({
      studentCount: 1,
      subscriptionAmount: 0,
      totalAmount: 1_800,
      uncoveredAmount: 1_800,
    });
    expect(overview.directAttendance).toEqual({ amount: 0, count: 0 });
  });

  it('enforces OWNER/ADMIN branch scope including global ADMIN and denies COACH', async () => {
    const first = await foundation('Центр');
    const second = await foundation('Север');
    await finance.createPayment(ownerToken, {
      amount: 1_000,
      branchId: first.branch.id,
      paidAt: new Date().toISOString(),
      paymentMethod: 'CASH',
      studentId: first.student.id,
    });
    await finance.createPayment(ownerToken, {
      amount: 2_000,
      branchId: second.branch.id,
      paidAt: new Date().toISOString(),
      paymentMethod: 'SBP',
      studentId: second.student.id,
    });
    await application.createUser(ownerToken, {
      branchIds: [first.branch.id],
      email: 'finance-branch-admin@arava.local',
      fullName: 'Администратор филиала',
      password: 'Admin!FinanceToday2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [],
      email: 'finance-global-admin@arava.local',
      fullName: 'Глобальный администратор',
      password: 'Admin!FinanceGlobal2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [first.branch.id],
      email: 'finance-coach@arava.local',
      fullName: 'Тренер',
      password: 'Coach!FinanceToday2026',
      role: 'COACH',
    });
    const branchAdmin = await application.login({
      email: 'finance-branch-admin@arava.local',
      password: 'Admin!FinanceToday2026',
    });
    const globalAdmin = await application.login({
      email: 'finance-global-admin@arava.local',
      password: 'Admin!FinanceGlobal2026',
    });
    const coach = await application.login({
      email: 'finance-coach@arava.local',
      password: 'Coach!FinanceToday2026',
    });
    await application.changePassword(branchAdmin.token, {
      currentPassword: 'Admin!FinanceToday2026',
      newPassword: 'Admin!FinanceTodayChanged2026',
    });
    await application.changePassword(globalAdmin.token, {
      currentPassword: 'Admin!FinanceGlobal2026',
      newPassword: 'Admin!FinanceGlobalChanged2026',
    });
    await application.changePassword(coach.token, {
      currentPassword: 'Coach!FinanceToday2026',
      newPassword: 'Coach!FinanceTodayChanged2026',
    });
    const date = localDate(new Date());

    expect((await finance.financeToday(ownerToken, { date })).received).toBe(3_000);
    expect((await finance.financeToday(branchAdmin.token, { date })).received).toBe(1_000);
    expect((await finance.financeToday(globalAdmin.token, { date })).received).toBe(3_000);
    await expect(
      finance.financeToday(branchAdmin.token, { branchId: second.branch.id, date }),
    ).rejects.toThrow('нет доступа к этому филиалу');
    await expect(finance.financeToday(coach.token, { date })).rejects.toThrow('недостаточно прав');
  });

  it('uses bounded batch queries instead of querying per recent operation', async () => {
    const { branch, student } = await foundation();
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        database.payment.create({
          data: {
            amount: 100 + index,
            branchId: branch.id,
            createdByUserId: ownerId,
            paidAt: new Date(),
            paymentMethod: 'CASH',
            studentId: student.id,
          },
        }),
      ),
    );
    const paymentFindMany = database.payment.findMany.bind(database.payment);
    const refundFindMany = database.refund.findMany.bind(database.refund);
    const paymentQueries = vi
      .spyOn(database.payment, 'findMany')
      .mockImplementation((arguments_) => paymentFindMany(arguments_));
    const refundQueries = vi
      .spyOn(database.refund, 'findMany')
      .mockImplementation((arguments_) => refundFindMany(arguments_));

    const overview = await finance.financeToday(ownerToken, { date: localDate(new Date()) });
    expect(overview.recentOperations).toHaveLength(12);
    expect(paymentQueries).toHaveBeenCalledTimes(1);
    expect(refundQueries).toHaveBeenCalledTimes(1);
  });
});
