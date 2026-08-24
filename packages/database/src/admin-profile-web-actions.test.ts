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
  type SyncEntityEnvelope,
} from './integration-service';
import { ApplicationService } from './services';

it('strictly allowlists WEB admin update payloads', async () => {
  const api = new IntegrationApiClient(() =>
    Promise.resolve({
      json: () =>
        Promise.resolve({
          actions: [
            {
              createdAt: '2030-08-22T09:00:00.000Z',
              id: 'student-valid',
              payload: { crmStudentId: 'student-1', firstName: 'Анна' },
              type: 'ADMIN_STUDENT_UPDATE_REQUEST',
            },
            {
              createdAt: '2030-08-22T09:00:00.000Z',
              id: 'student-unknown',
              payload: { crmStudentId: 'student-1', email: 'private@example.test' },
              type: 'ADMIN_STUDENT_UPDATE_REQUEST',
            },
            {
              createdAt: '2030-08-22T09:00:00.000Z',
              id: 'trainer-valid',
              payload: {
                branchIds: ['branch-1'],
                crmTrainerId: 'trainer-1',
                displayName: 'Анна Тренерова',
                isActive: true,
              },
              type: 'ADMIN_TRAINER_UPDATE_REQUEST',
            },
            {
              createdAt: '2030-08-22T09:00:00.000Z',
              id: 'trainer-unknown',
              payload: { crmTrainerId: 'trainer-1', role: 'OWNER' },
              type: 'ADMIN_TRAINER_UPDATE_REQUEST',
            },
          ],
        }),
      ok: true,
      status: 200,
    }),
  );
  const actions = await api.listActions('https://web.example', 'device', 'token');
  expect(actions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        adminStudentChanges: { firstName: 'Анна' },
        adminStudentPayloadValid: true,
        externalActionId: 'student-valid',
      }),
      expect.objectContaining({
        adminStudentPayloadValid: false,
        externalActionId: 'student-unknown',
      }),
      expect.objectContaining({
        adminTrainerChanges: {
          branchIds: ['branch-1'],
          displayName: 'Анна Тренерова',
          isActive: true,
        },
        adminTrainerPayloadValid: true,
        externalActionId: 'trainer-valid',
      }),
      expect.objectContaining({
        adminTrainerPayloadValid: false,
        externalActionId: 'trainer-unknown',
      }),
    ]),
  );
});

it('sends the canonical empty-object WEB claim request and accepts a 204 response', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const api = new IntegrationApiClient((url, init) => {
    requestUrl = url;
    requestInit = init;
    return Promise.resolve({
      json: () => Promise.reject(new Error('204 has no response body')),
      ok: true,
      status: 204,
    });
  });

  await expect(
    api.claimAction('https://web.example', 'device', 'token', 'admin-action'),
  ).resolves.toBe('CLAIMED');
  expect(requestUrl).toBe('https://web.example/api/integration/v1/actions/admin-action/claim');
  expect(requestInit).toMatchObject({ method: 'POST' });
  expect(requestInit?.body).toBe('{}');
  expect(requestInit?.headers).toMatchObject({
    Authorization: 'Bearer token',
    'X-ARAVA-API-Version': 'v1',
    'X-ARAVA-Device-ID': 'device',
  });
  expect(JSON.stringify(requestInit)).not.toContain('apiVersion');
  expect(JSON.stringify(requestInit)).not.toContain('deviceId');
});

it('preserves a safe HTTP status and code when WEB rejects claim', async () => {
  const api = new IntegrationApiClient(() =>
    Promise.resolve({
      json: () =>
        Promise.resolve({ code: 'ACTION_CLAIM_CONFLICT', message: 'private server detail' }),
      ok: false,
      status: 409,
    }),
  );

  await expect(
    api.claimAction('https://web.example', 'device', 'token', 'admin-action'),
  ).rejects.toMatchObject({ errorCode: 'ACTION_CLAIM_CONFLICT', httpStatus: 409 });
});

