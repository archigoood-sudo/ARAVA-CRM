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

it('allowlists only firstName, lastName and phone in the remote profile payload', async () => {
  const api = new IntegrationApiClient(() =>
    Promise.resolve({
      json: () =>
        Promise.resolve({
          actions: [
            {
              createdAt: '2030-08-22T09:00:00.000Z',
              id: 'valid',
              payload: { crmStudentId: 'student-1', firstName: 'Анна' },
              type: 'CLIENT_PROFILE_UPDATE_REQUEST',
            },
            {
              createdAt: '2030-08-22T09:00:00.000Z',
              id: 'unknown',
              payload: { crmStudentId: 'student-1', email: 'private@example.test' },
              type: 'CLIENT_PROFILE_UPDATE_REQUEST',
            },
            {
              createdAt: '2030-08-22T09:00:00.000Z',
              id: 'empty',
              payload: { crmStudentId: 'student-1' },
              type: 'CLIENT_PROFILE_UPDATE_REQUEST',
            },
          ],
        }),
      ok: true,
      status: 200,
    }),
  );
  const actions = await api.listActions('https://web.example', 'device', 'token');
  expect(
    actions.map(({ externalActionId, profileChanges, profilePayloadValid }) => ({
      externalActionId,
      profileChanges,
      profilePayloadValid,
    })),
  ).toEqual([
    { externalActionId: 'valid', profileChanges: { firstName: 'Анна' }, profilePayloadValid: true },
    { externalActionId: 'unknown', profileChanges: {}, profilePayloadValid: false },
    { externalActionId: 'empty', profileChanges: {}, profilePayloadValid: false },
  ]);
});

class Credentials implements IntegrationCredentialStore {
  clearToken() {
    return Promise.resolve();
  }
  getDeviceId() {
    return Promise.resolve('device-profile-update');
  }
  getToken() {
    return Promise.resolve('device-token');
  }
  saveToken() {
    return Promise.resolve();
  }
}

interface ProfileAction {
  actionType: string;
  crmStudentId: string;
  externalActionId: string;
  profileChanges?: { firstName?: string; lastName?: string; phone?: string };
  profilePayloadValid?: boolean;
  receivedAt: string;
}

class ActionApi extends IntegrationApiClient {
  actions: ProfileAction[] = [];
  calls: string[] = [];
  envelopes: SyncEntityEnvelope[] = [];
  failClaim = false;
  failCompletion = false;
  onClaim?: () => Promise<void>;

  override listActions() {
    return Promise.resolve(this.actions);
  }

  override async claimAction(_base: string, _device: string, _token: string, id: string) {
    this.calls.push(`claim:${id}`);
    await this.onClaim?.();
    if (this.failClaim) throw new Error('claim failed');
    return 'CLAIMED' as const;
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

describe('CLIENT_PROFILE_UPDATE_REQUEST web actions', () => {
  let api: ActionApi;
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let integration: IntegrationService;
  let ownerToken: string;
  let studentId: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-client-profile-action-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'test.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    ownerToken = (
      await application.login({
        email: INITIAL_OWNER_EMAIL,
        password: INITIAL_OWNER_PASSWORD,
      })
    ).token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!ClientProfile2026',
    });
    const branch = await database.branch.create({
      data: { address: 'Москва', description: '', name: 'Центр', phone: '+79990000000' },
    });
    const student = await database.student.create({
      data: {
        branchId: branch.id,
        firstName: 'Анна',
        lastName: 'Иванова',
        phone: '+79990000001',
      },
    });
    studentId = student.id;
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

  async function submit(
    id: string,
    changes: ProfileAction['profileChanges'],
    options: { student?: string; valid?: boolean } = {},
  ) {
    api.actions = [
      {
        actionType: 'CLIENT_PROFILE_UPDATE_REQUEST',
        crmStudentId: options.student ?? studentId,
        externalActionId: id,
        ...(changes ? { profileChanges: changes } : {}),
        profilePayloadValid: options.valid ?? true,
        receivedAt: '2030-08-22T09:59:00.000Z',
      },
    ];
    await integration.processPending();
  }

