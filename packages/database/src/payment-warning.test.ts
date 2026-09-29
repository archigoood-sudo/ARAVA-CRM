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
import { ApplicationService } from './services';
import { PaymentOperationService } from './payment-operation-service';
import { AttentionService } from './attention-service';
import { paymentWarningBlock } from './payment-warning';

describe('payment warning acknowledgement, not financial recovery', () => {
  let db: DatabaseClient;
  let app: ApplicationService;
  let service: PaymentOperationService;
  let dir: string;
  let token: string;
  let branchId: string;
  let studentId: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arava-warning-'));
    db = createDatabaseClient(toSqliteUrl(join(dir, 'test.db')));
    await initializeDatabase(db);
    app = new ApplicationService(db);
    service = new PaymentOperationService(db, app);
    token = (await app.login({ email: INITIAL_OWNER_EMAIL, password: INITIAL_OWNER_PASSWORD }))
      .token;
    await app.changePassword(token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Warning2026',
    });
    branchId = (await app.createBranch(token, { name: 'Warning test' })).id;
    studentId = (
      await app.createStudent(token, {
        branchId,
        firstName: 'PrivateName',
        lastName: 'PrivateSurname',
        status: 'ACTIVE',
      })
    ).id;
  });
  afterEach(async () => {
    await closeDatabase(db);
    await rm(dir, { force: true, recursive: true });
  });
  async function attempt(key: string) {
    const op = await service.create(token, {
      amount: 10000,
      branchId,
      currency: 'RUB',
      idempotencyKey: key,
      providerType: 'SBP',
      purpose: 'PRIVATE PURPOSE secret-token',
      studentId,
    });
    await service.transition(token, op.id, 'WAITING_FOR_PAYMENT');
    return op;
  }
  async function failed(key = 'failed') {
    const op = await attempt(key);
    await service.recordProviderOutcomeTrusted(op.id, 'FAILED');
    await service.failTrusted(op.id, 'PRIVATE REASON token=secret email@example.com');
    return op;
  }
  async function protectedState() {
    return JSON.stringify(
      await Promise.all([
        db.payment.findMany({ orderBy: { id: 'asc' } }),
        db.refund.findMany({ orderBy: { id: 'asc' } }),
        db.cashTransaction.findMany({ orderBy: { id: 'asc' } }),
        db.subscription.findMany({ orderBy: { id: 'asc' } }),
        db.subscriptionLedger.findMany({ orderBy: { id: 'asc' } }),
        db.attendance.findMany(),
        db.syncOutbox.findMany({ orderBy: { id: 'asc' } }),
        db.student.findMany({ orderBy: { id: 'asc' } }),
      ]),
    );
  }
  it('closes only Attention, preserves FAILED/history and the sole later successful Payment; repeated resolution is a no-op', async () => {
    const old = await failed();
    const later = await attempt('different-attempt-same-purchase-attributes');
    await service.finalizeTrusted(later.id, { paymentMethod: 'SBP' });
    const attention = new AttentionService(db, app);
    expect((await attention.listItems(token)).some((x) => x.entityId === old.id)).toBe(true);
    const before = await protectedState();
    const original = await db.paymentOperation.findUniqueOrThrow({ where: { id: old.id } });
    const result = await service.resolveWarning(token, old.id, {
      reason: 'Abandoned failed attempt',
    });
    expect(result.status).toBe('FAILED');
    expect(result.warningResolutionType).toBe('ABANDONED');
    expect((await attention.listItems(token)).some((x) => x.entityId === old.id)).toBe(false);
    expect(await protectedState()).toBe(before);
    expect(await db.payment.count()).toBe(1);
    expect(
      (await db.paymentOperation.findUniqueOrThrow({ where: { id: old.id } })).updatedAt,
    ).toEqual(original.updatedAt);
    const auditBefore = await db.auditLog.count();
    expect(
      await service.resolveWarning(token, old.id, { reason: 'Another acknowledgement' }),
    ).toEqual(result);
    expect(await db.auditLog.count()).toBe(auditBefore);
    expect(await protectedState()).toBe(before);
    expect(
      (await service.listStudent(token, studentId)).some(
        (x) => x.id === old.id && x.status === 'FAILED',
      ),
    ).toBe(true);
  });
  it('legacy failed attempt remains unresolved and blocked until an explicit provider check proves final failure', async () => {
    const op = await attempt('legacy');
    await service.failTrusted(op.id, 'Old failure');
    await expect(
      service.resolveWarning(token, op.id, { reason: 'Close historical warning' }),
    ).rejects.toThrow('PROVIDER_OUTCOME_UNCERTAIN');
    await service.recordProviderOutcomeTrusted(op.id, 'FAILED');
    expect(
      (await service.resolveWarning(token, op.id, { reason: 'Close historical warning' }))
        .warningResolvedAt,
    ).toBeTruthy();
  });
  it('EXPIRED remains EXPIRED after warning resolution', async () => {
    const op = await attempt('expired');
    await service.recordProviderOutcomeTrusted(op.id, 'EXPIRED');
    await service.expireTrusted(op.id);
    expect(
      (await service.resolveWarning(token, op.id, { reason: 'Abandoned expired attempt' })).status,
    ).toBe('EXPIRED');
  });
  it.each(['CREATED', 'WAITING_FOR_PAYMENT', 'PROCESSING'])(
    'blocks active %s, even with a negative provider result',
    async (status) => {
      const op = await attempt('active');
      await db.paymentOperation.update({
        where: { id: op.id },
        data: {
          status: status as 'CREATED' | 'WAITING_FOR_PAYMENT' | 'PROCESSING',
          providerOutcome: 'FAILED',
        },
      });
      const before = await protectedState();
      await expect(
        service.resolveWarning(token, op.id, { reason: 'Must not close' }),
      ).rejects.toThrow('OPERATION_NOT_TERMINAL_FAILURE');
      expect(await protectedState()).toBe(before);
    },
  );
  it('blocks finalization errors and remembers payment confirmation even after a later contradictory failed result', async () => {
    const op = await failed();
    await db.paymentOperation.update({
      where: { id: op.id },
      data: { saleFinalizationError: 'Finalization incomplete' },
    });
    await expect(
      service.resolveWarning(token, op.id, { reason: 'Must not close' }),
    ).rejects.toThrow('RECONCILIATION');
    await db.paymentOperation.update({
      where: { id: op.id },
      data: { saleFinalizationError: null },
    });
    await service.recordProviderOutcomeTrusted(op.id, 'SUCCEEDED');
    await service.recordProviderOutcomeTrusted(op.id, 'FAILED');
    await expect(
      service.resolveWarning(token, op.id, { reason: 'Must not close' }),
    ).rejects.toThrow('RECONCILIATION');
  });
  it('does not hide a late confirmed payment behind a previously resolved warning', async () => {
    const op = await failed();
    await service.resolveWarning(token, op.id, { reason: 'Abandoned attempt' });
    await service.recordProviderOutcomeTrusted(op.id, 'SUCCEEDED');
    expect(
      (await new AttentionService(db, app).listItems(token)).some((x) => x.entityId === op.id),
    ).toBe(true);
  });
  it('denies ADMIN both acknowledgement and diagnostic export', async () => {
    const op = await failed();
    await app.createUser(token, {
      branchIds: [branchId],
      email: 'admin-warning@example.test',
      fullName: 'Admin',
      password: 'Admin!Warning2026',
      role: 'ADMIN',
    });
    const admin = await app.login({
      email: 'admin-warning@example.test',
      password: 'Admin!Warning2026',
    });
    await expect(
      service.resolveWarning(admin.token, op.id, { reason: 'Not authorized' }),
    ).rejects.toThrow('владельцу');
    await expect(service.exportWarnings(admin.token, studentId)).rejects.toThrow('владельцу');
  });
  it('exports only allowlisted diagnostic data and never touches sessions, audit, operations or business/sync state', async () => {
    const op = await failed();
    const before = await protectedState();
    const sessions = await db.session.findMany();
    const audits = await db.auditLog.count();
    const operations = await db.paymentOperation.findMany();
    const report = await service.exportWarnings(token, studentId);
    const data = JSON.parse(report.content) as {
      total: number;
      operations: Record<string, unknown>[];
    };
    expect(data.total).toBe(1);
    expect(data.operations[0]).toMatchObject({
      operationId: op.id,
      status: 'FAILED',
      failureReasonPresent: true,
      providerOutcome: 'FAILED',
      resolutionBlockedReason: null,
    });
    for (const secret of [
      'PrivateName',
      'PrivateSurname',
      'PRIVATE',
      'secret-token',
      'email@example.com',
      'idempotencyKey',
      'providerOperationId',
      'password',
      'tokenHash',
      'warningResolutionNote',
    ])
      expect(report.content).not.toContain(secret);
    expect(await protectedState()).toBe(before);
    expect(await db.session.findMany()).toEqual(sessions);
    expect(await db.paymentOperation.findMany()).toEqual(operations);
    expect(await db.auditLog.count()).toBe(audits);
  });
  it('does not permit a linked payment to be dismissed as an unpaid failure', () => {
    expect(
      paymentWarningBlock({
        status: 'FAILED',
        paymentId: 'actual-payment',
        completedAt: null,
        saleFinalizationError: null,
        providerType: 'NONE',
        providerOutcome: null,
        providerPaymentConfirmedAt: null,
      }),
    ).toBe('PAYMENT_OR_FINALIZATION_REQUIRES_RECONCILIATION');
  });
});
