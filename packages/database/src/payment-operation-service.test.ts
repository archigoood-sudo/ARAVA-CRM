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
import { hashPassword } from './security';
import { ApplicationService } from './services';

describe('Sprint 4.6A payment foundation', () => {
  let application: ApplicationService;
  let branchId: string;
  let database: DatabaseClient;
  let databasePath: string;
  let directory: string;
  let finance: FinanceService;
  let operations: PaymentOperationService;
  let ownerToken: string;
  let studentId: string;
  let subscriptionId: string;
  let tariffId: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-payment-foundation-'));
    databasePath = join(directory, 'payment.db');
    database = createDatabaseClient(toSqliteUrl(databasePath));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    finance = new FinanceService(database, application);
    operations = new PaymentOperationService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!PaymentFoundation2026',
    });
    const branch = await application.createBranch(ownerToken, {
      address: 'Москва',
      name: 'Платёжный филиал',
      phone: '+79990000000',
    });
    branchId = branch.id;
    const student = await application.createStudent(ownerToken, {
      branchId,
      firstName: 'Анна',
      lastName: 'Платёжная',
      status: 'ACTIVE',
    });
    studentId = student.id;
    const tariff = await finance.createTariff(ownerToken, {
      branchId,
      currency: 'RUB',
      isActive: true,
      lessonCount: 8,
      name: 'Платёжный тариф',
      price: 100_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    tariffId = tariff.id;
    const subscription = await finance.createSubscription(ownerToken, {
      salePrice: 100_000,
      startsAt: new Date().toISOString().slice(0, 10),
      studentId,
      tariffId: tariff.id,
    });
    subscriptionId = subscription.id;
    await database.syncOutbox.deleteMany();
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  function createInput(idempotencyKey = 'payment-operation-key-1') {
    return {
      amount: 25_000,
      branchId,
      currency: 'RUB' as const,
      idempotencyKey,
      providerType: 'SBP' as const,
      purpose: 'Оплата абонемента',
      studentId,
      subscriptionId,
    };
  }

  it('creates an operation without recognizing revenue and enforces idempotent creation', async () => {
    const created = await operations.create(ownerToken, createInput());
    expect(created).toMatchObject({
      amount: 25_000,
      currency: 'RUB',
      status: 'CREATED',
      studentId,
      subscriptionId,
    });
    expect(await database.payment.count()).toBe(0);
    expect(await database.cashTransaction.count()).toBe(0);
    expect((await operations.create(ownerToken, createInput())).id).toBe(created.id);
    await expect(
      operations.create(ownerToken, { ...createInput(), amount: 30_000 }),
    ).rejects.toThrow('Ключ операции уже использован');
  });

  it('reserves subscription debt across pending operations and releases it on cancellation', async () => {
    const reserved = await operations.create(ownerToken, {
      ...createInput('reserved-subscription-payment'),
      amount: 80_000,
    });
    await expect(
      operations.create(ownerToken, {
        ...createInput('overlapping-subscription-payment'),
        amount: 20_001,
      }),
    ).rejects.toThrow('превышает доступный остаток');
    await expect(
      finance.createPayment(ownerToken, {
        amount: 20_001,
        branchId,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
        studentId,
        subscriptionId,
      }),
    ).rejects.toThrow('превышает долг');
    await operations.cancel(ownerToken, reserved.id, 'Клиент выбрал другой способ оплаты');
    await expect(
      operations.create(ownerToken, {
        ...createInput('payment-after-release'),
        amount: 100_000,
      }),
    ).resolves.toMatchObject({ amount: 100_000, status: 'CREATED' });
  });

  it('enforces valid transitions and records failed, cancelled and expired terminal states', async () => {
    const waiting = await operations.create(ownerToken, createInput('waiting-operation'));
    await operations.transition(ownerToken, waiting.id, 'WAITING_FOR_PAYMENT', undefined, 'sbp-1');
    await operations.transition(ownerToken, waiting.id, 'PROCESSING');
    await expect(
      operations.transition(ownerToken, waiting.id, 'WAITING_FOR_PAYMENT'),
    ).rejects.toThrow('Переход операции оплаты недоступен');
    await operations.failTrusted(waiting.id, 'Провайдер отклонил оплату');
    await expect(operations.finalizeTrusted(waiting.id, { paymentMethod: 'SBP' })).rejects.toThrow(
      'не может быть завершена',
    );

    const cancelled = await operations.create(ownerToken, createInput('cancel-operation'));
    expect((await operations.cancel(ownerToken, cancelled.id, 'Отменено клиентом')).status).toBe(
      'CANCELLED',
    );
    const expired = await operations.create(ownerToken, createInput('expire-operation'));
    await operations.transition(ownerToken, expired.id, 'WAITING_FOR_PAYMENT');
    await operations.expireTrusted(expired.id);
    expect((await operations.get(ownerToken, expired.id)).status).toBe('EXPIRED');
  });

  it('finalizes transactionally once, links the subscription and updates debt', async () => {
    const operation = await operations.create(ownerToken, createInput('successful-operation'));
    await operations.transition(ownerToken, operation.id, 'WAITING_FOR_PAYMENT');
    const succeeded = await operations.finalizeTrusted(operation.id, {
      paymentMethod: 'SBP',
      providerOperationId: 'provider-sbp-1',
    });
    expect(succeeded).toMatchObject({ status: 'SUCCEEDED', providerOperationId: 'provider-sbp-1' });
    expect(await database.payment.count()).toBe(1);
    expect(await database.cashTransaction.count({ where: { sourceType: 'PAYMENT' } })).toBe(1);
    expect(succeeded.paymentId).not.toBeNull();
    const paymentId = succeeded.paymentId;
    if (!paymentId) throw new Error('Подтверждённая операция не связана с платежом.');
    const payment = await database.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(payment).toMatchObject({
      amount: 25_000,
      paymentMethod: 'SBP',
      studentId,
      subscriptionId,
    });
    expect((await finance.getSubscription(ownerToken, subscriptionId)).debt).toBe(75_000);
    await operations.finalizeTrusted(operation.id, { paymentMethod: 'SBP' });
    expect(await database.payment.count()).toBe(1);
    expect(
      await database.auditLog.count({
        where: { action: 'PAYMENT_OPERATION_DUPLICATE_COMPLETION_IGNORED' },
      }),
    ).toBe(1);
  });

  it('survives restart and retries successful completion without a duplicate payment', async () => {
    const operation = await operations.create(ownerToken, createInput('restart-operation'));
    await operations.transition(ownerToken, operation.id, 'WAITING_FOR_PAYMENT');
    await operations.finalizeTrusted(operation.id, { paymentMethod: 'ACQUIRING' });
    await closeDatabase(database);

    database = createDatabaseClient(toSqliteUrl(databasePath));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    operations = new PaymentOperationService(database, application);
    const restored = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: 'Owner!PaymentFoundation2026',
    });
    await operations.finalizeTrusted(operation.id, { paymentMethod: 'ACQUIRING' });
    expect((await operations.listStudent(restored.token, studentId))[0]).toMatchObject({
      id: operation.id,
      status: 'SUCCEEDED',
    });
    expect(await database.payment.count()).toBe(1);
  });

  it('persists a new subscription sale until trusted CARD success and finalizes it once', async () => {
    const subscriptionsBefore = await database.subscription.count();
    const operation = await operations.create(ownerToken, {
      amount: 100_000,
      branchId,
      currency: 'RUB',
      idempotencyKey: 'unified-card-sale-operation',
      providerType: 'ACQUIRING',
      purpose: 'Продажа абонемента',
      saleIntent: {
        expiresAt: '2026-09-24',
        salePrice: 100_000,
        startsAt: '2026-08-25',
        tariffId,
      },
      studentId,
    });
    expect(operation.saleIntent).toMatchObject({ salePrice: 100_000, tariffId });
    expect(await database.subscription.count()).toBe(subscriptionsBefore);
    expect(await database.payment.count()).toBe(0);

    await operations.transition(ownerToken, operation.id, 'WAITING_FOR_PAYMENT');
    const completed = await operations.finalizeTrusted(operation.id, {
      paymentMethod: 'ACQUIRING',
      providerOperationId: 'card-sale-provider-1',
      providerResultId: 'card-sale-result-1',
    });
    expect(completed.status).toBe('SUCCEEDED');
    expect(completed.subscriptionId).toBeTruthy();
    expect(await database.subscription.count()).toBe(subscriptionsBefore + 1);
    expect(await database.payment.count()).toBe(1);
    const sold = await finance.getSubscription(ownerToken, completed.subscriptionId ?? '');
    expect(sold).toMatchObject({ debt: 0, paymentStatus: 'PAID', salePrice: 100_000 });

    await operations.finalizeTrusted(operation.id, { paymentMethod: 'ACQUIRING' });
    expect(await database.subscription.count()).toBe(subscriptionsBefore + 1);
    expect(await database.payment.count()).toBe(1);
  });

  it('restores a pending sale after restart and completes the same Subscription once', async () => {
    const subscriptionsBefore = await database.subscription.count();
    const operation = await operations.create(ownerToken, {
      amount: 100_000,
      branchId,
      currency: 'RUB',
      idempotencyKey: 'unified-restart-sale-operation',
      providerType: 'SBP',
      purpose: 'Продажа после перезапуска',
      saleIntent: {
        salePrice: 100_000,
        startsAt: '2026-08-25',
        tariffId,
      },
      studentId,
    });
    await operations.transition(ownerToken, operation.id, 'WAITING_FOR_PAYMENT');
    await closeDatabase(database);

    database = createDatabaseClient(toSqliteUrl(databasePath));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    finance = new FinanceService(database, application);
    operations = new PaymentOperationService(database, application);
    const restored = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: 'Owner!PaymentFoundation2026',
    });
    const recoverable = await operations.listRecoverableSales(restored.token);
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0]).toMatchObject({ id: operation.id });
    expect(recoverable[0]?.saleIntent).toMatchObject({ tariffId });
    const completed = await operations.finalizeTrusted(operation.id, { paymentMethod: 'SBP' });
    await operations.finalizeTrusted(operation.id, { paymentMethod: 'SBP' });
    expect(await database.subscription.count()).toBe(subscriptionsBefore + 1);
    expect(await database.payment.count()).toBe(1);
    expect(
      (await finance.getSubscription(restored.token, completed.subscriptionId ?? '')).debt,
    ).toBe(0);
  });

  it('keeps failed sales without a subscription and preserves the tariff price snapshot', async () => {
    const subscriptionsBefore = await database.subscription.count();
    const failed = await operations.create(ownerToken, {
      amount: 25_000,
      branchId,
      currency: 'RUB',
      idempotencyKey: 'unified-failed-sale-operation',
      providerType: 'SBP',
      purpose: 'Частичная продажа абонемента',
      saleIntent: {
        salePrice: 100_000,
        startsAt: '2026-08-25',
        tariffId,
      },
      studentId,
    });
    await operations.transition(ownerToken, failed.id, 'WAITING_FOR_PAYMENT');
    await operations.failTrusted(failed.id, 'Провайдер отклонил оплату');
    expect(await database.subscription.count()).toBe(subscriptionsBefore);

    const cancelled = await operations.create(ownerToken, {
      ...createInput('unified-cancelled-sale-operation'),
      subscriptionId: undefined,
      saleIntent: {
        salePrice: 100_000,
        startsAt: '2026-08-25',
        tariffId,
      },
    });
    await operations.cancel(ownerToken, cancelled.id, 'Клиент отменил оплату');
    expect(await database.subscription.count()).toBe(subscriptionsBefore);

    const snapshot = await operations.create(ownerToken, {
      amount: 25_000,
      branchId,
      currency: 'RUB',
      idempotencyKey: 'unified-snapshot-sale-operation',
      providerType: 'SBP',
      purpose: 'Продажа по прежней цене',
      saleIntent: {
        salePrice: 100_000,
        startsAt: '2026-08-25',
        tariffId,
      },
      studentId,
    });
    await database.tariff.update({ data: { price: 120_000 }, where: { id: tariffId } });
    await operations.transition(ownerToken, snapshot.id, 'WAITING_FOR_PAYMENT');
    const completed = await operations.finalizeTrusted(snapshot.id, { paymentMethod: 'SBP' });
    expect(await finance.getSubscription(ownerToken, completed.subscriptionId ?? '')).toMatchObject(
      {
        debt: 75_000,
        paymentStatus: 'PARTIALLY_PAID',
        salePrice: 100_000,
      },
    );
  });

  it('records a recoverable finalization error without a Payment or Subscription', async () => {
    const subscriptionsBefore = await database.subscription.count();
    const operation = await operations.create(ownerToken, {
      amount: 100_000,
      branchId,
      currency: 'RUB',
      idempotencyKey: 'unified-recoverable-sale-operation',
      providerType: 'ACQUIRING',
      purpose: 'Продажа с восстановлением',
      saleIntent: {
        salePrice: 100_000,
        startsAt: '2026-08-25',
        tariffId,
      },
      studentId,
    });
    await operations.transition(ownerToken, operation.id, 'WAITING_FOR_PAYMENT');
    await database.$executeRawUnsafe(`
      CREATE TRIGGER "test_subscription_sale_failure"
      BEFORE INSERT ON "Subscription"
      BEGIN
        SELECT RAISE(ABORT, 'simulated subscription failure');
      END
    `);
    await expect(
      operations.finalizeTrusted(operation.id, { paymentMethod: 'ACQUIRING' }),
    ).rejects.toThrow();
    const recoverable = await operations.get(ownerToken, operation.id);
    expect(recoverable).toMatchObject({
      saleFinalizationAttempts: 1,
      status: 'WAITING_FOR_PAYMENT',
    });
    expect(recoverable.saleFinalizationError).toBeTruthy();
    expect(await database.subscription.count()).toBe(subscriptionsBefore);
    expect(await database.payment.count()).toBe(0);
  });

  it('rolls back the Payment and cash entry when final operation commit fails', async () => {
    const operation = await operations.create(ownerToken, createInput('rollback-operation'));
    await operations.transition(ownerToken, operation.id, 'WAITING_FOR_PAYMENT');
    await database.$executeRawUnsafe(`
      CREATE TRIGGER "test_payment_operation_failure"
      BEFORE UPDATE OF "status" ON "PaymentOperation"
      WHEN NEW."status" = 'SUCCEEDED'
      BEGIN
        SELECT RAISE(ABORT, 'simulated operation failure');
      END
    `);
    await expect(
      operations.finalizeTrusted(operation.id, { paymentMethod: 'ONLINE' }),
    ).rejects.toThrow();
    expect(await database.payment.count()).toBe(0);
    expect(await database.cashTransaction.count()).toBe(0);
    expect((await operations.get(ownerToken, operation.id)).status).toBe('WAITING_FOR_PAYMENT');
  });

  it('allows scoped ADMIN, denies COACH, stores integer money only and excludes sync/secrets', async () => {
    const password = 'Staff!PaymentFoundation2026';
    const admin = await database.user.create({
      data: {
        branchAssignments: { create: { branchId } },
        email: 'payment-admin@arava.local',
        fullName: 'Администратор оплаты',
        mustChangePassword: false,
        passwordHash: await hashPassword(password),
        role: 'ADMIN',
      },
    });
    const coach = await database.user.create({
      data: {
        branchAssignments: { create: { branchId } },
        email: 'payment-coach@arava.local',
        fullName: 'Тренер оплаты',
        mustChangePassword: false,
        passwordHash: await hashPassword(password),
        role: 'COACH',
      },
    });
    const adminSession = await application.login({ email: admin.email, password });
    const coachSession = await application.login({ email: coach.email, password });
    await database.syncOutbox.deleteMany();
    const created = await operations.create(adminSession.token, createInput('admin-operation'));
    await expect(
      operations.create(coachSession.token, createInput('coach-operation')),
    ).rejects.toThrow();
    await expect(operations.listStudent(coachSession.token, studentId)).rejects.toThrow();
    const recoverableSale = await operations.create(adminSession.token, {
      amount: 100_000,
      branchId,
      currency: 'RUB',
      idempotencyKey: 'admin-recoverable-sale-operation',
      providerType: 'SBP',
      purpose: 'Продажа администратора',
      saleIntent: {
        salePrice: 100_000,
        startsAt: '2026-08-25',
        tariffId,
      },
      studentId,
    });
    await operations.transition(adminSession.token, recoverableSale.id, 'WAITING_FOR_PAYMENT');
    expect(await operations.listRecoverableSales(adminSession.token)).toEqual([
      expect.objectContaining({ id: recoverableSale.id }),
    ]);
    await expect(operations.listRecoverableSales(coachSession.token)).rejects.toThrow();
    await expect(
      operations.create(ownerToken, { ...createInput('float-operation'), amount: 10.5 }),
    ).rejects.toThrow('корректную сумму');
    expect(await database.syncOutbox.count()).toBe(0);
    const keys = Object.keys(created).map((key) => key.toLowerCase());
    expect(keys).not.toEqual(
      expect.arrayContaining(['pan', 'cvv', 'token', 'secret', 'cardnumber']),
    );
    const columns = await database.$queryRawUnsafe<{ name: string }[]>(
      'PRAGMA table_info("PaymentOperation")',
    );
    expect(columns.map(({ name }) => name.toLowerCase())).not.toEqual(
      expect.arrayContaining(['pan', 'cvv', 'token', 'secret', 'cardnumber']),
    );
  });
});
