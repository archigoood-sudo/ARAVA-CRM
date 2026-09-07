import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PAYOUT_CATEGORIES,
  type PayoutCategory,
  type PayoutCalculationMode,
  type TrainerPayoutProfileInput,
} from '@arava/shared';

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
import { ManagementService } from './management-service';
import { ApplicationService } from './services';
import { StudioService } from './studio-service';
import { AttendanceScenarioService } from './attendance-scenarios';
import { AttendanceScenarioReconciliationService } from './attendance-scenario-reconciliation';

const DAY = 86_400_000;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const inputDateForTest = (date: Date) =>
  `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

describe('Sprint 4 management service', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let finance: FinanceService;
  let management: ManagementService;
  let ownerId: string;
  let ownerToken: string;
  let studio: StudioService;
  let attendanceScenarios: AttendanceScenarioService;
  let attendanceScenarioReconciliation: AttendanceScenarioReconciliationService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-management-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'management.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    finance = new FinanceService(database, application);
    management = new ManagementService(database, application);
    studio = new StudioService(database, application);
    attendanceScenarios = new AttendanceScenarioService(database, application);
    attendanceScenarioReconciliation = new AttendanceScenarioReconciliationService(
      database,
      application,
    );
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerId = owner.user.id;
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

  async function branchAndRegisters() {
    const branch = await application.createBranch(ownerToken, {
      address: 'ул. Управленческая, 1',
      name: 'Центр',
      phone: '+79990000001',
    });
    const first = await management.createCashRegister(ownerToken, {
      branchId: branch.id,
      isActive: true,
      name: 'Основная касса',
      openingBalance: 100_000,
      type: 'CASH',
    });
    const second = await management.createCashRegister(ownerToken, {
      branchId: branch.id,
      isActive: true,
      name: 'Расчётный счёт',
      openingBalance: 50_000,
      type: 'BANK',
    });
    return { branch, first, second };
  }

  async function coachFoundation() {
    const { branch, first } = await branchAndRegisters();
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach-payroll@arava.local',
      fullName: 'Анна Тренерова',
      password: 'Coach!Secure2026',
      role: 'COACH',
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      coachId: coach.id,
      direction: 'Балет',
      name: 'Грация',
      status: 'ACTIVE',
    });
    return { branch, coach, first, group };
  }

  function payoutRules(
    overrides: Partial<
      Record<
        PayoutCategory,
        { amount?: number; mode?: PayoutCalculationMode; percentage?: number } | null
      >
    >,
  ): TrainerPayoutProfileInput['rules'] {
    return PAYOUT_CATEGORIES.map((category) => {
      const override = overrides[category];
      return override === null
        ? { category }
        : { category, mode: 'NO_PAYOUT' as const, ...override };
    });
  }

  it('keeps the expense lifecycle auditable and posts only confirmed expenses to cash', async () => {
    const { branch, first } = await branchAndRegisters();
    const category = await management.createExpenseCategory(ownerToken, {
      branchId: branch.id,
      isActive: true,
      name: 'Аренда',
    });
    const expense = await management.createExpense(ownerToken, {
      amount: 30_000,
      branchId: branch.id,
      categoryId: category.id,
      description: 'Аренда зала',
      paymentMethod: 'CASH',
      spentAt: new Date().toISOString(),
    });
    expect(expense.status).toBe('DRAFT');
    expect(await database.cashTransaction.count()).toBe(0);
    expect((await management.confirmExpense(ownerToken, expense.id, first.id)).status).toBe(
      'CONFIRMED',
    );
    expect((await management.listCashRegisters(ownerToken))[0]?.balance).toBe(70_000);
    expect((await management.cancelExpense(ownerToken, expense.id)).status).toBe('CANCELLED');
    expect((await management.listCashRegisters(ownerToken))[0]?.balance).toBe(100_000);
    expect(await database.expense.count({ where: { id: expense.id } })).toBe(1);
    expect(
      await database.auditLog.count({
        where: {
          action: { in: ['EXPENSE_CREATED', 'EXPENSE_CONFIRMED', 'EXPENSE_CANCELLED'] },
        },
      }),
    ).toBe(3);
  });

  it('creates atomic transfer ledger entries and preserves the combined balance', async () => {
    const { first, second } = await branchAndRegisters();
    const entries = await management.transferCash(ownerToken, {
      amount: 25_000,
      fromCashRegisterId: first.id,
      occurredAt: new Date().toISOString(),
      reason: 'Инкассация',
      toCashRegisterId: second.id,
    });
    expect(entries).toHaveLength(2);
    expect(entries.every(({ type }) => type === 'TRANSFER')).toBe(true);
    const registers = await management.listCashRegisters(ownerToken);
    expect(registers.find(({ id }) => id === first.id)?.balance).toBe(75_000);
    expect(registers.find(({ id }) => id === second.id)?.balance).toBe(75_000);
    await expect(
      management.transferCash(ownerToken, {
        amount: 1,
        fromCashRegisterId: first.id,
        occurredAt: new Date().toISOString(),
        reason: 'Ошибочный перевод',
        toCashRegisterId: first.id,
      }),
    ).rejects.toThrow('Выберите разные кассы');
    expect(await database.cashTransaction.count()).toBe(2);
  });

  it('validates payroll rules, prevents overlaps, calculates attendance and locks approval', async () => {
    const { branch, coach, first, group } = await coachFoundation();
    const now = new Date();
    await management.createPayrollRule(ownerToken, {
      amountPerAttendee: 2_000,
      branchId: branch.id,
      coachId: coach.id,
      fixedAmount: 10_000,
      groupId: group.id,
      isActive: true,
      type: 'COMBINED',
      validFrom: dateOnly(new Date(now.getTime() - DAY)),
    });
    await expect(
      management.createPayrollRule(ownerToken, {
        branchId: branch.id,
        coachId: coach.id,
        fixedAmount: 12_000,
        groupId: group.id,
        isActive: true,
        type: 'FIXED_PER_LESSON',
        validFrom: dateOnly(now),
      }),
    ).rejects.toThrow('уже действует правило');
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мила',
      lastName: 'Петрова',
      status: 'ACTIVE',
    });
    const lesson = await database.lesson.create({
      data: {
        branchId: branch.id,
        coachId: coach.id,
        endsAt: new Date(now.getTime() + 60 * 60_000),
        groupId: group.id,
        startsAt: now,
        status: 'COMPLETED',
      },
    });
    await database.attendance.create({
      data: {
        lessonId: lesson.id,
        markedAt: now,
        markedByUserId: ownerId,
        status: 'PRESENT',
        studentId: student.id,
      },
    });
    await database.lesson.update({
      data: { attendanceCompletedAt: now },
      where: { id: lesson.id },
    });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: dateOnly(new Date(now.getTime() - DAY)),
      dateTo: dateOnly(new Date(now.getTime() + DAY)),
    });
    const calculated = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(calculated.accruals).toHaveLength(1);
    expect(calculated.accruals[0]).toMatchObject({
      attendeeCount: 1,
      calculatedAmount: 12_000,
      finalAmount: 12_000,
    });
    expect((await management.approvePayrollPeriod(ownerToken, period.id)).status).toBe('APPROVED');
    await expect(management.calculatePayrollPeriod(ownerToken, period.id)).rejects.toThrow(
      'Утверждённый расчёт нельзя изменить',
    );
    const paid = await management.payPayrollPeriod(ownerToken, period.id, {
      cashRegisterId: first.id,
      occurredAt: new Date().toISOString(),
    });
    expect(paid.status).toBe('PAID');
    expect(await database.expense.count({ where: { status: 'CONFIRMED' } })).toBe(1);
    expect(await database.cashTransaction.count({ where: { sourceType: 'PAYROLL' } })).toBe(1);
  });

  it('recalculates open payroll from attendance scenarios and keeps approved snapshots immutable', async () => {
    const { branch, coach, group } = await coachFoundation();
    const now = new Date();
    await management.createPayrollRule(ownerToken, {
      amountPerAttendee: 2_000,
      branchId: branch.id,
      coachId: coach.id,
      groupId: group.id,
      isActive: true,
      type: 'PER_ATTENDEE',
      validFrom: dateOnly(new Date(now.getTime() - DAY)),
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мила',
      lastName: 'Сценарная',
      status: 'ACTIVE',
    });
    const lesson = await database.lesson.create({
      data: {
        attendanceCompletedAt: now,
        branchId: branch.id,
        coachId: coach.id,
        endsAt: new Date(now.getTime() + 3_600_000),
        groupId: group.id,
        startsAt: now,
        status: 'COMPLETED',
      },
    });
    await database.attendance.create({
      data: {
        lessonId: lesson.id,
        markedAt: now,
        markedByUserId: ownerId,
        status: 'ABSENT',
        studentId: student.id,
      },
    });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: dateOnly(new Date(now.getTime() - DAY)),
      dateTo: dateOnly(new Date(now.getTime() + DAY)),
      trainerId: coach.id,
    });
    expect(
      (await management.calculatePayrollPeriod(ownerToken, period.id)).accruals[0],
    ).toMatchObject({
      attendeeCount: 0,
      finalAmount: 0,
    });
    await attendanceScenarios.update(ownerToken, 'ABSENT', {
      deductSubscription: true,
      includeInTrainerPayroll: true,
    });
    await expect(management.approvePayrollPeriod(ownerToken, period.id)).rejects.toThrow(
      'Расчёт устарел',
    );
    const recalculated = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(recalculated.accruals[0]).toMatchObject({ attendeeCount: 1, finalAmount: 2_000 });
    await management.approvePayrollPeriod(ownerToken, period.id);
    await attendanceScenarios.update(ownerToken, 'ABSENT', {
      deductSubscription: true,
      includeInTrainerPayroll: false,
    });
    expect((await management.getPayrollPeriod(ownerToken, period.id)).accruals[0]).toMatchObject({
      attendeeCount: 1,
      finalAmount: 2_000,
    });
  });

  it('previews and idempotently reconciles historical subscription effects', async () => {
    const { branch, coach, group } = await coachFoundation();
    const lessonDate = new Date();
    lessonDate.setHours(10, 0, 0, 0);
    const students = await Promise.all(
      [
        ['Анна', 'Отсутствующая'],
        ['Ирина', 'Болевшая'],
        ['Полина', 'Присутствующая'],
      ].map(([firstName, lastName]) =>
        application.createStudent(ownerToken, {
          branchId: branch.id,
          firstName: firstName ?? '',
          lastName: lastName ?? '',
          status: 'ACTIVE',
        }),
      ),
    );
    for (const student of students)
      await studio.addEnrollment(ownerToken, group.id, {
        joinedAt: dateOnly(new Date(lessonDate.getTime() - DAY)),
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: student.id,
      });
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 10,
      name: 'Исторические посещения',
      price: 30_000,
      type: 'LESSON_PACK',
      validityDays: 60,
    });
    for (const student of students)
      await finance.createSubscription(ownerToken, {
        initialPayment: {
          amount: 30_000,
          paidAt: new Date(lessonDate.getTime() - DAY).toISOString(),
          paymentMethod: 'CARD',
        },
        salePrice: 30_000,
        startsAt: dateOnly(new Date(lessonDate.getTime() - DAY)),
        studentId: student.id,
        tariffId: tariff.id,
      });
    await attendanceScenarios.update(ownerToken, 'ABSENT', {
      deductSubscription: false,
      includeInTrainerPayroll: false,
    });
    await attendanceScenarios.update(ownerToken, 'ILL', {
      deductSubscription: true,
      includeInTrainerPayroll: false,
    });
    const lesson = await studio.createLesson(ownerToken, {
      coachId: coach.id,
      endsAt: new Date(lessonDate.getTime() + 3_600_000).toISOString(),
      groupId: group.id,
      startsAt: lessonDate.toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'ABSENT', studentId: students[0]?.id ?? '' },
      { status: 'EXCUSED', studentId: students[1]?.id ?? '' },
      { status: 'PRESENT', studentId: students[2]?.id ?? '' },
    ]);
    await database.lesson.update({
      data: { attendanceCompletedAt: lessonDate, status: 'COMPLETED' },
      where: { id: lesson.id },
    });
    await attendanceScenarios.update(ownerToken, 'ABSENT', {
      deductSubscription: true,
      includeInTrainerPayroll: false,
    });
    await attendanceScenarios.update(ownerToken, 'ILL', {
      deductSubscription: false,
      includeInTrainerPayroll: false,
    });

    const filters = {
      branchId: branch.id,
      dateFrom: inputDateForTest(lessonDate),
      dateTo: inputDateForTest(lessonDate),
      groupId: group.id,
    };
    const preview = await attendanceScenarioReconciliation.preview(ownerToken, filters);
    expect(preview.rows).toHaveLength(2);
    expect(preview.totals).toMatchObject({
      actionableRows: 2,
      visitsToDeduct: 1,
      visitsToRestore: 1,
    });
    expect(preview.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentSubscriptionEffect: 'NOT_DEDUCTED',
          newSubscriptionEffect: 'DEDUCTED',
          status: 'ABSENT',
        }),
        expect.objectContaining({
          currentSubscriptionEffect: 'DEDUCTED',
          newSubscriptionEffect: 'NOT_DEDUCTED',
          status: 'ILL',
        }),
      ]),
    );
    const result = await attendanceScenarioReconciliation.apply(ownerToken, {
      filters,
      previewFingerprint: preview.fingerprint,
    });
    expect(result).toMatchObject({
      deductedVisits: 1,
      processedAttendanceCount: 2,
      restoredVisits: 1,
    });
    const ledgerCount = await database.subscriptionLedger.count();
    const auditCount = await database.auditLog.count({
      where: { action: 'ATTENDANCE_SCENARIO_RECONCILIATION_APPLIED' },
    });
    const repeatedPreview = await attendanceScenarioReconciliation.preview(ownerToken, filters);
    expect(repeatedPreview.rows).toEqual([]);
    expect(repeatedPreview.totals.actionableRows).toBe(0);
    await expect(
      attendanceScenarioReconciliation.apply(ownerToken, {
        filters,
        previewFingerprint: repeatedPreview.fingerprint,
      }),
    ).rejects.toThrow('Нет изменений');
    expect(await database.subscriptionLedger.count()).toBe(ledgerCount);
    expect(
      await database.auditLog.count({
        where: { action: 'ATTENDANCE_SCENARIO_RECONCILIATION_APPLIED' },
      }),
    ).toBe(auditCount);

    await closeDatabase(database);
    database = createDatabaseClient(toSqliteUrl(join(directory, 'management.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    attendanceScenarioReconciliation = new AttendanceScenarioReconciliationService(
      database,
      application,
    );
    expect(
      (await attendanceScenarioReconciliation.preview(ownerToken, filters)).totals.actionableRows,
    ).toBe(0);
  });

  it('invalidates only calculated payroll and protects approved and paid snapshots', async () => {
    const { branch, coach, first, group } = await coachFoundation();
    await management.createPayrollRule(ownerToken, {
      amountPerAttendee: 2_000,
      branchId: branch.id,
      coachId: coach.id,
      groupId: group.id,
      isActive: true,
      type: 'PER_ATTENDEE',
      validFrom: dateOnly(new Date(Date.now() - 5 * DAY)),
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мария',
      lastName: 'Payroll-Сценарная',
      status: 'ACTIVE',
    });
    await attendanceScenarios.update(ownerToken, 'ABSENT', {
      deductSubscription: true,
      includeInTrainerPayroll: true,
    });
    const lessons = [];
    for (const daysAgo of [3, 2, 1]) {
      const startsAt = new Date(Date.now() - daysAgo * DAY);
      startsAt.setHours(12, 0, 0, 0);
      const lesson = await database.lesson.create({
        data: {
          attendanceCompletedAt: startsAt,
          branchId: branch.id,
          coachId: coach.id,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
          groupId: group.id,
          startsAt,
          status: 'COMPLETED',
        },
      });
      await database.attendance.create({
        data: {
          lessonId: lesson.id,
          markedAt: startsAt,
          markedByUserId: ownerId,
          status: 'ABSENT',
          studentId: student.id,
        },
      });
      lessons.push(lesson);
    }
    const periods = [];
    for (const lesson of lessons) {
      const period = await management.createPayrollPeriod(ownerToken, {
        branchId: branch.id,
        dateFrom: inputDateForTest(lesson.startsAt),
        dateTo: inputDateForTest(lesson.startsAt),
        trainerId: coach.id,
      });
      periods.push(await management.calculatePayrollPeriod(ownerToken, period.id));
    }
    const approved = await management.approvePayrollPeriod(ownerToken, periods[1]?.id ?? '');
    await management.approvePayrollPeriod(ownerToken, periods[2]?.id ?? '');
    const paid = await management.payPayrollPeriod(ownerToken, periods[2]?.id ?? '', {
      cashRegisterId: first.id,
      occurredAt: new Date().toISOString(),
    });
    const approvedAmount = approved.totalAmount;
    const paidAmount = paid.totalAmount;
    await attendanceScenarios.update(ownerToken, 'ABSENT', {
      deductSubscription: true,
      includeInTrainerPayroll: false,
    });

    const filters = {
      dateFrom: inputDateForTest(lessons[0]?.startsAt ?? new Date()),
      dateTo: inputDateForTest(lessons[2]?.startsAt ?? new Date()),
      status: 'ABSENT' as const,
    };
    const preview = await attendanceScenarioReconciliation.preview(ownerToken, filters);
    expect(preview.totals).toMatchObject({
      actionableRows: 1,
      payrollPeriodsToRecalculate: 1,
      payrollRowsToExclude: 3,
      skippedProtectedRows: 2,
    });
    const result = await attendanceScenarioReconciliation.apply(ownerToken, {
      filters,
      previewFingerprint: preview.fingerprint,
    });
    expect(result).toMatchObject({
      payrollPeriodsInvalidated: 1,
      processedAttendanceCount: 1,
      protectedRowsSkipped: 2,
    });
    const calculatedPeriodId = periods[0]?.id;
    if (!calculatedPeriodId) throw new Error('Открытый расчёт не создан.');
    expect(
      await database.payrollPeriod.findUnique({ where: { id: calculatedPeriodId } }),
    ).toMatchObject({ status: 'DRAFT' });
    expect(
      await database.payrollAccrual.count({ where: { payrollPeriodId: calculatedPeriodId } }),
    ).toBe(0);
    expect(await management.getPayrollPeriod(ownerToken, approved.id)).toMatchObject({
      status: 'APPROVED',
      totalAmount: approvedAmount,
    });
    expect(await management.getPayrollPeriod(ownerToken, paid.id)).toMatchObject({
      status: 'PAID',
      totalAmount: paidAmount,
    });
    expect(await database.attendance.count({ where: { studentId: student.id } })).toBe(3);
    const repeated = await attendanceScenarioReconciliation.preview(ownerToken, filters);
    expect(repeated.totals.actionableRows).toBe(0);
    expect(repeated.totals.skippedProtectedRows).toBe(2);
  });

  it('allocates net subscription revenue once and excludes refunds from percent payroll', async () => {
    const { branch, coach, group } = await coachFoundation();
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Ирина',
      lastName: 'Соколова',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, group.id, {
      joinedAt: dateOnly(new Date(Date.now() - DAY)),
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 4,
      name: 'Четыре занятия',
      price: 40_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const subscription = await finance.createSubscription(ownerToken, {
      initialPayment: {
        amount: 40_000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CARD',
      },
      salePrice: 40_000,
      startsAt: dateOnly(new Date(Date.now() - DAY)),
      studentId: student.id,
      tariffId: tariff.id,
    });
    const payment = subscription.payments[0];
    if (!payment) throw new Error('Тестовый платёж не создан.');
    await finance.createRefund(ownerToken, payment.id, {
      amount: 8_000,
      reason: 'Частичный возврат для проверки базы',
      refundedAt: new Date().toISOString(),
    });
    const lesson = await studio.createLesson(ownerToken, {
      coachId: coach.id,
      endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      groupId: group.id,
      startsAt: new Date().toISOString(),
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);
    await database.lesson.update({ data: { status: 'COMPLETED' }, where: { id: lesson.id } });
    await management.createPayrollRule(ownerToken, {
      branchId: branch.id,
      coachId: coach.id,
      groupId: group.id,
      isActive: true,
      percent: 10,
      type: 'PERCENT_OF_REVENUE',
      validFrom: dateOnly(new Date(Date.now() - DAY)),
    });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: dateOnly(new Date(Date.now() - DAY)),
      dateTo: dateOnly(new Date(Date.now() + DAY)),
    });
    const calculated = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(calculated.accruals[0]).toMatchObject({ calculatedAmount: 800, revenueBase: 8_000 });
  });

  it('uses distinct category policies for each trainer, canonical trial, and actual substitute', async () => {
    const { branch, coach: trainerA, group } = await coachFoundation();
    const trainerB = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'trainer-b-payout@arava.local',
      fullName: 'Тренер Б',
      password: 'Trainer!B2026',
      role: 'COACH',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Катя',
      lastName: 'Тестова',
      status: 'ACTIVE',
    });
    const now = new Date();
    const effectiveFrom = dateOnly(new Date(now.getTime() - DAY));
    await management.saveTrainerPayoutProfile(ownerToken, {
      effectiveFrom,
      rules: payoutRules({
        REGULAR_ATTENDANCE: { amount: 1_000, mode: 'FIXED_PER_ATTENDANCE' },
        SUBSTITUTION: null,
        TRIAL: { mode: 'NO_PAYOUT' },
      }),
      trainerId: trainerA.id,
    });
    await management.saveTrainerPayoutProfile(ownerToken, {
      effectiveFrom,
      rules: payoutRules({
        REGULAR_ATTENDANCE: { amount: 2_000, mode: 'FIXED_PER_ATTENDANCE' },
        SUBSTITUTION: { amount: 5_000, mode: 'FIXED_PER_LESSON' },
        TRIAL: { amount: 3_000, mode: 'FIXED_PER_ATTENDANCE' },
      }),
      trainerId: trainerB.id,
    });
    const createCompleted = async (
      trainerId: string,
      offsetHours: number,
      status: 'PRESENT' | 'TRIAL',
    ) => {
      const startsAt = new Date(now.getTime() + offsetHours * 60 * 60_000);
      const lesson = await database.lesson.create({
        data: {
          attendanceCompletedAt: startsAt,
          branchId: branch.id,
          coachId: trainerId,
          endsAt: new Date(startsAt.getTime() + 60 * 60_000),
          groupId: group.id,
          startsAt,
          status: 'COMPLETED',
        },
      });
      await database.attendance.create({
        data: {
          lessonId: lesson.id,
          markedAt: startsAt,
          markedByUserId: ownerId,
          status,
          studentId: student.id,
        },
      });
      return lesson;
    };
    await createCompleted(trainerA.id, 0, 'PRESENT');
    await createCompleted(trainerB.id, 2, 'PRESENT');
    await createCompleted(trainerA.id, 4, 'TRIAL');
    await createCompleted(trainerB.id, 6, 'TRIAL');
    const substituted = await createCompleted(trainerB.id, 8, 'PRESENT');
    await database.trainerSubstitution.create({
      data: {
        createdByUserId: ownerId,
        lessonId: substituted.id,
        originalTrainerId: trainerA.id,
        substituteTrainerId: trainerB.id,
      },
    });
    await database.lesson.update({
      data: { coachId: trainerA.id },
      where: { id: substituted.id },
    });
    const fallbackSubstitution = await createCompleted(trainerA.id, 10, 'PRESENT');
    await database.trainerSubstitution.create({
      data: {
        createdByUserId: ownerId,
        lessonId: fallbackSubstitution.id,
        originalTrainerId: trainerB.id,
        substituteTrainerId: trainerA.id,
      },
    });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: dateOnly(new Date(now.getTime() - DAY)),
      dateTo: dateOnly(new Date(now.getTime() + DAY)),
    });
    const calculated = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(
      calculated.accruals.map(({ calculatedAmount, coachId, payoutCategory }) => ({
        calculatedAmount,
        coachId,
        payoutCategory,
      })),
    ).toEqual(
      expect.arrayContaining([
        { calculatedAmount: 1_000, coachId: trainerA.id, payoutCategory: 'REGULAR_ATTENDANCE' },
        { calculatedAmount: 2_000, coachId: trainerB.id, payoutCategory: 'REGULAR_ATTENDANCE' },
        { calculatedAmount: 0, coachId: trainerA.id, payoutCategory: 'TRIAL' },
        { calculatedAmount: 3_000, coachId: trainerB.id, payoutCategory: 'TRIAL' },
        { calculatedAmount: 5_000, coachId: trainerB.id, payoutCategory: 'SUBSTITUTION' },
      ]),
    );
    expect(
      calculated.accruals.filter(
        ({ coachId, payoutCategory }) =>
          coachId === trainerA.id && payoutCategory === 'REGULAR_ATTENDANCE',
      ),
    ).toHaveLength(2);
  });

  it('uses percentage revenue and effective-from history without rewriting approved accruals', async () => {
    const { branch, coach, group } = await coachFoundation();
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Илья',
      lastName: 'Процентный',
      status: 'ACTIVE',
    });
    const now = new Date();
    await management.saveTrainerPayoutProfile(ownerToken, {
      effectiveFrom: dateOnly(new Date(now.getTime() - DAY)),
      rules: payoutRules({
        REGULAR_ATTENDANCE: { amount: 1_000, mode: 'FIXED_PER_ATTENDANCE' },
        SINGLE_VISIT: { mode: 'PERCENTAGE', percentage: 12.5 },
      }),
      trainerId: coach.id,
    });
    await management.saveTrainerPayoutProfile(ownerToken, {
      effectiveFrom: dateOnly(new Date(now.getTime() + DAY)),
      rules: payoutRules({
        REGULAR_ATTENDANCE: { amount: 2_000, mode: 'FIXED_PER_ATTENDANCE' },
        SINGLE_VISIT: { mode: 'PERCENTAGE', percentage: 20 },
      }),
      trainerId: coach.id,
    });
    const lesson = await database.lesson.create({
      data: {
        attendanceCompletedAt: now,
        branchId: branch.id,
        coachId: coach.id,
        endsAt: new Date(now.getTime() + 60 * 60_000),
        groupId: group.id,
        startsAt: now,
        status: 'COMPLETED',
      },
    });
    const payment = await database.payment.create({
      data: {
        amount: 10_000,
        attendanceLessonId: lesson.id,
        branchId: branch.id,
        createdByUserId: ownerId,
        paidAt: now,
        paymentMethod: 'CASH',
        studentId: student.id,
      },
    });
    await database.attendance.create({
      data: {
        directPaymentId: payment.id,
        lessonId: lesson.id,
        markedAt: now,
        markedByUserId: ownerId,
        status: 'PRESENT',
        studentId: student.id,
      },
    });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: dateOnly(new Date(now.getTime() - DAY)),
      dateTo: dateOnly(now),
    });
    const calculated = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(calculated.accruals[0]).toMatchObject({
      calculatedAmount: 1_250,
      payoutCategory: 'SINGLE_VISIT',
      payoutMode: 'PERCENTAGE',
      payoutPercentage: 12.5,
      revenueBase: 10_000,
    });
    await management.approvePayrollPeriod(ownerToken, period.id);
    await management.saveTrainerPayoutProfile(ownerToken, {
      effectiveFrom: dateOnly(new Date(now.getTime() - DAY)),
      rules: payoutRules({ SINGLE_VISIT: { mode: 'PERCENTAGE', percentage: 50 } }),
      trainerId: coach.id,
    });
    expect((await management.getPayrollPeriod(ownerToken, period.id)).accruals[0]).toMatchObject({
      calculatedAmount: 1_250,
      payoutPercentage: 12.5,
    });
  });

  it('shows unset policies explicitly and restricts editing to OWNER', async () => {
    const { branch, coach, group } = await coachFoundation();
    const admin = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'payout-admin@arava.local',
      fullName: 'Администратор выплат',
      password: 'Admin!Payout2026',
      role: 'ADMIN',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Payout2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Payout2026',
      newPassword: 'Admin!PayoutChanged2026',
    });
    const input: TrainerPayoutProfileInput = {
      effectiveFrom: dateOnly(new Date(Date.now() - DAY)),
      rules: payoutRules({ REGULAR_ATTENDANCE: null }),
      trainerId: coach.id,
    };
    await expect(management.saveTrainerPayoutProfile(adminSession.token, input)).rejects.toThrow(
      'только владелец',
    );
    await management.saveTrainerPayoutProfile(ownerToken, input);
    const adminProfile = await management.getTrainerPayoutProfile(adminSession.token, coach.id);
    expect(adminProfile.canEdit).toBe(false);
    expect(adminProfile.categories.some(({ category }) => category === 'REGULAR_ATTENDANCE')).toBe(
      true,
    );
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Без',
      lastName: 'Ставки',
      status: 'ACTIVE',
    });
    const now = new Date();
    const lesson = await database.lesson.create({
      data: {
        attendanceCompletedAt: now,
        branchId: branch.id,
        coachId: coach.id,
        endsAt: new Date(now.getTime() + 60 * 60_000),
        groupId: group.id,
        startsAt: now,
        status: 'COMPLETED',
      },
    });
    await database.attendance.create({
      data: {
        lessonId: lesson.id,
        markedAt: now,
        markedByUserId: ownerId,
        status: 'PRESENT',
        studentId: student.id,
      },
    });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: dateOnly(new Date(now.getTime() - DAY)),
      dateTo: dateOnly(new Date(now.getTime() + DAY)),
    });
    const calculated = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(calculated).toMatchObject({ unconfiguredPayoutCount: 1 });
    expect(calculated.accruals[0]).toMatchObject({
      calculatedAmount: 0,
      payoutCategory: 'REGULAR_ATTENDANCE',
      payoutMode: undefined,
    });
    await expect(management.approvePayrollPeriod(ownerToken, period.id)).rejects.toThrow(
      'не настроены',
    );
  });

  it('resolves WeeklySchedule-only payroll pending, falls back to group coach, and pays past LATE attendance', async () => {
    const { branch, coach, group } = await coachFoundation();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    const weekday = yesterday.getDay() === 0 ? 7 : yesterday.getDay();
    const day = inputDateForTest(yesterday);
    await management.saveTrainerPayoutProfile(ownerToken, {
      effectiveFrom: day,
      rules: payoutRules({
        REGULAR_ATTENDANCE: { amount: 4_000, mode: 'FIXED_PER_LESSON' },
      }),
      trainerId: coach.id,
    });
    await studio.createSchedule(ownerToken, {
      branchId: branch.id,
      endTime: '11:00',
      groupId: group.id,
      isActive: true,
      startTime: '10:00',
      validFrom: day,
      weekday,
    });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: day,
      dateTo: day,
    });
    const pending = (await management.getPayrollPeriod(ownerToken, period.id)).pendingAttendance;
    expect(pending).toEqual([expect.objectContaining({ coachId: coach.id, groupId: group.id })]);
    expect(pending[0]?.lessonId).toBeUndefined();
    const virtualOnly = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(virtualOnly.accruals).toEqual([]);
    expect(virtualOnly.pendingAttendance).toHaveLength(1);
    const lesson = await studio.materializeLessonOccurrence(ownerToken, {
      groupId: group.id,
      startsAt: pending[0]?.startsAt ?? '',
    });
    expect(lesson.coachId).toBe(coach.id);
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Опоздавший',
      lastName: 'Ученик',
      status: 'ACTIVE',
    });
    await database.attendance.create({
      data: {
        lessonId: lesson.id,
        markedAt: new Date(),
        markedByUserId: ownerId,
        status: 'LATE',
        studentId: student.id,
      },
    });
    await database.lesson.update({
      data: { attendanceCompletedAt: new Date(), status: 'PLANNED' },
      where: { id: lesson.id },
    });
    const calculated = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(calculated.pendingAttendance).toEqual([]);
    expect(calculated.accruals).toEqual([
      expect.objectContaining({
        attendeeCount: 1,
        calculatedAmount: 4_000,
        coachId: coach.id,
        lessonId: lesson.id,
      }),
    ]);
  });

  it('uses legacy rules before the first payout-profile effective date and blocks stale approval', async () => {
    const { branch, coach, group } = await coachFoundation();
    const lessonDate = new Date();
    lessonDate.setDate(lessonDate.getDate() - 2);
    lessonDate.setHours(18, 0, 0, 0);
    const future = new Date();
    future.setDate(future.getDate() + 2);
    await management.createPayrollRule(ownerToken, {
      amountPerAttendee: 1_500,
      branchId: branch.id,
      coachId: coach.id,
      groupId: group.id,
      isActive: true,
      type: 'PER_ATTENDEE',
      validFrom: inputDateForTest(new Date(lessonDate.getTime() - DAY)),
    });
    await management.saveTrainerPayoutProfile(ownerToken, {
      effectiveFrom: inputDateForTest(future),
      rules: payoutRules({
        REGULAR_ATTENDANCE: { amount: 9_000, mode: 'FIXED_PER_ATTENDANCE' },
      }),
      trainerId: coach.id,
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Исторический',
      lastName: 'Ученик',
      status: 'ACTIVE',
    });
    const lesson = await database.lesson.create({
      data: {
        attendanceCompletedAt: lessonDate,
        branchId: branch.id,
        coachId: coach.id,
        endsAt: new Date(lessonDate.getTime() + 60 * 60_000),
        groupId: group.id,
        startsAt: lessonDate,
        status: 'COMPLETED',
      },
    });
    await database.attendance.create({
      data: {
        lessonId: lesson.id,
        markedAt: lessonDate,
        markedByUserId: ownerId,
        status: 'PRESENT',
        studentId: student.id,
      },
    });
    const day = inputDateForTest(lessonDate);
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: day,
      dateTo: day,
    });
    expect(await management.calculatePayrollPeriod(ownerToken, period.id)).toMatchObject({
      totalAmount: 1_500,
    });
    await database.attendance.update({
      data: { status: 'ABSENT' },
      where: {
        lessonId_studentId: { lessonId: lesson.id, studentId: student.id },
      },
    });
    await expect(management.approvePayrollPeriod(ownerToken, period.id)).rejects.toThrow(
      'Расчёт устарел',
    );
    expect((await management.calculatePayrollPeriod(ownerToken, period.id)).totalAmount).toBe(0);
    expect((await management.approvePayrollPeriod(ownerToken, period.id)).status).toBe('APPROVED');
  });

  it('keeps payroll period dates local and returns accruals from intersecting periods', async () => {
    const { branch, coach, group } = await coachFoundation();
    const localStart = new Date();
    localStart.setDate(localStart.getDate() - 3);
    localStart.setHours(0, 30, 0, 0);
    const day = inputDateForTest(localStart);
    await management.createPayrollRule(ownerToken, {
      branchId: branch.id,
      coachId: coach.id,
      fixedAmount: 2_500,
      groupId: group.id,
      isActive: true,
      type: 'FIXED_PER_LESSON',
      validFrom: day,
    });
    const lesson = await database.lesson.create({
      data: {
        attendanceCompletedAt: localStart,
        branchId: branch.id,
        coachId: coach.id,
        endsAt: new Date(localStart.getTime() + 60 * 60_000),
        groupId: group.id,
        startsAt: localStart,
        status: 'COMPLETED',
      },
    });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: day,
      dateTo: day,
    });
    expect(period).toMatchObject({ dateFrom: day, dateTo: day });
    await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(await management.coachPayroll(ownerToken, day, day)).toEqual([
      expect.objectContaining({ coachId: coach.id, lessonId: lesson.id }),
    ]);
  });

  it('deletes a legacy calculated period without deleting its lessons or attendance', async () => {
    const { branch, coach, group } = await coachFoundation();
    const day = inputDateForTest(new Date());
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Сохранённый',
      lastName: 'Источник',
      status: 'ACTIVE',
    });
    await management.createPayrollRule(ownerToken, {
      branchId: branch.id,
      coachId: coach.id,
      fixedAmount: 2_500,
      groupId: group.id,
      isActive: true,
      type: 'FIXED_PER_LESSON',
      validFrom: day,
    });
    const startsAt = new Date();
    const lesson = await database.lesson.create({
      data: {
        attendanceCompletedAt: startsAt,
        branchId: branch.id,
        coachId: coach.id,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        groupId: group.id,
        startsAt,
        status: 'COMPLETED',
      },
    });
    await database.attendance.create({
      data: {
        lessonId: lesson.id,
        markedAt: startsAt,
        markedByUserId: ownerId,
        status: 'PRESENT',
        studentId: student.id,
      },
    });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: day,
      dateTo: day,
    });
    await management.calculatePayrollPeriod(ownerToken, period.id);
    expect((await management.getPayrollPeriod(ownerToken, period.id)).accruals).toHaveLength(1);

    await expect(management.deletePayrollPeriod(ownerToken, period.id)).resolves.toMatchObject({
      deletedAccrualCount: 1,
      status: 'DELETED',
    });
    expect(await database.payrollPeriod.findUnique({ where: { id: period.id } })).toBeNull();
    expect(await database.payrollAccrual.count({ where: { payrollPeriodId: period.id } })).toBe(0);
    expect(await database.lesson.findUnique({ where: { id: lesson.id } })).not.toBeNull();
    expect(await database.attendance.count({ where: { lessonId: lesson.id } })).toBe(1);
  });

  it('enforces branch and role permissions and exports UTF-8 Russian CSV', async () => {
    const { branch } = await branchAndRegisters();
    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'manager@arava.local',
      fullName: 'Руководитель',
      password: 'Manager!Secure2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach@arava.local',
      fullName: 'Тренер',
      password: 'Coach!Secure2026',
      role: 'COACH',
    });
    const managerSession = await application.login({
      email: 'manager@arava.local',
      password: 'Manager!Secure2026',
    });
    await application.changePassword(managerSession.token, {
      currentPassword: 'Manager!Secure2026',
      newPassword: 'Manager!Changed2026',
    });
    const coachSession = await application.login({
      email: 'coach@arava.local',
      password: 'Coach!Secure2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Secure2026',
      newPassword: 'Coach!Changed2026',
    });
    await expect(
      management.listExpenses(coachSession.token, {
        dateFrom: new Date(0).toISOString(),
        dateTo: new Date().toISOString(),
      }),
    ).rejects.toThrow();
    const period = await management.createPayrollPeriod(managerSession.token, {
      branchId: branch.id,
      dateFrom: dateOnly(new Date()),
      dateTo: dateOnly(new Date()),
    });
    await expect(
      management.approvePayrollPeriod(managerSession.token, period.id),
    ).rejects.toThrow();
    const csv = await management.exportReportCsv(ownerToken, {
      branchId: branch.id,
      dateFrom: new Date(0).toISOString(),
      dateTo: new Date().toISOString(),
      kind: 'CASH_FLOW',
    });
    expect(csv.content.startsWith('\uFEFFДата;Филиал;Касса')).toBe(true);
    expect(csv.filename).toMatch(/движение-денежных-средств/u);
  });
});
