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
import { ApplicationService } from './services';

describe('Finance analytics', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let finance: FinanceService;
  let ownerId: string;
  let ownerToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-finance-analytics-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'analytics.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    finance = new FinanceService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerId = owner.user.id;
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Analytics2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function foundation(name = 'Аналитика') {
    const branch = await application.createBranch(ownerToken, { name: `Филиал ${name}` });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: name,
      lastName: 'Финансов',
      status: 'ACTIVE',
    });
    return { branch, student };
  }

  const query = (branchId?: string) => ({
    ...(branchId ? { branchId } : {}),
    dateFrom: '2026-08-01',
    dateTo: '2026-08-07',
  });

  async function createLegacySubscription(input: {
    branchId: string;
    initialPayment?: number;
    lessonLimit: number;
    purchasedAt: Date;
    salePrice: number;
    studentId: string;
    tariffId: string;
  }) {
    const subscription = await database.subscription.create({
      data: {
        branchId: input.branchId,
        createdByUserId: ownerId,
        lessonLimit: input.lessonLimit,
        purchasedAt: input.purchasedAt,
        salePrice: input.salePrice,
        startsAt: input.purchasedAt,
        status: 'ACTIVE',
        studentId: input.studentId,
        tariffId: input.tariffId,
      },
    });
    if (input.initialPayment !== undefined)
      await database.payment.create({
        data: {
          amount: input.initialPayment,
          branchId: input.branchId,
          createdByUserId: ownerId,
          paidAt: input.purchasedAt,
          paymentMethod: 'CASH',
          studentId: input.studentId,
          subscriptionId: subscription.id,
        },
      });
    return subscription;
  }

  it('returns a stable empty period and a finite previous-period comparison', async () => {
    const result = await finance.financeAnalytics(ownerToken, query());
    expect(result).toMatchObject({
      current: { averagePayment: 0, net: 0, paymentCount: 0, received: 0, refunds: 0 },
      previous: { net: 0, received: 0, refunds: 0 },
      previousDateFrom: '2026-07-25',
      previousDateTo: '2026-07-31',
    });
    expect(result.daily).toHaveLength(7);
  });

  it('aggregates canonical payments, refunds, methods and local daily net', async () => {
    const { branch, student } = await foundation();
    const first = await finance.createPayment(ownerToken, {
      amount: 10_000,
      branchId: branch.id,
      paidAt: '2026-08-02T09:00:00.000Z',
      paymentMethod: 'CASH',
      studentId: student.id,
    });
    await finance.createPayment(ownerToken, {
      amount: 5_000,
      branchId: branch.id,
      paidAt: '2026-08-03T09:00:00.000Z',
      paymentMethod: 'SBP',
      studentId: student.id,
    });
    await finance.createRefund(ownerToken, first.id, {
      amount: 3_000,
      reason: 'Частичный возврат для аналитики',
      refundedAt: '2026-08-03T12:00:00.000Z',
    });
    await finance.createPayment(ownerToken, {
      amount: 4_000,
      branchId: branch.id,
      paidAt: '2026-07-28T09:00:00.000Z',
      paymentMethod: 'CASH',
      studentId: student.id,
    });

    const result = await finance.financeAnalytics(ownerToken, query());
    expect(result.current).toMatchObject({
      averagePayment: 7_500,
      net: 12_000,
      paymentCount: 2,
      received: 15_000,
      refunds: 3_000,
    });
    expect(result.previous.received).toBe(4_000);
    expect(result.byMethod).toEqual(
      expect.arrayContaining([
        { amount: 10_000, count: 1, method: 'CASH' },
        { amount: 5_000, count: 1, method: 'SBP' },
      ]),
    );
    expect(result.daily).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2026-08-02', net: 10_000 }),
        expect.objectContaining({ date: '2026-08-03', net: 2_000, refunds: 3_000 }),
      ]),
    );
    const today = await finance.financeToday(ownerToken, { date: '2026-08-03' });
    const journal = await finance.financeJournal(ownerToken, {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-07',
      eventType: 'ALL',
      page: 1,
      pageSize: 50,
    });
    expect(result.current.net).toBe(journal.summary.net);
    expect(result.daily.find(({ date }) => date === '2026-08-03')?.net).toBe(today.net);
  });

  it('separates subscription sale value, direct attendance and current debt aging', async () => {
    const { branch, student } = await foundation('Продажи');
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 8,
      name: 'Абонемент аналитики',
      price: 20_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    await createLegacySubscription({
      branchId: branch.id,
      initialPayment: 5_000,
      lessonLimit: 8,
      purchasedAt: new Date('2026-08-02T10:00:00.000Z'),
      salePrice: 20_000,
      studentId: student.id,
      tariffId: tariff.id,
    });
    await database.payment.create({
      data: {
        amount: 1_500,
        attendanceLessonId: 'analytics-lesson',
        attendanceTariffId: 'analytics-tariff',
        branchId: branch.id,
        createdByUserId: ownerId,
        paidAt: new Date('2026-08-04T10:00:00.000Z'),
        paymentMethod: 'CARD',
        studentId: student.id,
      },
    });

    const result = await finance.financeAnalytics(ownerToken, query());
    const debts = await finance.financeDebts(ownerToken, {
      debtType: 'ALL',
      page: 1,
      pageSize: 50,
      sort: 'OLDEST',
    });
    expect(result.current).toMatchObject({
      directAttendance: { amount: 1_500, count: 1 },
      subscriptionSales: { count: 1, value: 20_000 },
    });
    expect(result.aging.currentDebt).toBe(debts.summary.totalDebt);
    expect(result.aging.currentDebt).toBe(15_000);
    expect(result.aging.buckets.reduce((sum, bucket) => sum + bucket.amount, 0)).toBe(15_000);
  });

  it('supports a real refund-only negative period', async () => {
    const { branch, student } = await foundation('Возврат');
    const payment = await finance.createPayment(ownerToken, {
      amount: 7_000,
      branchId: branch.id,
      paidAt: '2026-07-20T09:00:00.000Z',
      paymentMethod: 'CASH',
      studentId: student.id,
    });
    await finance.createRefund(ownerToken, payment.id, {
      amount: 7_000,
      reason: 'Полный возврат в новом периоде',
      refundedAt: '2026-08-02T09:00:00.000Z',
    });
    expect((await finance.financeAnalytics(ownerToken, query())).current).toMatchObject({
      net: -7_000,
      received: 0,
      refunds: 7_000,
    });
  });

  it('ages each current debt source into 0–7, 8–30 and 31+ day buckets', async () => {
    for (const [index, days] of [3, 15, 45].entries()) {
      const { branch, student } = await foundation(`Возраст ${String(days)}`);
      const tariff = await finance.createTariff(ownerToken, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        lessonCount: 4,
        name: `Долг ${String(days)}`,
        price: (index + 1) * 1_000,
        type: 'LESSON_PACK',
      });
      await createLegacySubscription({
        branchId: branch.id,
        lessonLimit: 4,
        purchasedAt: new Date(Date.now() - days * 86_400_000),
        salePrice: (index + 1) * 1_000,
        studentId: student.id,
        tariffId: tariff.id,
      });
    }
    expect((await finance.financeAnalytics(ownerToken, query())).aging.buckets).toEqual([
      { amount: 1_000, debtorCount: 1, key: 'DAYS_0_7' },
      { amount: 2_000, debtorCount: 1, key: 'DAYS_8_30' },
      { amount: 3_000, debtorCount: 1, key: 'DAYS_31_PLUS' },
    ]);
  });

  it('enforces branch scope, global ADMIN access and COACH denial', async () => {
    const first = await foundation('Первый');
    const second = await foundation('Второй');
    for (const item of [first, second])
      await finance.createPayment(ownerToken, {
        amount: 1_000,
        branchId: item.branch.id,
        paidAt: '2026-08-02T09:00:00.000Z',
        paymentMethod: 'CASH',
        studentId: item.student.id,
      });
    await application.createUser(ownerToken, {
      branchIds: [first.branch.id],
      email: 'analytics-admin@arava.local',
      fullName: 'Администратор аналитики',
      password: 'Admin!Analytics2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [],
      email: 'analytics-global@arava.local',
      fullName: 'Глобальный администратор',
      password: 'Global!Analytics2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [first.branch.id],
      email: 'analytics-coach@arava.local',
      fullName: 'Тренер аналитики',
      password: 'Coach!Analytics2026',
      role: 'COACH',
    });
    const restricted = await application.login({
      email: 'analytics-admin@arava.local',
      password: 'Admin!Analytics2026',
    });
    const global = await application.login({
      email: 'analytics-global@arava.local',
      password: 'Global!Analytics2026',
    });
    const coach = await application.login({
      email: 'analytics-coach@arava.local',
      password: 'Coach!Analytics2026',
    });
    await application.changePassword(restricted.token, {
      currentPassword: 'Admin!Analytics2026',
      newPassword: 'Admin!AnalyticsChanged2026',
    });
    await application.changePassword(global.token, {
      currentPassword: 'Global!Analytics2026',
      newPassword: 'Global!AnalyticsChanged2026',
    });
    await application.changePassword(coach.token, {
      currentPassword: 'Coach!Analytics2026',
      newPassword: 'Coach!AnalyticsChanged2026',
    });
    expect((await finance.financeAnalytics(restricted.token, query())).current.received).toBe(
      1_000,
    );
    expect((await finance.financeAnalytics(global.token, query())).current.received).toBe(2_000);
    await expect(finance.financeAnalytics(coach.token, query())).rejects.toThrow(
      'недостаточно прав',
    );
    await expect(
      finance.financeAnalytics(restricted.token, query(second.branch.id)),
    ).rejects.toThrow('нет доступа к этому филиалу');
  });

  it('exports filtered debt CSV with Russian BOM, escaping and injection protection', async () => {
    const { branch, student } = await foundation('=Формула');
    await database.student.update({
      data: { firstName: 'Опасный', lastName: '=Формула' },
      where: { id: student.id },
    });
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 4,
      name: 'CSV долг',
      price: 9_000,
      type: 'LESSON_PACK',
    });
    await createLegacySubscription({
      branchId: branch.id,
      lessonLimit: 4,
      purchasedAt: new Date('2026-08-01T10:00:00.000Z'),
      salePrice: 9_000,
      studentId: student.id,
      tariffId: tariff.id,
    });
    const exported = await finance.exportFinanceDebtCsv(ownerToken, {
      branchId: branch.id,
      debtType: 'ALL',
      search: 'Формула',
      sort: 'OLDEST',
    });
    expect(exported?.content.startsWith('\uFEFF')).toBe(true);
    expect(exported?.content).toContain(';');
    expect(exported?.content).toContain("'=Формула");
    expect(exported?.content).toContain('\r\n');
    expect(
      await finance.exportFinanceDebtCsv(ownerToken, {
        branchId: branch.id,
        debtType: 'ATTENDANCE',
        sort: 'OLDEST',
      }),
    ).toBeUndefined();
  });
});