class Credentials implements IntegrationCredentialStore {
  clearToken() {
    return Promise.resolve();
  }
  getDeviceId() {
    return Promise.resolve('device-admin-updates');
  }
  getToken() {
    return Promise.resolve('device-token');
  }
  saveToken() {
    return Promise.resolve();
  }
}

interface AdminAction {
  actionType: string;
  adminStudentChanges?: { firstName?: string; lastName?: string; phone?: string };
  adminStudentPayloadValid?: boolean;
  adminTrainerChanges?: {
    branchIds?: string[];
    description?: string;
    displayName?: string;
    isActive?: boolean;
    phone?: string;
  };
  adminTrainerPayloadValid?: boolean;
  crmStudentId?: string;
  crmTrainerId?: string;
  externalActionId: string;
  receivedAt: string;
}

class ActionApi extends IntegrationApiClient {
  actions: AdminAction[] = [];
  calls: string[] = [];
  envelopes: SyncEntityEnvelope[] = [];
  failClaim = false;
  failCompletion = false;

  override listActions() {
    return Promise.resolve(this.actions);
  }

  override claimAction(_base: string, _device: string, _token: string, id: string) {
    this.calls.push(`claim:${id}`);
    return this.failClaim
      ? Promise.reject(new Error('claim failed'))
      : Promise.resolve('CLAIMED' as const);
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

  override syncBatch(
    _base: string,
    _device: string,
    _token: string,
    operations: SyncEntityEnvelope[],
  ) {
    this.envelopes.push(...operations);
    return Promise.resolve({
      accepted: operations.map((operation, index) => ({
        canonicalOperation: operation.operation,
        canonicalPayload: operation.payload,
        entityId: operation.entityId,
        idempotencyKey: operation.idempotencyKey,
        revision: operation.baseRevision + 1,
        serverSequence: index + 1,
        status: 'ACCEPTED' as const,
        version: operation.version,
      })),
      apiVersion: 'v1',
      serverTimestamp: '2030-08-22T10:00:00.000Z',
    });
  }

  override fetchChanges() {
    return Promise.resolve({ canonicalCount: 0, changes: [], cursor: 0, hasMore: false });
  }
}

describe('WEB admin student and trainer update actions', () => {
  let api: ActionApi;
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let integration: IntegrationService;
  let ownerToken: string;
  let studentId: string;
  let trainerId: string;
  let groupId: string;
  let firstBranchId: string;
  let secondBranchId: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-admin-update-action-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'test.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    ownerToken = (
      await application.login({ email: INITIAL_OWNER_EMAIL, password: INITIAL_OWNER_PASSWORD })
    ).token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!AdminActions2026',
    });
    const firstBranch = await application.createBranch(ownerToken, { name: 'Центр' });
    const secondBranch = await application.createBranch(ownerToken, { name: 'Север' });
    firstBranchId = firstBranch.id;
    secondBranchId = secondBranch.id;
    const student = await application.createStudent(ownerToken, {
      branchId: firstBranch.id,
      firstName: 'Анна',
      lastName: 'Иванова',
      phone: '+79990000001',
      status: 'ACTIVE',
    });
    studentId = student.id;
    const trainer = await application.createUser(ownerToken, {
      branchIds: [firstBranch.id],
      email: 'trainer-admin-action@arava.local',
      fullName: 'Старое Имя',
      password: 'Trainer!AdminAction2026',
      phone: '+79990000002',
      role: 'COACH',
      trainerDescription: 'Старое описание',
    });
    trainerId = trainer.id;
    groupId = (
      await database.danceGroup.create({
        data: {
          branchId: firstBranch.id,
          capacity: 20,
          coachId: trainer.id,
          direction: 'Хип-хоп',
          name: 'Импульс',
          status: 'ACTIVE',
        },
      })
    ).id;
    await database.syncOutbox.deleteMany();
    await database.appSetting.createMany({
      data: [
        { key: 'integration.enabled', value: 'true' },
        { key: 'integration.baseUrl', value: 'https://web.example' },
      ],
    });
    api = new ActionApi();
    integration = service();
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  function service(now = '2030-08-22T10:00:00.000Z') {
    return new IntegrationService(
      database,
      application,
      new Credentials(),
      api,
      () => new Date(now),
    );
  }

  async function submit(action: AdminAction) {
    api.actions = [action];
    await integration.processPending();
  }

  it('updates student identity fields with canonical validation and normalization', async () => {
    await submit({
      actionType: 'ADMIN_STUDENT_UPDATE_REQUEST',
      adminStudentChanges: {
        firstName: ' Мария ',
        lastName: 'Петрова',
        phone: '+7 (999) 111-22-33',
      },
      adminStudentPayloadValid: true,
      crmStudentId: studentId,
      externalActionId: 'student-update',
      receivedAt: '2030-08-22T09:59:00.000Z',
    });
    expect(await database.student.findUniqueOrThrow({ where: { id: studentId } })).toMatchObject({
      firstName: 'Мария',
      lastName: 'Петрова',
      phone: '+79991112233',
    });
    expect(api.calls).toEqual(['claim:student-update', 'complete:student-update:SUCCEEDED']);
    expect(api.envelopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: studentId, entityType: 'STUDENT_IDENTITY' }),
      ]),
    );
  });

  it('updates trainer fields and branches without changing the stable ID or group relation', async () => {
    await submit({
      actionType: 'ADMIN_TRAINER_UPDATE_REQUEST',
      adminTrainerChanges: {
        branchIds: [secondBranchId],
        description: 'Новое описание',
        displayName: 'Новое Имя',
        isActive: false,
        phone: '+7 (999) 222-33-44',
      },
      adminTrainerPayloadValid: true,
      crmTrainerId: trainerId,
      externalActionId: 'trainer-update',
      receivedAt: '2030-08-22T09:59:00.000Z',
    });
    const trainer = await database.user.findUniqueOrThrow({
      include: { branchAssignments: true },
      where: { id: trainerId },
    });
    expect(trainer).toMatchObject({
      fullName: 'Новое Имя',
      id: trainerId,
      isActive: false,
      phone: '+79992223344',
      role: 'COACH',
      trainerDescription: 'Новое описание',
    });
    expect(trainer.branchAssignments.map(({ branchId }) => branchId)).toEqual([secondBranchId]);
    expect(await database.danceGroup.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject({
      coachId: trainerId,
    });
    const trainerEnvelope = api.envelopes.find(
      ({ entityId, entityType }) => entityId === trainerId && entityType === 'TRAINER',
    );
    expect(trainerEnvelope?.payload).toMatchObject({
      activeGroupIds: [groupId],
      branchIds: [secondBranchId],
      description: 'Новое описание',
      displayName: 'Новое Имя',
      isActive: false,
      phone: '+79992223344',
    });
  });

  it('does not mutate before a successful claim', async () => {
    api.failClaim = true;
    await submit({
      actionType: 'ADMIN_TRAINER_UPDATE_REQUEST',
      adminTrainerChanges: { displayName: 'Не применять' },
      adminTrainerPayloadValid: true,
      crmTrainerId: trainerId,
      externalActionId: 'failed-claim',
      receivedAt: '2030-08-22T09:59:00.000Z',
    });
    expect((await database.user.findUniqueOrThrow({ where: { id: trainerId } })).fullName).toBe(
      'Старое Имя',
    );
    const failedAction = await database.webAction.findUniqueOrThrow({
      where: { externalActionId: 'failed-claim' },
    });
    expect(failedAction).toMatchObject({ completionAttemptCount: 0, status: 'PENDING' });
    expect(
      await database.syncLog.findFirstOrThrow({
        where: { operation: 'WEB_ACTION_CLAIM', outboxId: failedAction.id },
      }),
    ).toMatchObject({
      entityId: 'failed-claim',
      entityType: 'ADMIN_TRAINER_UPDATE_REQUEST',
      errorCode: 'WEB_ACTION_CLAIM_FAILED',
      result: 'RETRY',
    });
  });

  it('refresh fetches and processes automatic actions, then retries a failed claim once', async () => {
    api.actions = [
      {
        actionType: 'ADMIN_TRAINER_UPDATE_REQUEST',
        adminTrainerChanges: { displayName: 'После повтора' },
        adminTrainerPayloadValid: true,
        crmTrainerId: trainerId,
        externalActionId: 'refresh-retry',
        receivedAt: '2030-08-22T09:59:00.000Z',
      },
    ];
    api.failClaim = true;

    await expect(integration.listWebActions(ownerToken)).resolves.toEqual({
      actions: [],
      hasAutomaticProcessingWarning: true,
    });
    expect((await database.user.findUniqueOrThrow({ where: { id: trainerId } })).fullName).toBe(
      'Старое Имя',
    );
    expect(
      await database.webAction.findUniqueOrThrow({ where: { externalActionId: 'refresh-retry' } }),
    ).toMatchObject({ completionAttemptCount: 0, status: 'PENDING' });

    api.failClaim = false;
    await expect(integration.listWebActions(ownerToken)).resolves.toEqual({
      actions: [],
      hasAutomaticProcessingWarning: false,
    });
    expect((await database.user.findUniqueOrThrow({ where: { id: trainerId } })).fullName).toBe(
      'После повтора',
    );
    expect(api.calls.filter((call) => call === 'claim:refresh-retry')).toHaveLength(2);
    expect(
      await database.auditLog.count({
        where: { action: 'USER_UPDATED', detail: { contains: 'WEB_ADMIN_TRAINER_UPDATE' } },
      }),
    ).toBe(1);
  });

  it('applies a duplicate once and retries only the failed completion acknowledgement', async () => {
    api.failCompletion = true;
    await submit({
      actionType: 'ADMIN_TRAINER_UPDATE_REQUEST',
      adminTrainerChanges: { displayName: 'Один раз' },
      adminTrainerPayloadValid: true,
      crmTrainerId: trainerId,
      externalActionId: 'ack-retry',
      receivedAt: '2030-08-22T09:59:00.000Z',
    });
    expect(
      await database.webAction.findUniqueOrThrow({ where: { externalActionId: 'ack-retry' } }),
    ).toMatchObject({ status: 'SUCCEEDED_ACK_PENDING' });
    api.actions = [
      {
        actionType: 'ADMIN_TRAINER_UPDATE_REQUEST',
        adminTrainerChanges: { displayName: 'Не применять повторно' },
        adminTrainerPayloadValid: true,
        crmTrainerId: trainerId,
        externalActionId: 'ack-retry',
        receivedAt: '2030-08-22T09:59:00.000Z',
      },
    ];
    api.failCompletion = false;
    integration = service('2030-08-22T10:02:00.000Z');
    await integration.processPending();
    expect((await database.user.findUniqueOrThrow({ where: { id: trainerId } })).fullName).toBe(
      'Один раз',
    );
    expect(api.calls.filter((call) => call === 'claim:ack-retry')).toHaveLength(1);
    expect(
      await database.auditLog.count({
        where: { action: 'USER_UPDATED', detail: { contains: 'WEB_ADMIN_TRAINER_UPDATE' } },
      }),
    ).toBe(1);
    expect(
      await database.webAction.findUniqueOrThrow({ where: { externalActionId: 'ack-retry' } }),
    ).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('rejects invalid branch assignments and leaves the trainer unchanged atomically', async () => {
    await submit({
      actionType: 'ADMIN_TRAINER_UPDATE_REQUEST',
      adminTrainerChanges: { branchIds: [firstBranchId, 'missing'], displayName: 'Не применять' },
      adminTrainerPayloadValid: true,
      crmTrainerId: trainerId,
      externalActionId: 'invalid-branch',
      receivedAt: '2030-08-22T09:59:00.000Z',
    });
    expect((await database.user.findUniqueOrThrow({ where: { id: trainerId } })).fullName).toBe(
      'Старое Имя',
    );
    expect(api.calls).toContain('complete:invalid-branch:REJECTED');
  });
});
