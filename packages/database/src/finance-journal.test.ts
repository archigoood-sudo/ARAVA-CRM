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
import { StudioService } from './studio-service';

function localDate(value = new Date()): string {
  return [
    String(value.getFullYear()),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function timeToday(hour: number, minute = 0): Date {
  const value = new Date();
  value.setHours(hour, minute, 0, 0);
  return value;
}

describe('Finance operations journal', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let finance: FinanceService;
  let ownerId: string;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-finance-journal-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'finance-journal.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    finance = new FinanceService(database, application);
    studio = new StudioService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerId = owner.user.id;
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!FinanceJournal2026',
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
      phone: '+79991234567',
      status: 'ACTIVE',
    });
    return { branch, student };
  }

  function query(overrides: Partial<Parameters<FinanceService['financeJournal']>[1]> = {}) {
    const date = localDate();
    return {
      dateFrom: date,
      dateTo: date,
      eventType: 'ALL' as const,
      page: 1,
      pageSize: 50 as const,
      ...overrides,
    };
  }

  it('keeps canonical payments and refunds as separate historical events with human purposes', async () => {
    const { branch, student } = await foundation();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 8,
      name: 'Восемь занятий',
      price: 3_300,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const subscription = await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: ownerId,
        lessonLimit: 8,
        purchasedAt: timeToday(9),
        salePrice: 3_800,
        startsAt: timeToday(0),
        status: 'ACTIVE',
        studentId: student.id,
        tariffId: tariff.id,
      },
    });
    const initial = await database.payment.create({
      data: {
        amount: 3_300,
        branchId: branch.id,
        createdByUserId: ownerId,
        paidAt: timeToday(9),
        paymentMethod: 'CASH',
        studentId: student.id,
        subscriptionId: subscription.id,
      },
    });
    await finance.createPayment(ownerToken, {
      amount: 500,
      branchId: branch.id,
      paidAt: timeToday(10).toISOString(),
      paymentMethod: 'CARD',
      studentId: student.id,
      subscriptionId: subscription.id,
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      direction: 'Танцы',
      name: 'Импульс',
      status: 'ACTIVE',
    });
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: timeToday(13).toISOString(),
      groupId: group.id,
      startsAt: timeToday(12).toISOString(),
    });
    await database.payment.create({
      data: {
        amount: 200,
        attendanceLessonId: lesson.id,
        branchId: branch.id,
        createdByUserId: ownerId,
        paidAt: timeToday(12, 30),
        paymentMethod: 'SBP',
        studentId: student.id,
      },
    });
    const cancelled = await finance.createPayment(ownerToken, {
      amount: 9_999,
      branchId: branch.id,
      paidAt: timeToday(14).toISOString(),
      paymentMethod: 'TRANSFER',
      studentId: student.id,
    });
    await finance.cancelPayment(ownerToken, cancelled.id);
    await finance.createRefund(ownerToken, initial.id, {
      amount: 3_300,
      reason: 'Полный возврат по заявлению',
      refundedAt: timeToday(15).toISOString(),
    });
    const trial = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 1,
      name: 'Пробное занятие',
      price: 0,
      type: 'TRIAL',
    });
    await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: ownerId,
        lessonLimit: 1,
        purchasedAt: timeToday(9),
        salePrice: 0,
        startsAt: timeToday(0),
        status: 'ACTIVE',
        studentId: student.id,
        tariffId: trial.id,
      },
    });

    const journal = await finance.financeJournal(ownerToken, query());
    expect(journal.summary).toMatchObject({
      net: 700,
      operationsCount: 4,
      received: 4_000,
      refunds: 3_300,
    });
    expect(journal.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 3_300,
          kind: 'PAYMENT',
          purpose: 'Абонемент «Восемь занятий»',
          status: 'REFUNDED',
        }),
        expect.objectContaining({
          amount: 500,
          kind: 'PAYMENT',
          purpose: 'Доплата по абонементу «Восемь занятий»',
        }),
        expect.objectContaining({
          amount: 3_300,
          kind: 'REFUND',
          originalPaymentAmount: 3_300,
          originalPaymentAt: initial.paidAt.toISOString(),
        }),
      ]),
    );
    expect(
      journal.items.some(({ kind, purpose }) => kind === 'PAYMENT' && purpose.includes('Импульс')),
    ).toBe(true);
    expect(journal.items.some(({ paymentId }) => paymentId === cancelled.id)).toBe(false);
    const today = await finance.financeToday(ownerToken, { date: localDate() });
    expect(journal.summary).toMatchObject({
      net: today.net,
      received: today.received,
      refunds: today.refunds,
    });
  });

  it('filters on the backend by date, student phone, method, branch and event type', async () => {
    const first = await foundation('Центр');
    const second = await foundation('Север');
    const payment = await finance.createPayment(ownerToken, {
      amount: 1_500,
      branchId: first.branch.id,
      paidAt: timeToday(0).toISOString(),
      paymentMethod: 'CASH',
      studentId: first.student.id,
    });
    await finance.createPayment(ownerToken, {
      amount: 2_500,
      branchId: second.branch.id,
      paidAt: timeToday(23, 59).toISOString(),
      paymentMethod: 'SBP',
      studentId: second.student.id,
    });
    await finance.createRefund(ownerToken, payment.id, {
      amount: 500,
      reason: 'Частичный возврат',
      refundedAt: timeToday(23, 59).toISOString(),
    });

    expect(
      (
        await finance.financeJournal(
          ownerToken,
          query({ branchId: first.branch.id, paymentMethod: 'CASH', search: '1234567' }),
        )
      ).summary,
    ).toMatchObject({ operationsCount: 2, received: 1_500, refunds: 500 });
    expect(
      (await finance.financeJournal(ownerToken, query({ eventType: 'REFUND' }))).summary,
    ).toMatchObject({ operationsCount: 1, received: 0, refunds: 500 });
    expect(
      (await finance.financeJournal(ownerToken, query({ eventType: 'PAYMENT' }))).summary,
    ).toMatchObject({ operationsCount: 2, received: 4_000, refunds: 0 });
    expect(
      (
        await finance.financeJournal(
          ownerToken,
          query({ dateFrom: '2000-01-01', dateTo: '2000-01-31' }),
        )
      ).items,
    ).toEqual([]);
  });

  it('attributes a refund to refundedAt without moving the original payment event', async () => {
    const { branch, student } = await foundation();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    const payment = await finance.createPayment(ownerToken, {
      amount: 2_000,
      branchId: branch.id,
      paidAt: yesterday.toISOString(),
      paymentMethod: 'CARD',
      studentId: student.id,
    });
    await finance.createRefund(ownerToken, payment.id, {
      amount: 500,
      reason: 'Возврат на следующий день',
      refundedAt: timeToday(12).toISOString(),
    });

    const today = await finance.financeJournal(ownerToken, query());
    expect(today.summary).toMatchObject({ operationsCount: 1, received: 0, refunds: 500 });
    expect(today.items[0]).toMatchObject({ kind: 'REFUND', paymentId: payment.id });
    const previous = await finance.financeJournal(
      ownerToken,
      query({ dateFrom: localDate(yesterday), dateTo: localDate(yesterday) }),
    );
    expect(previous.summary).toMatchObject({ operationsCount: 1, received: 2_000, refunds: 0 });
    expect(previous.items[0]).toMatchObject({ kind: 'PAYMENT', paymentId: payment.id });
  });

  it('uses DB pagination with a stable tie-breaker and summary across all pages', async () => {
    const { branch, student } = await foundation();
    const occurredAt = timeToday(12);
    await Promise.all(
      Array.from({ length: 55 }, (_, index) =>
        database.payment.create({
          data: {
            amount: 100 + index,
            branchId: branch.id,
            createdByUserId: ownerId,
            paidAt: occurredAt,
            paymentMethod: 'CASH',
            studentId: student.id,
          },
        }),
      ),
    );

    const first = await finance.financeJournal(ownerToken, query({ pageSize: 25 }));
    const second = await finance.financeJournal(ownerToken, query({ page: 2, pageSize: 25 }));
    const third = await finance.financeJournal(ownerToken, query({ page: 3, pageSize: 25 }));
    expect(first).toMatchObject({ page: 1, total: 55, totalPages: 3 });
    expect(first.summary).toMatchObject({ operationsCount: 55, received: 6_985 });
    expect(first.items).toHaveLength(25);
    expect(second.items).toHaveLength(25);
    expect(third.items).toHaveLength(5);
    expect(
      new Set([...first.items, ...second.items, ...third.items].map(({ id }) => id)).size,
    ).toBe(55);
    expect((await finance.financeJournal(ownerToken, query({ pageSize: 25 }))).items).toEqual(
      first.items,
    );
  });

  it('enforces OWNER, restricted/global ADMIN and COACH finance permissions', async () => {
    const first = await foundation('Центр');
    const second = await foundation('Север');
    for (const entry of [first, second])
      await finance.createPayment(ownerToken, {
        amount: entry === first ? 1_000 : 2_000,
        branchId: entry.branch.id,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
        studentId: entry.student.id,
      });
    await application.createUser(ownerToken, {
      branchIds: [first.branch.id],
      email: 'journal-admin@arava.local',
      fullName: 'Администратор филиала',
      password: 'Admin!FinanceJournal2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [],
      email: 'journal-global@arava.local',
      fullName: 'Глобальный администратор',
      password: 'Admin!FinanceGlobal2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [first.branch.id],
      email: 'journal-coach@arava.local',
      fullName: 'Тренер',
      password: 'Coach!FinanceJournal2026',
      role: 'COACH',
    });
    const restricted = await application.login({
      email: 'journal-admin@arava.local',
      password: 'Admin!FinanceJournal2026',
    });
    const global = await application.login({
      email: 'journal-global@arava.local',
      password: 'Admin!FinanceGlobal2026',
    });
    const coach = await application.login({
      email: 'journal-coach@arava.local',
      password: 'Coach!FinanceJournal2026',
    });
    await application.changePassword(restricted.token, {
      currentPassword: 'Admin!FinanceJournal2026',
      newPassword: 'Admin!FinanceJournalChanged2026',
    });
    await application.changePassword(global.token, {
      currentPassword: 'Admin!FinanceGlobal2026',
      newPassword: 'Admin!FinanceGlobalChanged2026',
    });
    await application.changePassword(coach.token, {
      currentPassword: 'Coach!FinanceJournal2026',
      newPassword: 'Coach!FinanceJournalChanged2026',
    });

    expect((await finance.financeJournal(ownerToken, query())).summary.received).toBe(3_000);
    expect((await finance.financeJournal(restricted.token, query())).summary.received).toBe(1_000);
    expect((await finance.financeJournal(global.token, query())).summary.received).toBe(3_000);
    await expect(
      finance.financeJournal(restricted.token, query({ branchId: second.branch.id })),
    ).rejects.toThrow('нет доступа к этому филиалу');
    await expect(finance.financeJournal(coach.token, query())).rejects.toThrow('недостаточно прав');
  });

  it('exports filtered UTF-8 CSV safely and refuses empty or unauthorized exports', async () => {
    const { branch, student } = await foundation();
    await database.student.update({
      data: { lastName: '=ОПАСНАЯ_ФОРМУЛА' },
      where: { id: student.id },
    });
    await database.branch.update({
      data: { name: '@Филиал, "центр"\nВторая строка' },
      where: { id: branch.id },
    });
    const payment = await finance.createPayment(ownerToken, {
      amount: 1_250,
      branchId: branch.id,
      paidAt: timeToday(8).toISOString(),
      paymentMethod: 'CASH',
      studentId: student.id,
    });
    await finance.createRefund(ownerToken, payment.id, {
      amount: 250,
      reason: 'Возврат',
      refundedAt: timeToday(9).toISOString(),
    });

    const exported = await finance.exportFinanceJournalCsv(ownerToken, query());
    expect(exported?.filename).toBe(`ARAVA-finance-${localDate()}_${localDate()}.csv`);
    expect(exported?.content.startsWith('\uFEFF')).toBe(true);
    expect(exported?.content).toContain('"Дата";"Время";"Тип операции"');
    expect(exported?.content).toContain('"\'=ОПАСНАЯ_ФОРМУЛА Анна"');
    expect(exported?.content).toContain('"\'@Филиал, ""центр""\nВторая строка"');
    expect(exported?.content).toContain('-250,00');
    expect(exported?.content).toContain('Возврат');
    expect(
      await finance.exportFinanceJournalCsv(ownerToken, {
        dateFrom: '2000-01-01',
        dateTo: '2000-01-02',
        eventType: 'ALL',
      }),
    ).toBeUndefined();

    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'journal-export-coach@arava.local',
      fullName: 'Тренер экспорта',
      password: 'Coach!JournalExport2026',
      role: 'COACH',
    });
    const coach = await application.login({
      email: 'journal-export-coach@arava.local',
      password: 'Coach!JournalExport2026',
    });
    await application.changePassword(coach.token, {
      currentPassword: 'Coach!JournalExport2026',
      newPassword: 'Coach!JournalExportChanged2026',
    });
    await expect(finance.exportFinanceJournalCsv(coach.token, query())).rejects.toThrow(
      'недостаточно прав',
    );
  });
});
