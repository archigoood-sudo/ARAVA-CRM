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

describe('Sprint 4.1A security workflows', () => {
  let database: DatabaseClient;
  let directory: string;
  let service: ApplicationService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-security-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'security.db')));
    await initializeDatabase(database);
    service = new ApplicationService(database);
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function secureOwner() {
    const initial = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    return service.completePasswordChange(initial.token, { newPassword: 'Owner!Secure2041' });
  }

  it('locks repeated login attempts temporarily and clears the counter after success', async () => {
    await secureOwner();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        service.login({ email: INITIAL_OWNER_EMAIL, password: 'Wrong!Password2041' }),
      ).rejects.toThrow();
    }
    const locked = await database.user.findUniqueOrThrow({
      where: { email: INITIAL_OWNER_EMAIL },
    });
    expect(locked.failedLoginAttempts).toBe(5);
    expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    await expect(
      service.login({ email: INITIAL_OWNER_EMAIL, password: 'Owner!Secure2041' }),
    ).rejects.toThrow();

    await database.user.update({
      data: { lockedUntil: new Date(Date.now() - 1) },
      where: { id: locked.id },
    });
    await expect(
      service.login({ email: INITIAL_OWNER_EMAIL, password: 'Owner!Secure2041' }),
    ).resolves.toMatchObject({ user: { role: 'OWNER' } });
    const unlocked = await database.user.findUniqueOrThrow({ where: { id: locked.id } });
    expect(unlocked.failedLoginAttempts).toBe(0);
    expect(unlocked.lockedUntil).toBeNull();
    expect(unlocked.lastLoginAt).not.toBeNull();
  });

  it('generates temporary passwords, enforces role boundaries, and revokes sessions', async () => {
    const owner = await secureOwner();
    const branch = await service.createBranch(owner.token, {
      address: 'Улица Мира, 1',
      name: 'Центр',
      phone: '+79990000001',
    });
    const admin = await service.createUserWithTemporaryPassword(owner.token, {
      branchIds: [branch.id],
      email: 'admin@arava.local',
      fullName: 'Администратор',
      role: 'ADMIN',
    });
    expect(admin.temporaryPassword).toMatch(/[A-Z]/u);
    expect(admin.user).not.toHaveProperty('passwordHash');
    const adminLogin = await service.login({
      email: admin.user.email,
      password: admin.temporaryPassword,
    });
    const activeAdmin = await service.completePasswordChange(adminLogin.token, {
      newPassword: 'Admin!Secure2041',
    });
    await expect(
      service.createUserWithTemporaryPassword(activeAdmin.token, {
        branchIds: [branch.id],
        email: 'second-admin@arava.local',
        fullName: 'Другой администратор',
        role: 'ADMIN',
      }),
    ).rejects.toThrow();
    const coach = await service.createUserWithTemporaryPassword(activeAdmin.token, {
      branchIds: [branch.id],
      email: 'coach-security@arava.local',
      fullName: 'Тренер',
      role: 'COACH',
    });
    const coachLogin = await service.login({
      email: coach.user.email,
      password: coach.temporaryPassword,
    });
    await service.revokeUserSessions(activeAdmin.token, coach.user.id);
    await expect(service.restoreSession(coachLogin.token)).rejects.toThrow();
    await expect(service.resetUserPassword(activeAdmin.token, admin.user.id)).rejects.toThrow();
    const storedCoach = await database.user.findUniqueOrThrow({ where: { id: coach.user.id } });
    expect(storedCoach.passwordHash).not.toContain(coach.temporaryPassword);
    await expect(
      service.updateUser(owner.token, owner.user.id, {
        branchIds: [],
        fullName: owner.user.fullName,
        isActive: false,
        role: 'OWNER',
      }),
    ).rejects.toThrow();
    await expect(
      service.updateUser(owner.token, owner.user.id, {
        branchIds: [],
        fullName: owner.user.fullName,
        isActive: true,
        role: 'ADMIN',
      }),
    ).rejects.toThrow();
  });

  it('recovers the owner offline, rotates the code, and never audits secrets', async () => {
    const owner = await secureOwner();
    const first = await service.createRecoveryCode(owner.token);
    const stored = await database.user.findUniqueOrThrow({ where: { id: owner.user.id } });
    expect(stored.recoveryCodeHash).not.toBe(first.recoveryCode);
    expect(stored.recoveryCodeHash).not.toContain(first.recoveryCode);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        service.recoverOwner({
          email: INITIAL_OWNER_EMAIL,
          newPassword: 'Owner!Recovered2041',
          recoveryCode: 'WRONG-RECOVERY-CODE-2041',
        }),
      ).rejects.toThrow();
    }
    const recoveryLocked = await database.user.findUniqueOrThrow({ where: { id: owner.user.id } });
    expect(recoveryLocked.recoveryLockedUntil?.getTime()).toBeGreaterThan(Date.now());
    await database.user.update({
      data: { recoveryLockedUntil: new Date(Date.now() - 1) },
      where: { id: owner.user.id },
    });
    const recovered = await service.recoverOwner({
      email: INITIAL_OWNER_EMAIL,
      newPassword: 'Owner!Recovered2041',
      recoveryCode: first.recoveryCode,
    });
    expect(recovered.recoveryCode).not.toBe(first.recoveryCode);
    await expect(service.restoreSession(owner.token)).rejects.toThrow();
    await expect(
      service.login({ email: INITIAL_OWNER_EMAIL, password: 'Owner!Secure2041' }),
    ).rejects.toThrow();
    await expect(
      service.login({ email: INITIAL_OWNER_EMAIL, password: 'Owner!Recovered2041' }),
    ).resolves.toMatchObject({ user: { mustChangePassword: false } });
    await expect(
      service.recoverOwner({
        email: INITIAL_OWNER_EMAIL,
        newPassword: 'Owner!Another2041',
        recoveryCode: first.recoveryCode,
      }),
    ).rejects.toThrow();
    const audit = await database.auditLog.findMany({ select: { detail: true } });
    expect(JSON.stringify(audit)).not.toContain(first.recoveryCode);
    expect(JSON.stringify(audit)).not.toContain('Owner!Recovered2041');
  });
});
