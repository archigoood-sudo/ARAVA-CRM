import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ApplicationService,
  closeDatabase,
  createDatabaseClient,
  hashPassword,
  initializeDatabase,
  INITIAL_OWNER_EMAIL,
  INITIAL_OWNER_PASSWORD,
  toSqliteUrl,
  type DatabaseClient,
} from '@arava/database';

import { EmergencyOwnerRecovery } from './emergency-owner-recovery';

describe('one-time local OWNER recovery', () => {
  let database: DatabaseClient;
  let databasePath: string;
  let directory: string;
  let ownerId: string;
  let ownerToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-emergency-owner-'));
    databasePath = join(directory, 'arava.db');
    database = createDatabaseClient(toSqliteUrl(databasePath));
    await initializeDatabase(database);
    const service = new ApplicationService(database);
    const initial = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerId = initial.user.id;
    await service.changePassword(initial.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!BeforeEmergency2026',
    });
    ownerToken = initial.token;
  });

  afterEach(async () => {
    await closeDatabase(database);
  });

  it('backs up a WAL database, changes only existing OWNER security, and preserves FAILED', async () => {
    const service = new ApplicationService(database);
    const branch = await service.createBranch(ownerToken, { name: 'Preserved branch' });
    await database.syncOutbox.create({
      data: {
        entityId: 'legacy-attendance',
        entityType: 'ATTENDANCE',
        idempotencyKey: 'emergency-preserved-failure',
        nextAttemptAt: new Date(),
        operation: 'UPSERT',
        payloadJson: '{}',
        payloadVersion: 1,
        status: 'FAILED',
        updatedAt: new Date(),
      },
    });
    const original = await database.user.findUniqueOrThrow({ where: { id: ownerId } });
    const recovery = new EmergencyOwnerRecovery(database, databasePath, true, () =>
      Promise.resolve(true),
    );
    const preview = await recovery.prepare();
    expect(preview).toMatchObject({ ownerId, failed: 1 });
    expect((await stat(preview.backupPath)).size).toBeGreaterThan(100);
    await expect(
      recovery.reset(preview.ticket, 'Owner!AfterEmergency2026', 'ВОССТАНОВИТЬ ВЛАДЕЛЬЦА'),
    ).rejects.toThrow();
    await recovery.authorize(preview.ticket);
    const result = await recovery.reset(
      preview.ticket,
      'Owner!AfterEmergency2026',
      'ВОССТАНОВИТЬ ВЛАДЕЛЬЦА',
    );
    expect(result).toMatchObject({ ownerId, failedBefore: 1, failedAfter: 1 });
    expect(result.recoveryCode.length).toBeGreaterThan(16);
    expect(await database.user.count({ where: { role: 'OWNER' } })).toBe(1);
    const changed = await database.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(changed.passwordHash).not.toBe(original.passwordHash);
    expect(changed.recoveryCodeHash).not.toContain(result.recoveryCode);
    expect(changed.securityVersion).toBe(original.securityVersion + 1);
    expect(await database.branch.findUnique({ where: { id: branch.id } })).not.toBeNull();
    expect(await database.syncOutbox.count({ where: { status: 'FAILED' } })).toBe(1);
    await expect(service.restoreSession(ownerToken)).rejects.toThrow();
    await expect(
      service.login({ email: INITIAL_OWNER_EMAIL, password: 'Owner!AfterEmergency2026' }),
    ).resolves.toMatchObject({ user: { id: ownerId } });
    expect(await recovery.available()).toBe(false);
  });

  it('blocks backup failure before any credential mutation', async () => {
    const obstruction = join(directory, 'not-a-directory');
    await writeFile(obstruction, 'blocked');
    const recovery = new EmergencyOwnerRecovery(database, join(obstruction, 'arava.db'), true, () =>
      Promise.resolve(true),
    );
    const before = await database.user.findUniqueOrThrow({ where: { id: ownerId } });
    await expect(recovery.prepare()).rejects.toThrow();
    const after = await database.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('blocks ambiguous OWNER state before creating a backup', async () => {
    await database.user.create({
      data: {
        email: 'second-owner@example.local',
        fullName: 'Second owner',
        passwordHash: await hashPassword('Second!Owner2026'),
        role: 'OWNER',
      },
    });
    const recovery = new EmergencyOwnerRecovery(database, databasePath, true, () =>
      Promise.resolve(true),
    );
    await expect(recovery.prepare()).rejects.toThrow('ровно один');
  });

  it('blocks a failed SQLite integrity check and denied UAC', async () => {
    const invalid = new EmergencyOwnerRecovery(
      database,
      databasePath,
      true,
      () => Promise.resolve(true),
      () => Promise.reject(new Error('corrupt SQLite')),
    );
    await expect(invalid.prepare()).rejects.toThrow('corrupt SQLite');
    const denied = new EmergencyOwnerRecovery(database, databasePath, true, () =>
      Promise.resolve(false),
    );
    const preview = await denied.prepare();
    await expect(denied.authorize(preview.ticket)).rejects.toThrow('не подтвердил');
    await expect(
      denied.reset(preview.ticket, 'Owner!AfterEmergency2026', 'ВОССТАНОВИТЬ ВЛАДЕЛЬЦА'),
    ).rejects.toThrow();
  });

  it('refuses reset if SyncOutbox changes after the verified backup', async () => {
    const recovery = new EmergencyOwnerRecovery(database, databasePath, true, () =>
      Promise.resolve(true),
    );
    const preview = await recovery.prepare();
    await recovery.authorize(preview.ticket);
    await database.syncOutbox.create({
      data: {
        entityId: 'later-attendance',
        entityType: 'ATTENDANCE',
        idempotencyKey: 'later-failed-row',
        nextAttemptAt: new Date(),
        operation: 'UPSERT',
        payloadJson: '{}',
        payloadVersion: 1,
        status: 'FAILED',
        updatedAt: new Date(),
      },
    });
    const before = await database.user.findUniqueOrThrow({ where: { id: ownerId } });
    await expect(
      recovery.reset(preview.ticket, 'Owner!AfterEmergency2026', 'ВОССТАНОВИТЬ ВЛАДЕЛЬЦА'),
    ).rejects.toThrow('FAILED изменилось');
    const after = await database.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await database.syncOutbox.count({ where: { status: 'FAILED' } })).toBe(1);
  });
});
