import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudentStatus } from '@arava/shared';

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

describe('canonical group membership selectors', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-membership-selectors-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'test.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    studio = new StudioService(database, application);
    ownerToken = (
      await application.login({ email: INITIAL_OWNER_EMAIL, password: INITIAL_OWNER_PASSWORD })
    ).token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!MembershipSelectors2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function branch(name: string) {
    return application.createBranch(ownerToken, { name });
  }

  async function group(
    branchId: string,
    name: string,
    status: 'ACTIVE' | 'RECRUITING' | 'PAUSED' | 'ARCHIVED' = 'ACTIVE',
  ) {
    return database.danceGroup.create({
      data: {
        archivedAt: status === 'ARCHIVED' ? new Date() : null,
        branchId,
        capacity: 20,
        direction: 'Танцы',
        name,
        status,
      },
    });
  }

  async function student(branchId: string, firstName: string, status: StudentStatus = 'ACTIVE') {
    return database.student.create({
      data: { branchId, firstName, lastName: 'Тестов', status },
    });
  }

  it('shows every active/recruiting group except a current membership and preserves re-entry', async () => {
    const center = await branch('Центр');
    const north = await branch('Север');
    const target = await student(center.id, 'Анна');
    const current = await group(center.id, 'Текущая');
    const historical = await group(center.id, 'Историческая');
    const historicalByStatus = await group(center.id, 'Историческая по статусу');
    const empty = await group(center.id, 'Пустая');
    const recruiting = await group(center.id, 'Идёт набор', 'RECRUITING');
    await group(center.id, 'Приостановлена', 'PAUSED');
    await group(center.id, 'Архив', 'ARCHIVED');
    await group(north.id, 'Другой филиал');
    await database.enrollment.createMany({
      data: [
        {
          groupId: current.id,
          joinedAt: new Date('2026-08-01'),
          status: 'ACTIVE',
          studentId: target.id,
        },
        {
          groupId: historical.id,
          joinedAt: new Date('2025-08-01'),
          leftAt: new Date('2025-09-01'),
          status: 'LEFT',
          studentId: target.id,
        },
        {
          groupId: historicalByStatus.id,
          joinedAt: new Date('2025-10-01'),
          status: 'LEFT',
          studentId: target.id,
        },
      ],
    });

    const options = await studio.listEligibleGroupsForStudent(ownerToken, target.id);
    expect(options.map(({ id }) => id)).toEqual(
      expect.arrayContaining([historical.id, historicalByStatus.id, empty.id, recruiting.id]),
    );
    expect(options.map(({ id }) => id)).not.toContain(current.id);
    expect(options.find(({ id }) => id === empty.id)).toMatchObject({ availablePlaces: 20 });
    expect(options.find(({ id }) => id === recruiting.id)).toMatchObject({
      status: 'RECRUITING',
    });
  });

  it('shows all non-archived branch students except current members without unrelated filters', async () => {
    const center = await branch('Центр');
    const north = await branch('Север');
    const targetGroup = await group(center.id, 'Импульс');
    const current = await student(center.id, 'Текущий');
    const historical = await student(center.id, 'Вернувшийся');
    const active = await student(center.id, 'Активный');
    const trial = await student(center.id, 'Пробный', 'TRIAL');
    const frozen = await student(center.id, 'Замороженный', 'FROZEN');
    const left = await student(center.id, 'Выбывший', 'LEFT');
    const archived = await student(center.id, 'Архивный');
    await database.student.update({
      data: { archivedAt: new Date(), status: 'ARCHIVED' },
      where: { id: archived.id },
    });
    await student(north.id, 'Другой филиал');
    await database.enrollment.createMany({
      data: [
        {
          groupId: targetGroup.id,
          joinedAt: new Date('2026-08-01'),
          status: 'FROZEN',
          studentId: current.id,
        },
        {
          groupId: targetGroup.id,
          joinedAt: new Date('2025-08-01'),
          leftAt: new Date('2025-09-01'),
          status: 'LEFT',
          studentId: historical.id,
        },
      ],
    });

    const options = await studio.listEligibleStudentsForGroup(ownerToken, targetGroup.id);
    const ids = options.map(({ id }) => id);
    expect(ids).toEqual(
      expect.arrayContaining([historical.id, active.id, trial.id, frozen.id, left.id]),
    );
    expect(ids).not.toContain(current.id);
    expect(ids).not.toContain(archived.id);
  });

  it('enforces ADMIN branch scope and keeps COACH permissions unchanged', async () => {
    const center = await branch('Центр');
    const north = await branch('Север');
    const centerStudent = await student(center.id, 'Центр');
    const northStudent = await student(north.id, 'Север');
    const centerGroup = await group(center.id, 'Центр');
    const northGroup = await group(north.id, 'Север');
    const admin = await application.createUser(ownerToken, {
      branchIds: [center.id],
      email: 'admin-membership@arava.local',
      fullName: 'Администратор',
      password: 'Admin!Membership2026',
      role: 'ADMIN',
    });
    const coach = await application.createUser(ownerToken, {
      branchIds: [center.id],
      email: 'coach-membership@arava.local',
      fullName: 'Тренер',
      password: 'Coach!Membership2026',
      role: 'COACH',
    });
    const adminToken = (
      await application.login({ email: admin.email, password: 'Admin!Membership2026' })
    ).token;
    const coachToken = (
      await application.login({ email: coach.email, password: 'Coach!Membership2026' })
    ).token;
    await application.changePassword(adminToken, {
      currentPassword: 'Admin!Membership2026',
      newPassword: 'Admin!MembershipChanged2026',
    });
    await application.changePassword(coachToken, {
      currentPassword: 'Coach!Membership2026',
      newPassword: 'Coach!MembershipChanged2026',
    });

    await expect(
      studio.listEligibleGroupsForStudent(adminToken, centerStudent.id),
    ).resolves.toEqual([expect.objectContaining({ id: centerGroup.id })]);
    await expect(studio.listEligibleStudentsForGroup(adminToken, centerGroup.id)).resolves.toEqual([
      expect.objectContaining({ id: centerStudent.id }),
    ]);
    await expect(studio.listEligibleGroupsForStudent(adminToken, northStudent.id)).rejects.toThrow(
      /нет доступа/u,
    );
    await expect(studio.listEligibleStudentsForGroup(adminToken, northGroup.id)).rejects.toThrow(
      /нет доступа/u,
    );
    await expect(studio.listEligibleGroupsForStudent(coachToken, centerStudent.id)).rejects.toThrow(
      /недостаточно прав/u,
    );
    await expect(studio.listEligibleStudentsForGroup(coachToken, centerGroup.id)).rejects.toThrow(
      /недостаточно прав/u,
    );
  });

  it('returns newly created groups and students on the next selector request', async () => {
    const center = await branch('Центр');
    const firstStudent = await student(center.id, 'Первый');
    const firstGroup = await group(center.id, 'Первая');
    await expect(
      studio.listEligibleGroupsForStudent(ownerToken, firstStudent.id),
    ).resolves.toHaveLength(1);
    await expect(
      studio.listEligibleStudentsForGroup(ownerToken, firstGroup.id),
    ).resolves.toHaveLength(1);
    const secondGroup = await group(center.id, 'Новая группа', 'RECRUITING');
    const secondStudent = await student(center.id, 'Новый ученик');
    await expect(studio.listEligibleGroupsForStudent(ownerToken, firstStudent.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: secondGroup.id })]),
    );
    await expect(studio.listEligibleStudentsForGroup(ownerToken, firstGroup.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: secondStudent.id })]),
    );
  });
});
