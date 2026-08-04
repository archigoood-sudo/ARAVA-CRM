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
import { ApplicationService } from './services';
import { StudioService } from './studio-service';

const DAY_MS = 86_400_000;
const dateString = (value: Date) => value.toISOString().slice(0, 10);

describe('Sprint 3 finance service', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let finance: FinanceService;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-finance-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'finance.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    finance = new FinanceService(database, application);
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
        amount: 30_000,
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

  it('tracks partial payments, debt, full and partial refunds without deleting history', async () => {
    const { branch, student, subscription } = await tariffAndSubscription();
    expect(subscription).toMatchObject({ debt: 70_000, paidAmount: 30_000, status: 'ACTIVE' });
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
    expect(await database.refund.count()).toBe(2);
    expect((await finance.getSubscription(ownerToken, subscription.id)).debt).toBe(70_000);
  });

  it('enforces freeze limits, extends expiry, and audits freeze lifecycle', async () => {
    const { subscription } = await tariffAndSubscription({ freezeDays: 5 });
    const originalExpiry = new Date(subscription.expiresAt ?? 0).getTime();
    const frozen = await finance.freezeSubscription(ownerToken, subscription.id, { days: 3 });
    expect(frozen.status).toBe('FROZEN');
    await expect(
      finance.freezeSubscription(ownerToken, subscription.id, { days: 1 }),
    ).rejects.toThrow(t('domain.validation.freezeActiveOnly'));
    const active = await finance.unfreezeSubscription(ownerToken, subscription.id);
    expect(active.status).toBe('ACTIVE');
    expect(active.frozenDaysUsed).toBe(1);
    expect(new Date(active.expiresAt ?? 0).getTime()).toBe(originalExpiry + DAY_MS);
    await expect(
      finance.freezeSubscription(ownerToken, subscription.id, { days: 5 }),
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
      salePrice: 75_000,
      startsAt,
      studentId: student.id,
      tariffId: tariff.id,
    });
    expect(subscription).toMatchObject({
      debt: 75_000,
      remainingLessons: 8,
      status: 'PENDING',
    });
    expect(new Date(subscription.expiresAt ?? 0).getTime()).toBe(
      new Date(`${startsAt}T00:00:00.000Z`).getTime() + 30 * DAY_MS,
    );
    expect((await finance.cancelSubscription(ownerToken, subscription.id)).status).toBe(
      'CANCELLED',
    );
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
      role: 'BRANCH_MANAGER',
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
      subscriptionId: subscription.id,
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
