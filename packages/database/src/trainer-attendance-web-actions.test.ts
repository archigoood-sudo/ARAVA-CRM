import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
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
import { hashPassword } from './security';

class Credentials implements IntegrationCredentialStore {
  getDeviceId() {
    return Promise.resolve('device-attendance');
  }
  getToken() {
    return Promise.resolve('device-token');
  }
  clearToken() {
    return Promise.resolve();
  }
  saveToken() {
    return Promise.resolve();
  }
}

interface TrainerAttendanceAction {
  actionType: string;
  crmLessonId: string;
  crmTrainerId: string;
  externalActionId: string;
  marks: { crmStudentId: string; status: string }[];
  receivedAt: string;
}

class ActionApi extends IntegrationApiClient {
  actions: TrainerAttendanceAction[] = [];
  calls: string[] = [];
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

  override fetchChanges() {
    return Promise.resolve({ canonicalCount: 0, changes: [], cursor: 0, hasMore: false });
  }

  override syncBatch(
    _base: string,
    _device: string,
    _token: string,
    operations: SyncEntityEnvelope[],
  ) {
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
}

describe('TRAINER_ATTENDANCE_SUBMIT web actions', () => {
  let api: ActionApi;
  let application: ApplicationService;
  let branchId: string;
  let coachId: string;
  let database: DatabaseClient;
  let directory: string;
  let integration: IntegrationService;
  let lessonId: string;
  let otherCoachId: string;
  let otherStudentId: string;
  let studentAId: string;
  let studentBId: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-trainer-attendance-action-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'test.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    const branch = await database.branch.create({
      data: { address: 'Москва', description: '', name: 'Центр', phone: '+79990000000' },
    });
    branchId = branch.id;
    const createCoach = async (email: string) => {
      const coach = await database.user.create({
        data: {
          branchAssignments: { create: { branchId } },
          email,
          fullName: email,
          mustChangePassword: false,
          passwordHash: await hashPassword('Coach!Attendance2026'),
          role: 'COACH',
        },
      });
      return coach.id;
    };
    coachId = await createCoach('coach-attendance@arava.local');
    otherCoachId = await createCoach('other-attendance@arava.local');
    const group = await database.danceGroup.create({
      data: {
        branchId,
        capacity: 20,
        coachId,
        direction: 'Хип-хоп',
        name: 'Основная группа',
      },
    });
    const createStudent = async (firstName: string) =>
      database.student.create({ data: { branchId, firstName, lastName: 'Тестов' } });
    const [studentA, studentB, otherStudent] = await Promise.all([
      createStudent('Анна'),
      createStudent('Борис'),
      createStudent('Вне группы'),
    ]);
    studentAId = studentA.id;
    studentBId = studentB.id;
    otherStudentId = otherStudent.id;
    await database.enrollment.createMany({
      data: [studentAId, studentBId].map((studentId) => ({
        groupId: group.id,
        joinedAt: new Date('2030-08-01T00:00:00.000Z'),
        status: 'ACTIVE',
        studentId,
      })),
    });
    const lesson = await database.lesson.create({
      data: {
        branchId,
        coachId,
        endsAt: new Date('2030-08-22T11:00:00.000Z'),
        groupId: group.id,
        startsAt: new Date('2030-08-22T10:00:00.000Z'),
      },
    });
    lessonId = lesson.id;
    await database.syncOutbox.deleteMany();
    await database.appSetting.createMany({
      data: [
        { key: 'integration.enabled', value: 'true' },
        { key: 'integration.baseUrl', value: 'https://web.example' },
      ],
    });
    api = new ActionApi();
    integration = new IntegrationService(
      database,
      application,
      new Credentials(),
      api,
      () => new Date('2030-08-22T10:00:00.000Z'),
    );
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { recursive: true, force: true });
  });

  async function submit(id: string, marks: TrainerAttendanceAction['marks'], trainerId = coachId) {
    api.actions = [
      {
        actionType: 'TRAINER_ATTENDANCE_SUBMIT',
        crmLessonId: lessonId,
        crmTrainerId: trainerId,
        externalActionId: id,
        marks,
        receivedAt: '2030-08-22T09:59:00.000Z',
      },
    ];
    await integration.processPending();
  }

  it('claims first and applies PRESENT, ABSENT and ILL through the attendance model', async () => {
    await submit('marks-1', [
      { crmStudentId: studentAId, status: 'PRESENT' },
      { crmStudentId: studentBId, status: 'ILL' },
    ]);
    expect(api.calls.slice(0, 2)).toEqual(['claim:marks-1', 'complete:marks-1:SUCCEEDED']);
    expect(await database.attendance.findMany({ orderBy: { studentId: 'asc' } })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'PRESENT', studentId: studentAId }),
        expect.objectContaining({ status: 'EXCUSED', studentId: studentBId }),
      ]),
    );
    await submit('marks-2', [{ crmStudentId: studentAId, status: 'ABSENT' }]);
    expect(
      await database.attendance.findUniqueOrThrow({
        where: { lessonId_studentId: { lessonId, studentId: studentAId } },
      }),
    ).toMatchObject({ status: 'ABSENT' });
  });

  it('accepts the actual substitute and denies the replaced and unrelated trainers', async () => {
    await database.trainerSubstitution.create({
      data: {
        createdByUserId: coachId,
        lessonId,
        originalTrainerId: coachId,
        substituteTrainerId: otherCoachId,
      },
    });
    await database.lesson.update({ data: { coachId: otherCoachId }, where: { id: lessonId } });
    await submit('substitute', [{ crmStudentId: studentAId, status: 'PRESENT' }], otherCoachId);
    expect(api.calls).toContain('complete:substitute:SUCCEEDED');
    await submit('replaced', [{ crmStudentId: studentBId, status: 'PRESENT' }], coachId);
    expect(api.calls).toContain('complete:replaced:REJECTED');
    expect(await database.attendance.count({ where: { studentId: studentBId } })).toBe(0);
  });

  it('rejects students outside the lesson and duplicate or invalid marks atomically', async () => {
    await submit('foreign-student', [
      { crmStudentId: studentAId, status: 'PRESENT' },
      { crmStudentId: otherStudentId, status: 'ABSENT' },
    ]);
    expect(await database.attendance.count()).toBe(0);
    expect(api.calls).toContain('complete:foreign-student:REJECTED');
    await submit('duplicates', [
      { crmStudentId: studentAId, status: 'PRESENT' },
      { crmStudentId: studentAId, status: 'ABSENT' },
    ]);
    await submit('invalid-status', [{ crmStudentId: studentAId, status: 'LATE' }]);
    expect(await database.attendance.count()).toBe(0);
    expect(api.calls).toContain('complete:duplicates:REJECTED');
    expect(api.calls).toContain('complete:invalid-status:REJECTED');
  });

  it('does not mutate when the remote claim fails and recovers on retry', async () => {
    api.failClaim = true;
    await submit('claim-fails', [{ crmStudentId: studentAId, status: 'PRESENT' }]);
    expect(await database.attendance.count()).toBe(0);
    expect(
      await database.webAction.findUniqueOrThrow({ where: { externalActionId: 'claim-fails' } }),
    ).toMatchObject({ status: 'PENDING' });
    api.failClaim = false;
    await integration.processPending();
    expect(await database.attendance.count()).toBe(1);
  });

  it('is idempotent by external ID, supports correction, and retries only a failed ACK', async () => {
    api.failCompletion = true;
    await submit('ack-retry', [{ crmStudentId: studentAId, status: 'PRESENT' }]);
    expect(await database.attendance.count()).toBe(1);
    expect(
      await database.webAction.findUniqueOrThrow({ where: { externalActionId: 'ack-retry' } }),
    ).toMatchObject({ status: 'SUCCEEDED_ACK_PENDING' });
    api.failCompletion = false;
    integration = new IntegrationService(
      database,
      application,
      new Credentials(),
      api,
      () => new Date('2030-08-22T10:02:00.000Z'),
    );
    await integration.processPending();
    expect(await database.attendance.count()).toBe(1);
    expect(api.calls.filter((call) => call === 'claim:ack-retry')).toHaveLength(1);
    await submit('correction', [{ crmStudentId: studentAId, status: 'ABSENT' }]);
    expect(
      await database.attendance.findUniqueOrThrow({
        where: { lessonId_studentId: { lessonId, studentId: studentAId } },
      }),
    ).toMatchObject({ status: 'ABSENT' });
    expect(await database.auditLog.count({ where: { action: 'ATTENDANCE_CORRECTED' } })).toBe(1);
  });

  it('rejects an inactive or unrelated trainer without leaking a local mutation', async () => {
    await database.user.update({ data: { isActive: false }, where: { id: otherCoachId } });
    await submit('inactive', [{ crmStudentId: studentAId, status: 'PRESENT' }], otherCoachId);
    expect(api.calls).toContain('complete:inactive:REJECTED');
    expect(await database.attendance.count()).toBe(0);
  });
});
