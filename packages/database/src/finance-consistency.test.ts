import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

function localNoon(dayOffset = 0): Date {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + dayOffset);
  return value;
}

describe('Finance 5.1 consistency matrix', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let finance: FinanceService;
  let operations: PaymentOperationService;
  let ownerId: string;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-finance-consistency-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'finance-consistency.db')));
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
      newPassword: 'Owner!FinanceConsistency2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function foundation(name: string) {
    const branch = await application.createBranch(ownerToken, { name: `Филиал ${name}` });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: name,
      lastName: 'Матрица',
      status: 'ACTIVE',
    });
    return { branch, student };
  }

  async function dayOverview(date: string, branchId?: string) {
    const [today, journal, analytics] = await Promise.all([
      finance.financeToday(ownerToken, { ...(branchId ? { branchId } : {}), date }),
      finance.financeJournal(ownerToken, {
        ...(branchId ? { branchId } : {}),
        dateFrom: date,
        dateTo: date,
        eventType: 'ALL',
        page: 1,
        pageSize: 50,
      }),
      finance.financeAnalytics(ownerToken, {
        ...(branchId ? { branchId } : {}),
        dateFrom: date,
        dateTo: date,
      }),
    ]);
    expect(journal.summary).toMatchObject({
      net: today.net,
      received: today.received,
      refunds: today.refunds,
    });
    expect(analytics.current).toMatchObject({
      net: today.net,
      received: today.received,
      refunds: today.refunds,
    });
    expect(today.successfulCount).toBe(journal.summary.operationsCount);
    expect(journal.items).toHaveLength(journal.summary.operationsCount);
    return { analytics, journal, today };
  }

  async function packSubscription(input: {
    amount?: number;
    branchId: string;
    method?: 'CARD' | 'CASH' | 'SBP';
    name: string;
    paidAt: Date;
    salePrice: number;
    studentId: string;
  }) {
    const tariff = await finance.createTariff(ownerToken, {
      branchId: input.branchId,
      currency: 'RUB',
      isActive: true,
      lessonCount: 8,
      name: input.name,
      price: input.salePrice,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const subscription = await finance.createSubscription(ownerToken, {
      ...(input.amount === undefined
        ? {}
        : {
            initialPayment: {
              amount: input.amount,
              paidAt: input.paidAt.toISOString(),
              paymentMethod: input.method ?? ('CASH' as const),
            },
          }),
      salePrice: input.salePrice,
      startsAt: localDate(input.paidAt),
      studentId: input.studentId,
      tariffId: tariff.id,
    });
    await database.subscription.update({
      data: { purchasedAt: input.paidAt },
      where: { id: subscription.id },
    });
    return subscription;
  }

  it('counts CASH, CARD and SBP Payments exactly once and excludes provider-only states', async () => {
    const when = localNoon();
    const date = localDate(when);
    const { branch, student } = await foundation('Методы');
    for (const [index, method] of ['CASH', 'CARD', 'SBP'].entries())
      await packSubscription({
        amount: (index + 1) * 1_000,
        branchId: branch.id,
        method: method as 'CARD' | 'CASH' | 'SBP',
        name: `Абонемент ${method}`,
        paidAt: when,
        salePrice: (index + 1) * 1_000,
        studentId: student.id,
      });
    const cancelled = await finance.createPayment(ownerToken, {
      amount: 9_000,
      branchId: branch.id,
      paidAt: when.toISOString(),
      paymentMethod: 'CASH',
      studentId: student.id,
    });
    await finance.cancelPayment(ownerToken, cancelled.id);
    const pending = await operations.create(ownerToken, {
      amount: 7_000,
      branchId: branch.id,
      currency: 'RUB',
      idempotencyKey: 'matrix-pending',
      providerType: 'SBP',
      purpose: 'Ожидающая операция',
      studentId: student.id,
    });
    await operations.transition(ownerToken, pending.id, 'WAITING_FOR_PAYMENT');
    const failed = await operations.create(ownerToken, {
      amount: 8_000,
      branchId: branch.id,
      currency: 'RUB',
      idempotencyKey: 'matrix-failed',
      providerType: 'ACQUIRING',
      purpose: 'Неуспешная операция',
      studentId: student.id,
    });
    await operations.transition(ownerToken, failed.id, 'WAITING_FOR_PAYMENT');
    await operations.transition(ownerToken, failed.id, 'FAILED', 'Тестовая ошибка');

    const { analytics, journal, today } = await dayOverview(date, branch.id);
    expect(today).toMatchObject({
      failedCount: 1,
      net: 6_000,
      pendingCount: 1,
      received: 6_000,
      refunds: 0,
      subscriptionSales: { count: 3, value: 6_000 },
      successfulCount: 3,
    });
    expect(journal.summary.operationsCount).toBe(3);
    expect(analytics.current.paymentCount).toBe(3);
    expect(analytics.byMethod).toEqual(
      expect.arrayContaining([
        { amount: 1_000, count: 1, method: 'CASH' },
        { amount: 2_000, count: 1, method: 'CARD' },
        { amount: 3_000, count: 1, method: 'SBP' },
      ]),
    );
  });

  it('keeps sale value separate from partial payments, top-ups and later refunds', async () => {
    const soldAt = localNoon(-3);
    const topUpAt = localNoon(-2);
    const refundedAt = localNoon(-1);
    const { branch, student } = await foundation('Частичная');
    const subscription = await packSubscription({
      amount: 1_000,
      branchId: branch.id,
      name: 'Абонемент 4 350',
      paidAt: soldAt,
      salePrice: 4_350,
      studentId: student.id,
    });

    let soldDay = await dayOverview(localDate(soldAt), branch.id);
    expect(soldDay.today).toMatchObject({
      received: 1_000,
      subscriptionSales: { count: 1, value: 4_350 },
    });
    expect((await finance.getSubscription(ownerToken, subscription.id)).debt).toBe(3_350);

    const second = await finance.createPayment(ownerToken, {
      amount: 2_000,
      branchId: branch.id,
      paidAt: topUpAt.toISOString(),
      paymentMethod: 'CARD',
      studentId: student.id,
      subscriptionId: subscription.id,
    });
    const third = await finance.createPayment(ownerToken, {
      amount: 1_350,
      branchId: branch.id,
      paidAt: topUpAt.toISOString(),
      paymentMethod: 'SBP',
      studentId: student.id,
      subscriptionId: subscription.id,
    });
    const topUpDay = await dayOverview(localDate(topUpAt), branch.id);
    expect(topUpDay.today).toMatchObject({
      received: 3_350,
      subscriptionSales: { count: 0, value: 0 },
    });
    expect((await finance.getSubscription(ownerToken, subscription.id)).debt).toBe(0);
    expect(await database.subscription.count({ where: { id: subscription.id } })).toBe(1);

    await finance.createRefund(ownerToken, third.id, {
      amount: 500,
      reason: 'Первая часть возврата',
      refundedAt: refundedAt.toISOString(),
    });
    await finance.createRefund(ownerToken, third.id, {
      amount: 850,
      reason: 'Вторая часть возврата',
      refundedAt: refundedAt.toISOString(),
    });
    const refundDay = await dayOverview(localDate(refundedAt), branch.id);
    expect(refundDay.today).toMatchObject({ net: -1_350, received: 0, refunds: 1_350 });
    expect(refundDay.journal.items.map(({ kind }) => kind)).toEqual(['REFUND', 'REFUND']);
    expect((await finance.getSubscription(ownerToken, subscription.id)).debt).toBe(1_350);
    expect(
      (
        await finance.financeDebts(ownerToken, {
          branchId: branch.id,
          debtType: 'ALL',
          page: 1,
          pageSize: 50,
          sort: 'OLDEST',
        })
      ).summary.totalDebt,
    ).toBe(1_350);
    expect(second.status).toBe('COMPLETED');

    soldDay = await dayOverview(localDate(soldAt), branch.id);
    expect(soldDay.today).toMatchObject({ received: 1_000, refunds: 0 });
  });

  it('derives uncovered attendance from canonical statuses and excludes trial/direct-paid rows', async () => {
    const when = localNoon(-1);
    const { branch, student } = await foundation('Посещения');
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      direction: 'Танцы',
      name: 'Матрица посещений',
      status: 'ACTIVE',
    });
    const students = [student];
    for (const name of ['Поздно', 'Нет', 'Уважительно', 'Пробное', 'Оплачено'])
      students.push(
        await application.createStudent(ownerToken, {
          branchId: branch.id,
          firstName: name,
          lastName: 'Посещение',
          status: 'ACTIVE',
        }),
      );
    for (const participant of students)
      await studio.addEnrollment(ownerToken, group.id, {
        joinedAt: localDate(localNoon(-30)),
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: participant.id,
      });
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 1,
      name: 'Разовое 450',
      price: 450,
      type: 'SINGLE_LESSON',
    });
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: new Date(when.getTime() + 3_600_000).toISOString(),
      groupId: group.id,
      startsAt: when.toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: students[0]?.id ?? '' },
      { status: 'LATE', studentId: students[1]?.id ?? '' },
      { status: 'ABSENT', studentId: students[2]?.id ?? '' },
      { status: 'EXCUSED', studentId: students[3]?.id ?? '' },
      { status: 'PRESENT', studentId: students[4]?.id ?? '' },
      { status: 'PRESENT', studentId: students[5]?.id ?? '' },
    ]);
    const trialStudent = students[4];
    if (!trialStudent) throw new Error('Trial fixture was not created.');
    await database.trialAppointment.create({
      data: {
        createdByUserId: ownerId,
        externalLeadId: 'matrix-trial-present',
        groupId: group.id,
        lessonId: lesson.id,
        studentId: trialStudent.id,
      },
    });
    await finance.createPayment(ownerToken, {
      amount: 450,
      attendanceLessonId: lesson.id,
      attendanceTariffId: tariff.id,
      branchId: branch.id,
      paidAt: when.toISOString(),
      paymentMethod: 'CASH',
      studentId: students[5]?.id ?? '',
    });

    const debts = await finance.financeDebts(ownerToken, {
      branchId: branch.id,
      debtType: 'ATTENDANCE',
      page: 1,
      pageSize: 50,
      sort: 'NAME',
    });
    expect(debts.summary).toMatchObject({
      debtorsCount: 2,
      totalDebt: 900,
      unvaluedAttendanceCount: 0,
    });
    expect(debts.items.map(({ studentId }) => studentId)).toEqual(
      expect.arrayContaining([students[0]?.id, students[1]?.id]),
    );
    expect(debts.items.map(({ studentId }) => studentId)).not.toEqual(
      expect.arrayContaining([students[2]?.id, students[3]?.id, students[4]?.id, students[5]?.id]),
    );
  });

  it('keeps unvalued attendance outside monetary totals and aging', async () => {
    const when = localNoon(-1);
    const { branch, student } = await foundation('Без цены');
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      direction: 'Танцы',
      name: 'Без тарифа',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, group.id, {
      joinedAt: localDate(localNoon(-30)),
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: new Date(when.getTime() + 3_600_000).toISOString(),
      groupId: group.id,
      startsAt: when.toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [{ status: 'LATE', studentId: student.id }]);

    const debts = await finance.financeDebts(ownerToken, {
      branchId: branch.id,
      debtType: 'ALL',
      page: 1,
      pageSize: 50,
      sort: 'OLDEST',
    });
    const analytics = await finance.financeAnalytics(ownerToken, {
      branchId: branch.id,
      dateFrom: localDate(when),
      dateTo: localDate(when),
    });
    expect(debts.summary).toMatchObject({
      debtorsCount: 0,
      totalDebt: 0,
      unvaluedAttendanceCount: 1,
    });
    expect(analytics.aging).toMatchObject({ currentDebt: 0, unvaluedAttendanceCount: 1 });
    expect(analytics.aging.buckets.reduce((sum, bucket) => sum + bucket.amount, 0)).toBe(0);
  });

  it('ages every debt source independently at the 7/8/30/31-day boundaries', async () => {
    const amounts = [700, 800, 3_000, 3_100];
    const days = [7, 8, 30, 31];
    for (const [index, age] of days.entries()) {
      const { branch, student } = await foundation(`Возраст ${String(age)}`);
      const purchasedAt = localNoon(-age);
      await packSubscription({
        branchId: branch.id,
        name: `Долг ${String(age)}`,
        paidAt: purchasedAt,
        salePrice: amounts[index] ?? 0,
        studentId: student.id,
      });
    }
    const analytics = await finance.financeAnalytics(ownerToken, {
      dateFrom: localDate(localNoon()),
      dateTo: localDate(localNoon()),
    });
    expect(analytics.aging.buckets).toEqual([
      { amount: 700, debtorCount: 1, key: 'DAYS_0_7' },
      { amount: 3_800, debtorCount: 2, key: 'DAYS_8_30' },
      { amount: 3_100, debtorCount: 1, key: 'DAYS_31_PLUS' },
    ]);
  });

  it('uses local calendar boundaries for payments, refunds and previous periods', async () => {
    const { branch, student } = await foundation('Полночь');
    const beforeMidnight = new Date(2026, 7, 26, 23, 59, 0, 0);
    const midnight = new Date(2026, 7, 27, 0, 0, 0, 0);
    const afterMidnight = new Date(2026, 7, 27, 0, 1, 0, 0);
    await finance.createPayment(ownerToken, {
      amount: 100,
      branchId: branch.id,
      paidAt: beforeMidnight.toISOString(),
      paymentMethod: 'CASH',
      studentId: student.id,
    });
    const first = await finance.createPayment(ownerToken, {
      amount: 200,
      branchId: branch.id,
      paidAt: midnight.toISOString(),
      paymentMethod: 'CASH',
      studentId: student.id,
    });
    await finance.createPayment(ownerToken, {
      amount: 300,
      branchId: branch.id,
      paidAt: afterMidnight.toISOString(),
      paymentMethod: 'CASH',
      studentId: student.id,
    });
    await finance.createRefund(ownerToken, first.id, {
      amount: 50,
      reason: 'Возврат после полуночи',
      refundedAt: afterMidnight.toISOString(),
    });

    const result = await dayOverview('2026-08-27', branch.id);
    expect(result.today).toMatchObject({ net: 450, received: 500, refunds: 50 });
    expect(result.analytics.daily).toContainEqual({
      date: '2026-08-27',
      net: 450,
      received: 500,
      refunds: 50,
    });
    expect(result.analytics).toMatchObject({
      previousDateFrom: '2026-08-26',
      previousDateTo: '2026-08-26',
      previous: { received: 100 },
    });
  });

  it('keeps archived canonical debt in Today, Debts and Analytics', async () => {
    const when = localNoon();
    const { branch, student } = await foundation('Архивный');
    await packSubscription({
      branchId: branch.id,
      name: 'Архивный долг',
      paidAt: when,
      salePrice: 5_000,
      studentId: student.id,
    });
    await database.student.update({
      data: { archivedAt: when, status: 'ARCHIVED' },
      where: { id: student.id },
    });

    const [today, debts, analytics] = await Promise.all([
      finance.financeToday(ownerToken, { branchId: branch.id, date: localDate(when) }),
      finance.financeDebts(ownerToken, {
        branchId: branch.id,
        debtType: 'ALL',
        page: 1,
        pageSize: 50,
        sort: 'OLDEST',
      }),
      finance.financeAnalytics(ownerToken, {
        branchId: branch.id,
        dateFrom: localDate(when),
        dateTo: localDate(when),
      }),
    ]);
    expect(today.debt.totalAmount).toBe(5_000);
    expect(debts.summary.totalDebt).toBe(5_000);
    expect(analytics.aging.currentDebt).toBe(5_000);
  });

  it('keeps every aggregate and export inside ADMIN branch scope', async () => {
    const when = localNoon();
    const first = await foundation('Первый');
    const second = await foundation('Второй');
    for (const [index, item] of [first, second].entries()) {
      await packSubscription({
        amount: (index + 1) * 1_000,
        branchId: item.branch.id,
        name: `Филиал ${String(index + 1)}`,
        paidAt: when,
        salePrice: (index + 1) * 4_000,
        studentId: item.student.id,
      });
    }
    await application.createUser(ownerToken, {
      branchIds: [first.branch.id],
      email: 'matrix-admin@arava.local',
      fullName: 'Администратор матрицы',
      password: 'Admin!Matrix2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [],
      email: 'matrix-global@arava.local',
      fullName: 'Глобальный администратор матрицы',
      password: 'Global!Matrix2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [first.branch.id],
      email: 'matrix-coach@arava.local',
      fullName: 'Тренер матрицы',
      password: 'Coach!Matrix2026',
      role: 'COACH',
    });
    const restricted = await application.login({
      email: 'matrix-admin@arava.local',
      password: 'Admin!Matrix2026',
    });
    const global = await application.login({
      email: 'matrix-global@arava.local',
      password: 'Global!Matrix2026',
    });
    const coach = await application.login({
      email: 'matrix-coach@arava.local',
      password: 'Coach!Matrix2026',
    });
    await application.changePassword(restricted.token, {
      currentPassword: 'Admin!Matrix2026',
      newPassword: 'Admin!MatrixChanged2026',
    });
    await application.changePassword(global.token, {
      currentPassword: 'Global!Matrix2026',
      newPassword: 'Global!MatrixChanged2026',
    });
    await application.changePassword(coach.token, {
      currentPassword: 'Coach!Matrix2026',
      newPassword: 'Coach!MatrixChanged2026',
    });
    const date = localDate(when);
    const restrictedAnalytics = await finance.financeAnalytics(restricted.token, {
      dateFrom: date,
      dateTo: date,
    });
    expect(restrictedAnalytics.current.received).toBe(1_000);
    expect(restrictedAnalytics.aging.currentDebt).toBe(3_000);
    expect(
      (await finance.financeAnalytics(global.token, { dateFrom: date, dateTo: date })).current
        .received,
    ).toBe(3_000);
    const journalCsv = await finance.exportFinanceJournalCsv(restricted.token, {
      dateFrom: date,
      dateTo: date,
      eventType: 'ALL',
    });
    const debtCsv = await finance.exportFinanceDebtCsv(restricted.token, {
      debtType: 'ALL',
      sort: 'OLDEST',
    });
    expect(journalCsv?.content).toContain(';1000,00;');
    expect(journalCsv?.content).not.toContain(';2000,00;');
    expect(debtCsv?.content).toContain('Первый');
    expect(debtCsv?.content).not.toContain('Второй');
    await expect(
      finance.financeAnalytics(restricted.token, {
        branchId: second.branch.id,
        dateFrom: date,
        dateTo: date,
      }),
    ).rejects.toThrow('нет доступа к этому филиалу');
    await expect(finance.financeToday(coach.token, { date })).rejects.toThrow('недостаточно прав');
  });
});
