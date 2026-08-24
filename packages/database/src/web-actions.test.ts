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
import {
  IntegrationApiClient,
  IntegrationService,
  type IntegrationCredentialStore,
} from './integration-service';
import { ApplicationService } from './services';
import { hashPassword } from './security';

class Credentials implements IntegrationCredentialStore {
  token = 'device-token';
  clearToken() {
    this.token = undefined as never;
    return Promise.resolve();
  }
  getDeviceId() {
    return Promise.resolve('device-a');
  }
  getToken() {
    return Promise.resolve(this.token);
  }
  saveToken(token: string) {
    this.token = token;
    return Promise.resolve();
  }
}

class ActionApi extends IntegrationApiClient {
  actions: {
    actionType: string;
    crmStudentId?: string;
    crmSubscriptionId?: string;
    externalActionId: string;
    reason?: string;
    receivedAt: string;
  }[] = [];
  calls: string[] = [];
  failCompletion = false;
  override listActions() {
    return Promise.resolve(this.actions);
  }
  override claimAction(_base: string, _device: string, _token: string, id: string) {
    this.calls.push(`claim:${id}`);
    return Promise.resolve('CLAIMED' as const);
  }
  override completeAction(
    _base: string,
    _device: string,
    _token: string,
    id: string,
    status: 'SUCCEEDED' | 'REJECTED' | 'FAILED',
  ) {
    this.calls.push(`complete:${id}:${status}`);
    return this.failCompletion ? Promise.reject(new Error('offline')) : Promise.resolve();
  }
  override fetchChanges() {
    return Promise.resolve({ canonicalCount: 0, changes: [], cursor: 0, hasMore: false });
  }
}

