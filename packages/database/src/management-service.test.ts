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

const DAY = 86_400_000;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

describe('Sprint 4 management service', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let finance: FinanceService;
  let management: ManagementService;
  let ownerId: string;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-management-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'management.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    finance = new FinanceService(database, application);
    management = new ManagementService(database, application);
    studio = new StudioService(database, application);
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