  it('updates first name, last name and canonical Student phone automatically', async () => {
    await submit('first-name', { firstName: 'Мария' });
    await submit('last-name', { lastName: 'Петрова' });
    await submit('phone', { phone: '+7 (999) 111-22-33' });
    expect(await database.student.findUniqueOrThrow({ where: { id: studentId } })).toMatchObject({
      firstName: 'Мария',
      lastName: 'Петрова',
      phone: '+79991112233',
    });
    expect(api.calls).toEqual(
      expect.arrayContaining([
        'claim:first-name',
        'complete:first-name:SUCCEEDED',
        'claim:last-name',
        'complete:last-name:SUCCEEDED',
        'claim:phone',
        'complete:phone:SUCCEEDED',
      ]),
    );
    expect(api.envelopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: studentId, entityType: 'STUDENT_IDENTITY' }),
      ]),
    );
    const summary = (await integration.listWebActions(ownerToken)).actions.find(
      ({ externalActionId }) => externalActionId === 'phone',
    );
    expect(summary).toMatchObject({
      actionType: 'CLIENT_PROFILE_UPDATE_REQUEST',
      requestedFields: ['phone'],
      status: 'SUCCEEDED',
    });
  });

  it('claims before an atomic multi-field mutation and rejects the whole invalid update', async () => {
    let nameAtClaim = '';
    api.onClaim = async () => {
      nameAtClaim = (await database.student.findUniqueOrThrow({ where: { id: studentId } }))
        .firstName;
    };
    await submit('atomic-invalid', { firstName: 'Новая', phone: '12' });
    expect(nameAtClaim).toBe('Анна');
    expect(await database.student.findUniqueOrThrow({ where: { id: studentId } })).toMatchObject({
      firstName: 'Анна',
      phone: '+79990000001',
    });
    expect(api.calls).toContain('complete:atomic-invalid:REJECTED');
    expect(await database.syncOutbox.count({ where: { entityType: 'STUDENT_IDENTITY' } })).toBe(0);
  });

  it('rejects empty, unknown-field and nonexistent-student requests', async () => {
    await submit('empty', {}, { valid: false });
    await submit('unknown-field', {}, { valid: false });
    await submit('missing-student', { firstName: 'Мария' }, { student: 'missing-student' });
    expect(api.calls).toEqual(
      expect.arrayContaining([
        'complete:empty:REJECTED',
        'complete:unknown-field:REJECTED',
        'complete:missing-student:REJECTED',
      ]),
    );
    expect(await database.student.findUniqueOrThrow({ where: { id: studentId } })).toMatchObject({
      firstName: 'Анна',
      lastName: 'Иванова',
    });
  });

  it('does not mutate on failed claim and safely retries the same external action', async () => {
    api.failClaim = true;
    await submit('claim-failed', { firstName: 'Мария' });
    expect((await database.student.findUniqueOrThrow({ where: { id: studentId } })).firstName).toBe(
      'Анна',
    );
    expect(
      await database.webAction.findUniqueOrThrow({ where: { externalActionId: 'claim-failed' } }),
    ).toMatchObject({ status: 'PENDING' });
    api.failClaim = false;
    await integration.processPending();
    expect((await database.student.findUniqueOrThrow({ where: { id: studentId } })).firstName).toBe(
      'Мария',
    );
  });

  it('applies a duplicate external action once and retries only completion after restart', async () => {
    api.failCompletion = true;
    await submit('ack-retry', { firstName: 'Мария', lastName: 'Петрова' });
    expect(
      await database.webAction.findUniqueOrThrow({ where: { externalActionId: 'ack-retry' } }),
    ).toMatchObject({ status: 'SUCCEEDED_ACK_PENDING' });
    api.actions = [
      {
        actionType: 'CLIENT_PROFILE_UPDATE_REQUEST',
        crmStudentId: studentId,
        externalActionId: 'ack-retry',
        profileChanges: { firstName: 'Повтор' },
        profilePayloadValid: true,
        receivedAt: '2030-08-22T09:59:00.000Z',
      },
    ];
    api.failCompletion = false;
    integration = service('2030-08-22T10:02:00.000Z');
    await integration.initialize();
    await integration.processPending();
    expect(await database.student.findUniqueOrThrow({ where: { id: studentId } })).toMatchObject({
      firstName: 'Мария',
      lastName: 'Петрова',
    });
    expect(api.calls.filter((call) => call === 'claim:ack-retry')).toHaveLength(1);
    expect(
      await database.auditLog.count({
        where: { action: 'STUDENT_UPDATED', detail: { contains: 'WEB_PROFILE_UPDATE' } },
      }),
    ).toBe(1);
    expect(
      await database.webAction.findUniqueOrThrow({ where: { externalActionId: 'ack-retry' } }),
    ).toMatchObject({ status: 'SUCCEEDED' });
  });
});