describe('WEB subscription freeze actions', () => {
  let api: ActionApi;
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let integration: IntegrationService;
  let ownerId: string;
  let ownerToken: string;
  let studentId: string;
  let subscriptionId: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-web-actions-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'test.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerId = owner.user.id;
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!WebActions2026',
    });
    const branch = await database.branch.create({
      data: { address: 'Москва', description: '', name: 'Центр', phone: '+79990000000' },
    });
    const student = await database.student.create({
      data: { branchId: branch.id, firstName: 'Анна', lastName: 'Иванова' },
    });
    studentId = student.id;
    const tariff = await database.tariff.create({
      data: {
        freezeDays: 14,
        lessonCount: 8,
        name: '8 занятий',
        price: 800000,
        type: 'LESSON_PACK',
      },
    });
    const subscription = await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: ownerId,
        lessonLimit: 8,
        purchasedAt: new Date(),
        salePrice: 800000,
        startsAt: new Date(),
        status: 'ACTIVE',
        studentId,
        tariffId: tariff.id,
      },
    });
    subscriptionId = subscription.id;
    await database.syncOutbox.deleteMany();
    await database.appSetting.upsert({
      create: { key: 'integration.enabled', value: 'true' },
      update: { value: 'true' },
      where: { key: 'integration.enabled' },
    });
    await database.appSetting.upsert({
      create: { key: 'integration.baseUrl', value: 'https://web.example' },
      update: { value: 'https://web.example' },
      where: { key: 'integration.baseUrl' },
    });
    api = new ActionApi();
    integration = new IntegrationService(
      database,
      application,
      new Credentials(),
      api,
      () => new Date('2030-08-22T10:00:00Z'),
    );
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { recursive: true, force: true });
  });

  async function receive(id = 'action-1') {
    api.actions = [
      {
        actionType: 'CLIENT_SUBSCRIPTION_FREEZE_REQUEST',
        crmStudentId: studentId,
        crmSubscriptionId: subscriptionId,
        externalActionId: id,
        reason: 'Отпуск',
        receivedAt: '2030-08-22T09:00:00Z',
      },
    ];
    await integration.processPending();
    const action = (await integration.listWebActions(ownerToken)).actions[0];
    if (!action) throw new Error('Заявка не была сохранена.');
    return action;
  }

  it('stores a repeated external action only once', async () => {
    await receive();
    await integration.processPending();
    expect(await database.webAction.count()).toBe(1);
  });

  it('claims before existing freeze logic and retries only completion', async () => {
    const action = await receive();
    api.failCompletion = true;
    const pending = await integration.approveWebAction(ownerToken, action.id, { days: 3 });
    expect(api.calls[0]).toBe('claim:action-1');
    expect(pending.status).toBe('SUCCEEDED_ACK_PENDING');
    expect(
      await database.subscriptionLedger.count({ where: { subscriptionId, type: 'FREEZE' } }),
    ).toBe(1);
    api.failCompletion = false;
    integration = new IntegrationService(
      database,
      application,
      new Credentials(),
      api,
      () => new Date('2030-08-22T10:02:00Z'),
    );
    const completed = await integration.approveWebAction(ownerToken, action.id, { days: 3 });
    expect(completed.status).toBe('SUCCEEDED');
    expect(
      await database.subscriptionLedger.count({ where: { subscriptionId, type: 'FREEZE' } }),
    ).toBe(1);
  });

  it('rejects without changing the subscription', async () => {
    const action = await receive('reject-1');
    const result = await integration.rejectWebAction(ownerToken, action.id, 'Недостаточно данных');
    expect(result.status).toBe('REJECTED');
    expect(
      (await database.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })).status,
    ).toBe('ACTIVE');
    expect(
      await database.subscriptionLedger.count({ where: { subscriptionId, type: 'FREEZE' } }),
    ).toBe(0);
  });

  it('denies coaches and validates the local student/subscription link', async () => {
    const coachPassword = 'Coach!WebActions2026';
    await database.user.create({
      data: {
        email: 'coach-web-action@arava.local',
        fullName: 'Тренер',
        mustChangePassword: false,
        passwordHash: await hashPassword(coachPassword),
        role: 'COACH',
      },
    });
    const coach = await application.login({
      email: 'coach-web-action@arava.local',
      password: coachPassword,
    });
    await expect(integration.listWebActions(coach.token)).rejects.toThrow('Тренеру недоступны');
    const action = await receive('bad-link');
    await database.webAction.update({
      data: { crmStudentId: 'another-student' },
      where: { id: action.id },
    });
    await expect(integration.approveWebAction(ownerToken, action.id, { days: 1 })).rejects.toThrow(
      'не принадлежит',
    );
    expect(api.calls).not.toContain('claim:bad-link');
  });

  it('enforces branch scope for a restricted administrator', async () => {
    const password = 'Admin!WebActions2026';
    const adminUser = await database.user.create({
      data: {
        email: 'admin-web-action@arava.local',
        fullName: 'Администратор',
        mustChangePassword: false,
        passwordHash: await hashPassword(password),
        role: 'ADMIN',
      },
    });
    const otherBranch = await database.branch.create({
      data: { address: 'Казань', description: '', name: 'Другой', phone: '+79990000001' },
    });
    await database.userBranch.create({ data: { branchId: otherBranch.id, userId: adminUser.id } });
    const admin = await application.login({ email: 'admin-web-action@arava.local', password });
    const action = await receive('admin-denied');
    expect(await integration.listWebActions(admin.token)).toEqual({
      actions: [],
      hasAutomaticProcessingWarning: false,
    });
    await expect(integration.approveWebAction(admin.token, action.id, { days: 1 })).rejects.toThrow(
      'Нет доступа к филиалу',
    );
  });

  it('safely rejects unknown action types without local business data', async () => {
    api.actions = [
      {
        actionType: 'UNKNOWN_ACTION',
        externalActionId: 'unknown-1',
        receivedAt: '2030-08-22T09:00:00Z',
      },
    ];
    await integration.processPending();
    expect(await database.webAction.count()).toBe(0);
    expect(api.calls).toEqual(['claim:unknown-1', 'complete:unknown-1:REJECTED']);
  });
});
