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

describe('Sprint 1 application service', () => {
  let directory: string;
  let database: DatabaseClient;
  let service: ApplicationService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-services-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'test.db')));
    await initializeDatabase(database);
    service = new ApplicationService(database);
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  it('seeds one owner, never returns its hash, and restores and revokes sessions', async () => {
    const session = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    expect(session.user).toMatchObject({ mustChangePassword: true, role: 'OWNER' });
    expect(session).not.toHaveProperty('passwordHash');
    expect(session.user).not.toHaveProperty('passwordHash');
    await expect(service.restoreSession(session.token)).resolves.toEqual(session.user);
    await expect(service.listBranches(session.token)).rejects.toThrow(
      t('domain.authorization.passwordChange'),
    );
    await service.logout(session.token);
    await expect(service.restoreSession(session.token)).rejects.toThrow(
      t('domain.authentication.sessionExpired'),
    );
  });

  it('requires the initial password change and rejects disabled accounts', async () => {
    const ownerSession = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    const changed = await service.changePassword(ownerSession.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Secure2026',
    });
    expect(changed.mustChangePassword).toBe(false);
    const branch = await service.createBranch(ownerSession.token, {
      address: '1 Studio Street',
      name: 'Central',
      phone: '+7 999 111-22-33',
    });
    const coach = await service.createUser(ownerSession.token, {
      branchIds: [branch.id],
      email: 'coach@arava.local',
      fullName: 'Test Coach',
      password: 'Coach!Secure2026',
      role: 'COACH',
    });
    await service.updateUser(ownerSession.token, coach.id, {
      branchIds: [branch.id],
      fullName: coach.fullName,
      isActive: false,
      role: 'COACH',
    });
    await expect(
      service.login({ email: coach.email, password: 'Coach!Secure2026' }),
    ).rejects.toThrow(t('domain.authentication.invalidCredentials'));
    const storedOwner = await database.user.findUniqueOrThrow({
      where: { email: INITIAL_OWNER_EMAIL },
    });
    expect(storedOwner.passwordHash).not.toContain(INITIAL_OWNER_PASSWORD);
  });

  it('enforces branch management, scoped student access, coach read-only access, and contact invariants', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Secure2026',
    });
    const branchA = await service.createBranch(owner.token, {
      address: 'A street',
      name: 'A',
      phone: '+7 999 000-00-01',
    });
    const branchB = await service.createBranch(owner.token, {
      address: 'B street',
      name: 'B',
      phone: '+7 999 000-00-02',
    });
    await service.createUser(owner.token, {
      branchIds: [branchA.id],
      email: 'manager@arava.local',
      fullName: 'Manager',
      password: 'Manager!Pass2026',
      role: 'ADMIN',
    });
    const createdCoach = await service.createUser(owner.token, {
      branchIds: [branchA.id],
      email: 'coach@arava.local',
      fullName: 'Coach',
      password: 'Coach!Secure2026',
      role: 'COACH',
    });
    const manager = await service.login({
      email: 'manager@arava.local',
      password: 'Manager!Pass2026',
    });
    const coach = await service.login({ email: 'coach@arava.local', password: 'Coach!Secure2026' });
    await service.changePassword(manager.token, {
      currentPassword: 'Manager!Pass2026',
      newPassword: 'Manager!Changed2026',
    });
    await service.changePassword(coach.token, {
      currentPassword: 'Coach!Secure2026',
      newPassword: 'Coach!Changed2026',
    });
    await expect(
      service.createBranch(manager.token, { address: 'X', name: 'X', phone: '+79990000009' }),
    ).resolves.toMatchObject({ name: 'X' });
    await expect(
      service.createStudent(manager.token, {
        branchId: branchB.id,
        firstName: 'No',
        lastName: 'Access',
        status: 'ACTIVE',
      }),
    ).rejects.toThrow(t('domain.authorization.branchDenied'));
    const student = await service.createStudent(manager.token, {
      branchId: branchA.id,
      firstName: 'Mila',
      lastName: 'Stone',
      phone: '+7 (999) 444-33-22',
      status: 'ACTIVE',
    });
    const studio = new StudioService(database, service);
    const group = await studio.createGroup(owner.token, {
      branchId: branchA.id,
      capacity: 20,
      coachId: createdCoach.id,
      direction: 'Современный танец',
      name: 'Тестовая группа',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(owner.token, group.id, {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    await expect(service.getStudent(coach.token, student.id)).resolves.toMatchObject({
      id: student.id,
    });
    await expect(
      service.updateStudent(coach.token, student.id, { ...student, firstName: 'Blocked' }),
    ).rejects.toThrow(t('domain.authorization.permissionDenied'));
    const first = await service.createContact(manager.token, student.id, {
      fullName: 'First Parent',
      isPrimary: true,
      phone: '+7 (999) 555-11-11',
      relationship: 'Mother',
      whatsapp: true,
    });
    const second = await service.createContact(manager.token, student.id, {
      fullName: 'Second Parent',
      isPrimary: true,
      phone: '+7 (999) 555-22-22',
      relationship: 'Father',
      whatsapp: false,
    });
    const detail = await service.getStudent(manager.token, student.id);
    expect(detail.contacts.filter(({ isPrimary }) => isPrimary)).toHaveLength(1);
    expect(detail.contacts.find(({ id }) => id === first.id)?.isPrimary).toBe(false);
    expect(detail.contacts.find(({ id }) => id === second.id)?.phone).toBe('+79995552222');
  });
});
