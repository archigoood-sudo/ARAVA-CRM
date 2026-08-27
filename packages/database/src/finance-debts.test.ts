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

const DAY_MS = 86_400_000;
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

describe('Finance debt workspace', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let finance: FinanceService;
  let operations: PaymentOperationService;
  let ownerId: string;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-finance-debts-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'finance-debts.db')));
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
      newPassword: 'Owner!FinanceDebts2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  const query = (overrides: Partial<Parameters<FinanceService['financeDebts']>[1]> = {}) => ({
    debtType: 'ALL' as const,
    page: 1,
    pageSize: 50 as const,
    sort: 'OLDEST' as const,
    ...overrides,
  });

  async function foundation(name: string, status: 'ACTIVE' | 'LEFT' | 'ARCHIVED' = 'ACTIVE') {
    const branch = await application.createBranch(ownerToken, { name: `Филиал ${name}` });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: name,
      lastName: 'Должник',
      phone: `+7999000${String(Math.abs(name.length * 137)).padStart(4, '0')}`,
      status,
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      direction: 'Танцы',
      name: `Группа ${name}`,
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, group.id, {
      joinedAt: dateOnly(new Date(Date.now() - 30 * DAY_MS)),
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    return { branch, group, student };
  }

  async function subscriptionDebt(
    name: string,
    salePrice = 10_000,
    initialPayment?: number,
    studentStatus: 'ACTIVE' | 'LEFT' | 'ARCHIVED' = 'ACTIVE',
  ) {
    const base = await foundation(name, studentStatus);
    const tariff = await finance.createTariff(ownerToken, {
      branchId: base.branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 4,
      name: `Абонемент ${name}`,
      price: salePrice,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const purchasedAt = new Date(Date.now() - name.length * DAY_MS);
    const subscription = await finance.createSubscription(ownerToken, {
      ...(initialPayment === undefined
        ? {}
        : {
            initialPayment: {
              amount: initialPayment,
              paidAt: purchasedAt.toISOString(),
              paymentMethod: 'CASH' as const,
            },
          }),
      salePrice,
      startsAt: dateOnly(purchasedAt),
      studentId: base.student.id,
      tariffId: tariff.id,
    });
    await database.subscription.update({
      data: { purchasedAt },
      where: { id: subscription.id },
    });
    return { ...base, subscription, tariff };
  }

  it('returns no debt, aggregates multiple subscriptions, and keeps historical statuses', async () => {
    const empty = await foundation('БезДолга');
    expect(await finance.financeDebts(ownerToken, query())).toMatchObject({
      items: [],
      summary: { debtorsCount: 0, totalDebt: 0, unvaluedAttendanceCount: 0 },
    });
    const first = await subscriptionDebt('Анна', 10_000, 2_000);
    const secondTariff = await finance.createTariff(ownerToken, {
      branchId: first.branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 8,
      name: 'Второй абонемент',
      price: 20_000,
      type: 'LESSON_PACK',
      validityDays: 60,
    });
    const second = await finance.createSubscription(ownerToken, {
      salePrice: 20_000,
      startsAt: dateOnly(new Date()),
      studentId: first.student.id,
      tariffId: secondTariff.id,
    });
    await database.subscription.update({ data: { status: 'EXPIRED' }, where: { id: second.id } });
    const frozenTariff = await finance.createTariff(ownerToken, {
      branchId: first.branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 2,
      name: 'Замороженный абонемент',
      price: 3_000,
      type: 'LESSON_PACK',
      validityDays: 14,
    });
    const frozen = await finance.createSubscription(ownerToken, {
      salePrice: 3_000,
      startsAt: dateOnly(new Date()),
      studentId: first.student.id,
      tariffId: frozenTariff.id,
    });
    await database.subscription.update({ data: { status: 'FROZEN' }, where: { id: frozen.id } });
    await database.student.update({ data: { status: 'LEFT' }, where: { id: first.student.id } });
    const archived = await subscriptionDebt('Архивный', 5_000, undefined, 'ARCHIVED');

    const result = await finance.financeDebts(ownerToken, query());
    expect(result.summary).toMatchObject({ debtorsCount: 2, totalDebt: 36_000 });
    expect(result.items).toHaveLength(2);
    const leftStudent = result.items.find(({ studentId }) => studentId === first.student.id);
    expect(leftStudent).toMatchObject({
      debtSourcesCount: 3,
      status: 'LEFT',
      subscriptionDebt: 31_000,
      totalDebt: 31_000,
    });
    expect(leftStudent?.subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ debt: 8_000, salePrice: 10_000 }),
        expect.objectContaining({ debt: 20_000, status: 'EXPIRED' }),
        expect.objectContaining({ debt: 3_000, status: 'FROZEN' }),
      ]),
    );
    expect(result.items).toContainEqual(
      expect.objectContaining({
        status: 'ARCHIVED',
        studentId: archived.student.id,
        totalDebt: 5_000,
      }),
    );
    expect(result.items.some(({ studentId }) => studentId === empty.student.id)).toBe(false);
  });

  it('reconciles partial, full, cancelled and refunded subscription payments canonically', async () => {
    const { branch, student, subscription } = await subscriptionDebt('Борис', 13_000);
    const partial = await finance.createPayment(ownerToken, {
      amount: 5_000,
      branchId: branch.id,
      paidAt: new Date().toISOString(),
      paymentMethod: 'CASH',
      studentId: student.id,
      subscriptionId: subscription.id,
    });
    expect((await finance.financeDebts(ownerToken, query())).items[0]?.totalDebt).toBe(8_000);
    const cancelled = await finance.createPayment(ownerToken, {
      amount: 8_000,
      branchId: branch.id,
      paidAt: new Date().toISOString(),
      paymentMethod: 'CARD',
      studentId: student.id,
      subscriptionId: subscription.id,
    });
    await finance.cancelPayment(ownerToken, cancelled.id);
    expect((await finance.financeDebts(ownerToken, query())).items[0]?.totalDebt).toBe(8_000);
    const full = await finance.createPayment(ownerToken, {
      amount: 8_000,
      branchId: branch.id,
      paidAt: new Date().toISOString(),
      paymentMethod: 'TRANSFER',
      studentId: student.id,
      subscriptionId: subscription.id,
    });
    expect((await finance.financeDebts(ownerToken, query())).items).toHaveLength(0);
    await finance.createRefund(ownerToken, full.id, {
      amount: 8_000,
      reason: 'Возврат полной доплаты',
      refundedAt: new Date().toISOString(),
    });
    expect((await finance.financeDebts(ownerToken, query())).items[0]?.totalDebt).toBe(8_000);
    expect(await database.payment.count({ where: { id: partial.id } })).toBe(1);
  });

  it('derives valued and unvalued uncovered attendance, excludes trials, and restores after refund', async () => {
    const valued = await foundation('Вера');
    const single = await finance.createTariff(ownerToken, {
      branchId: valued.branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 1,
      name: 'Разовое посещение',
      price: 1_500,
      type: 'SINGLE_LESSON',
    });
    const startsAt = new Date(Date.now() - 4 * DAY_MS);
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      groupId: valued.group.id,
      startsAt: startsAt.toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: valued.student.id },
    ]);
    let overview = await finance.financeDebts(ownerToken, query());
    expect(overview.items[0]).toMatchObject({ attendanceDebt: 1_500, totalDebt: 1_500 });
    expect(overview.items[0]?.oldestDebtDate).toBe(startsAt.toISOString());

    const payment = await finance.createPayment(ownerToken, {
      amount: 1_500,
      attendanceLessonId: lesson.id,
      attendanceTariffId: single.id,
      branchId: valued.branch.id,
      paidAt: new Date().toISOString(),
      paymentMethod: 'CASH',
      studentId: valued.student.id,
    });
    expect((await finance.financeDebts(ownerToken, query())).items).toHaveLength(0);
    await finance.createRefund(ownerToken, payment.id, {
      amount: 1_500,
      reason: 'Возврат разового посещения',
      refundedAt: new Date().toISOString(),
    });
    expect((await finance.financeDebts(ownerToken, query())).items[0]?.attendanceDebt).toBe(1_500);

    await finance.createTariff(ownerToken, {
      currency: 'RUB',
      isActive: true,
      lessonCount: 1,
      name: 'Второй разовый тариф',
      price: 1_800,
      type: 'SINGLE_LESSON',
    });
    overview = await finance.financeDebts(ownerToken, query());
    expect(overview.summary).toMatchObject({ totalDebt: 0, unvaluedAttendanceCount: 1 });
    expect(overview.items[0]).toMatchObject({
      totalDebt: 0,
      unvaluedAttendanceCount: 1,
    });

    await database.trialAppointment.create({
      data: {
        createdByUserId: ownerId,
        externalLeadId: 'trial-debt-exclusion',
        groupId: valued.group.id,
        lessonId: lesson.id,
        studentId: valued.student.id,
      },
    });
    expect((await finance.financeDebts(ownerToken, query())).items).toHaveLength(0);
  });

  it('shows pending reservations without reducing debt and does not expose an overpayment action', async () => {
    const { branch, student, subscription } = await subscriptionDebt('Галина', 10_000);
    await operations.create(ownerToken, {
      amount: 4_000,
      branchId: branch.id,
      currency: 'RUB',
      idempotencyKey: 'debt-reservation',
      providerType: 'SBP',
      purpose: 'Доплата по абонементу',
      studentId: student.id,
      subscriptionId: subscription.id,
    });
    const result = await finance.financeDebts(ownerToken, query());
    expect(result.summary.totalDebt).toBe(10_000);
    expect(result.items[0]?.subscriptions[0]).toMatchObject({
      availablePaymentAmount: 6_000,
      debt: 10_000,
      pendingAmount: 4_000,
    });
  });

  it('enforces branch scope, global admin, coach denial, filters, sorting and pagination summaries', async () => {
    const first = await subscriptionDebt('Даша', 9_000);
    const second = await subscriptionDebt('Елена', 20_000);
    await application.createUser(ownerToken, {
      branchIds: [first.branch.id],
      email: 'debt-admin@arava.local',
      fullName: 'Администратор долгов',
      password: 'Admin!Debt2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [],
      email: 'debt-global@arava.local',
      fullName: 'Глобальный администратор',
      password: 'Global!Debt2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [first.branch.id],
      email: 'debt-coach@arava.local',
      fullName: 'Тренер долгов',
      password: 'Coach!Debt2026',
      role: 'COACH',
    });
    const restricted = await application.login({
      email: 'debt-admin@arava.local',
      password: 'Admin!Debt2026',
    });
    const global = await application.login({
      email: 'debt-global@arava.local',
      password: 'Global!Debt2026',
    });
    const coach = await application.login({
      email: 'debt-coach@arava.local',
      password: 'Coach!Debt2026',
    });
    await application.changePassword(restricted.token, {
      currentPassword: 'Admin!Debt2026',
      newPassword: 'Admin!DebtChanged2026',
    });
    await application.changePassword(global.token, {
      currentPassword: 'Global!Debt2026',
      newPassword: 'Global!DebtChanged2026',
    });
    await application.changePassword(coach.token, {
      currentPassword: 'Coach!Debt2026',
      newPassword: 'Coach!DebtChanged2026',
    });
    expect((await finance.financeDebts(restricted.token, query())).items).toHaveLength(1);
    expect((await finance.financeDebts(global.token, query())).items).toHaveLength(2);
    await expect(finance.financeDebts(coach.token, query())).rejects.toThrow('недостаточно прав');
    await expect(
      finance.financeDebts(restricted.token, query({ branchId: second.branch.id })),
    ).rejects.toThrow('нет доступа к этому филиалу');

    const sorted = await finance.financeDebts(
      ownerToken,
      query({ pageSize: 25, search: 'Должник', sort: 'AMOUNT' }),
    );
    expect(sorted.items.map(({ totalDebt }) => totalDebt)).toEqual([20_000, 9_000]);
    expect(sorted.summary).toMatchObject({ debtorsCount: 2, totalDebt: 29_000 });
    const subscriptionsOnly = await finance.financeDebts(
      ownerToken,
      query({ debtType: 'SUBSCRIPTION' }),
    );
    expect(subscriptionsOnly.items).toHaveLength(2);
    expect(await finance.financeDebts(ownerToken, query({ debtType: 'ATTENDANCE' }))).toMatchObject(
      { items: [], summary: { totalDebt: 0 } },
    );
  });
});
