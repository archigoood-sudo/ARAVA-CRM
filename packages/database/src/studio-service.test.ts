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
import { ApplicationService } from './services';
import { StudioService } from './studio-service';

describe('Sprint 2 studio service', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-studio-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'studio.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
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

  async function branchAndCoach() {
    const branch = await application.createBranch(ownerToken, {
      address: 'ул. Танцевальная, 1',
      name: 'Центр',
      phone: '+79990000001',
    });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach@arava.local',
      fullName: 'Анна Тренерова',
      password: 'Coach!Secure2026',
      role: 'COACH',
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 1,
      coachId: coach.id,
      color: '#9CFF2E',
      direction: 'Хип-хоп',
      name: 'Импульс',
      status: 'ACTIVE',
    });
    return { branch, coach, group };
  }

  it('prevents duplicate enrolment and requires an audited capacity override', async () => {
    const { branch, group } = await branchAndCoach();
    const first = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мила',
      lastName: 'Петрова',
      status: 'ACTIVE',
    });
    const second = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Ирина',
      lastName: 'Соколова',
      status: 'ACTIVE',
    });
    const input = {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE' as const,
      studentId: first.id,
    };
    await studio.addEnrollment(ownerToken, group.id, input);
    await expect(studio.addEnrollment(ownerToken, group.id, input)).rejects.toThrow(
      t('domain.conflict.enrollmentDuplicate'),
    );
    await expect(
      studio.addEnrollment(ownerToken, group.id, { ...input, studentId: second.id }),
    ).rejects.toThrow(t('domain.conflict.groupCapacity'));
    await studio.addEnrollment(ownerToken, group.id, {
      ...input,
      overrideCapacity: true,
      studentId: second.id,
    });
    expect(
      await database.auditLog.count({
        where: { action: 'CAPACITY_OVERRIDDEN', entityId: group.id },
      }),
    ).toBe(1);
  });

  it('enforces group branch scope and coach read-only assignment', async () => {
    const { branch, coach, group } = await branchAndCoach();
    const otherBranch = await application.createBranch(ownerToken, {
      address: 'ул. Другая, 2',
      name: 'Север',
      phone: '+79990000002',
    });
    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'manager@arava.local',
      fullName: 'Управляющий',
      password: 'Manager!Pass2026',
      role: 'BRANCH_MANAGER',
    });
    const manager = await application.login({
      email: 'manager@arava.local',
      password: 'Manager!Pass2026',
    });
    await application.changePassword(manager.token, {
      currentPassword: 'Manager!Pass2026',
      newPassword: 'Manager!Changed2026',
    });
    await expect(
      studio.createGroup(manager.token, {
        branchId: otherBranch.id,
        capacity: 10,
        direction: 'Балет',
        name: 'Нет доступа',
        status: 'ACTIVE',
      }),
    ).rejects.toThrow(t('domain.authorization.branchDenied'));
    const coachSession = await application.login({
      email: coach.email,
      password: 'Coach!Secure2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Secure2026',
      newPassword: 'Coach!Changed2026',
    });
    await expect(studio.listGroups(coachSession.token, {})).resolves.toMatchObject([
      { id: group.id },
    ]);
    await expect(
      studio.updateGroup(coachSession.token, group.id, { ...group, name: 'Запрещено' }),
    ).rejects.toThrow(t('domain.authorization.permissionDenied'));
  });

  it('blocks schedule conflicts, generates idempotent lessons, and audits attendance corrections', async () => {
    const { branch, coach, group } = await branchAndCoach();
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мила',
      lastName: 'Петрова',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, group.id, {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    const schedule = await studio.createSchedule(ownerToken, {
      branchId: branch.id,
      coachId: coach.id,
      endTime: '19:00',
      groupId: group.id,
      isActive: true,
      room: 'Зал 1',
      startTime: '18:00',
      validFrom: '2026-08-01',
      weekday: 1,
    });
    await expect(
      studio.createSchedule(ownerToken, {
        ...schedule,
        endTime: '19:30',
        startTime: '18:30',
      }),
    ).rejects.toThrow(/конфликт/u);
    await expect(
      studio.createSchedule(ownerToken, {
        ...schedule,
        endTime: '20:00',
        startTime: '19:00',
      }),
    ).resolves.toBeDefined();
    await expect(
      studio.generateLessons(ownerToken, { dateFrom: '2026-08-10', dateTo: '2026-08-10' }),
    ).resolves.toEqual({ created: 2, skipped: 0 });
    await expect(
      studio.generateLessons(ownerToken, { dateFrom: '2026-08-10', dateTo: '2026-08-10' }),
    ).resolves.toEqual({ created: 0, skipped: 2 });
    const lesson = await database.lesson.findFirstOrThrow({
      orderBy: { startsAt: 'asc' },
      where: { groupId: group.id },
    });
    const coachSession = await application.login({
      email: coach.email,
      password: 'Coach!Secure2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Secure2026',
      newPassword: 'Coach!Changed2026',
    });
    await studio.saveAttendance(coachSession.token, lesson.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);
    await expect(
      studio.saveAttendance(coachSession.token, lesson.id, [
        { status: 'EXCUSED', studentId: student.id },
      ]),
    ).rejects.toThrow(t('domain.authorization.attendanceCorrection'));
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'EXCUSED', studentId: student.id },
    ]);
    expect(await database.auditLog.count({ where: { action: 'ATTENDANCE_CORRECTED' } })).toBe(1);
  });
});
