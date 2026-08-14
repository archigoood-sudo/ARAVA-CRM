import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BackupService } from './backup-service';
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
import { runtimeMigrations } from './runtime-migrations';

describe('Sprint 4.3A local backup and restore', () => {
  let application: ApplicationService;
  let backups: BackupService;
  let database: DatabaseClient;
  let databasePath: string;
  let directory: string;
  let now: Date;
  let ownerToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-backup-'));
    databasePath = join(directory, 'arava.db');
    database = createDatabaseClient(`${toSqliteUrl(databasePath)}?connection_limit=1`);
    await initializeDatabase(database);
    application = new ApplicationService(database);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Backup2026',
    });
    now = new Date('2026-08-14T16:30:00.000Z');
    backups = new BackupService(database, application, {
      databasePath,
      defaultBackupDirectory: join(directory, 'backups'),
      externalLogPath: join(directory, 'backup-restore.log'),
      now: () => now,
    });
    await backups.initializePreferences();
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  it('creates and validates a consistent self-contained backup while WAL database stays active', async () => {
    await database.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    await application.createBranch(ownerToken, { name: 'До копии' });

    const backup = await backups.createManualBackup(ownerToken);
    expect(backup.fileName).toMatch(/^ARAVA-CRM-backup-2026-08-14-\d{2}-30-00\.db$/u);
    expect(backup.integrity).toBe('VALID');
    expect((await stat(backup.location)).size).toBeGreaterThan(0);
    expect((await readFile(backup.location)).subarray(0, 16).toString()).toBe('SQLite format 3\0');

    await application.createBranch(ownerToken, { name: 'После копии' });
    const snapshot = createDatabaseClient(`${toSqliteUrl(backup.location)}?connection_limit=1`);
    try {
      await snapshot.$connect();
      expect(await snapshot.$queryRawUnsafe('PRAGMA quick_check')).toEqual([{ quick_check: 'ok' }]);
      expect((await snapshot.branch.findMany()).map(({ name }) => name)).toEqual(['До копии']);
    } finally {
      await closeDatabase(snapshot);
    }
    expect((await application.listBranches(ownerToken)).map(({ name }) => name)).toEqual([
      'До копии',
      'После копии',
    ]);
  });

  it('stages, migrates and atomically restores a backup after creating a safety copy', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Основной' });
    await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Анна',
      lastName: 'ДоКопии',
      status: 'ACTIVE',
    });
    const source = await backups.createManualBackup(ownerToken);
    await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Борис',
      lastName: 'ПослеКопии',
      status: 'ACTIVE',
    });

    const selection = await backups.selectManagedBackup(ownerToken, source.id);
    expect(selection.canRestore).toBe(true);
    await expect(
      backups.restoreBackup(ownerToken, selection.selectionId, 'неверно'),
    ).rejects.toThrow('ВОССТАНОВИТЬ');
    const result = await backups.restoreBackup(ownerToken, selection.selectionId, 'ВОССТАНОВИТЬ');

    expect(result.safetyBackup.type).toBe('RESTORE_SAFETY');
    expect((await database.student.findMany()).map(({ lastName }) => lastName)).toEqual([
      'ДоКопии',
    ]);
    expect(await database.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([
      { integrity_check: 'ok' },
    ]);
    expect((await stat(result.safetyBackup.location)).size).toBeGreaterThan(0);
    expect(await readFile(join(directory, 'backup-restore.log'), 'utf8')).toContain(
      'Восстановление завершено',
    );
  });

  it('rejects empty, corrupt, unrelated and newer databases without changing production data', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Неизменный филиал' });
    const empty = join(directory, 'empty.db');
    const text = join(directory, 'text.db');
    const corrupt = join(directory, 'corrupt.db');
    const unrelated = join(directory, 'unrelated.db');
    await writeFile(empty, '');
    await writeFile(text, 'это не база данных'.repeat(20));
    await writeFile(corrupt, `SQLite format 3\0${'x'.repeat(200)}`);
    const unrelatedDatabase = createDatabaseClient(`${toSqliteUrl(unrelated)}?connection_limit=1`);
    await unrelatedDatabase.$executeRawUnsafe('CREATE TABLE Example (id TEXT PRIMARY KEY)');
    await closeDatabase(unrelatedDatabase);

    for (const path of [empty, text, corrupt, unrelated]) {
      const result = await backups.selectExternalBackup(ownerToken, path);
      expect(result.canRestore).toBe(false);
    }

    const current = await backups.createManualBackup(ownerToken);
    const newer = join(directory, 'newer.db');
    await copyFile(current.location, newer);
    const newerDatabase = createDatabaseClient(`${toSqliteUrl(newer)}?connection_limit=1`);
    await newerDatabase.$executeRawUnsafe(
      'INSERT INTO "_AppMigration" ("id") VALUES (?)',
      '99999999999999_future',
    );
    await closeDatabase(newerDatabase);
    const newerResult = await backups.selectExternalBackup(ownerToken, newer);
    expect(newerResult).toMatchObject({ canRestore: false, integrity: 'VALID' });
    expect(newerResult.message).toContain('более новой версии');
    expect(await database.branch.findUnique({ where: { id: branch.id } })).not.toBeNull();
  });

  it('restores an older ARAVA schema through forward runtime migrations without changing the source', async () => {
    const oldPath = join(directory, 'ARAVA-CRM-backup-old.db');
    const oldDatabase = createDatabaseClient(`${toSqliteUrl(oldPath)}?connection_limit=1`);
    await oldDatabase.$executeRawUnsafe(
      `CREATE TABLE "_AppMigration" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    for (const migration of runtimeMigrations.filter(
      ({ id }) => id <= '20260809020000_sprint_4_1c',
    )) {
      await oldDatabase.$transaction(async (transaction) => {
        for (const statement of migration.statements)
          await transaction.$executeRawUnsafe(statement);
        await transaction.$executeRawUnsafe(
          'INSERT INTO "_AppMigration" ("id") VALUES (?)',
          migration.id,
        );
      });
    }
    await oldDatabase.appSetting.create({
      data: { key: 'test.restoreMarker', value: 'старые данные' },
    });
    await closeDatabase(oldDatabase);
    const original = await readFile(oldPath);

    const selection = await backups.selectExternalBackup(ownerToken, oldPath);
    expect(selection).toMatchObject({ canRestore: true });
    await backups.restoreBackup(ownerToken, selection.selectionId, 'ВОССТАНОВИТЬ');

    expect(
      await database.appSetting.findUnique({ where: { key: 'test.restoreMarker' } }),
    ).toMatchObject({ value: 'старые данные' });
    expect(await database.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([
      { integrity_check: 'ok' },
    ]);
    expect(await readFile(oldPath)).toEqual(original);
  });

  it('runs once daily, retains only configured automatic copies and denies non-owners', async () => {
    await database.appSetting.upsert({
      create: { key: 'backup.retentionCount', value: '2' },
      update: { value: '2' },
      where: { key: 'backup.retentionCount' },
    });
    await expect(backups.runAutomaticBackup()).resolves.toBeDefined();
    await expect(backups.runAutomaticBackup()).resolves.toBeUndefined();
    now = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    await backups.runAutomaticBackup();
    now = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    await backups.runAutomaticBackup();
    expect(
      (await backups.listBackups(ownerToken)).filter(({ type }) => type === 'AUTOMATIC'),
    ).toHaveLength(2);

    const branch = await application.createBranch(ownerToken, { name: 'Права' });
    const admin = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'admin-backup@arava.local',
      fullName: 'Администратор',
      password: 'Admin!Backup2026',
      role: 'ADMIN',
    });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach-backup@arava.local',
      fullName: 'Тренер',
      password: 'Coach!Backup2026',
      role: 'COACH',
    });
    for (const credentials of [
      { email: admin.email, password: 'Admin!Backup2026' },
      { email: coach.email, password: 'Coach!Backup2026' },
    ]) {
      const session = await application.login(credentials);
      await application.changePassword(session.token, {
        currentPassword: credentials.password,
        newPassword: `${credentials.password}Changed!`,
      });
      await expect(backups.getStatus(session.token)).rejects.toThrow('недостаточно прав');
      await expect(backups.createManualBackup(session.token)).rejects.toThrow('недостаточно прав');
    }
  });

  it('falls back locally when a configured external folder disappears', async () => {
    const external = join(directory, 'usb-backups');
    await backups.setBackupDirectory(ownerToken, external);
    await rm(external, { recursive: true });
    await writeFile(external, 'Путь занят файлом');

    const automatic = await backups.runAutomaticBackup();
    expect(automatic?.location.startsWith(join(directory, 'backups'))).toBe(true);
    expect(await backups.getStatus(ownerToken)).toMatchObject({
      consecutiveFailures: 1,
      usingLocalFallback: true,
    });
    expect((await backups.listBackups(ownerToken)).some(({ type }) => type === 'AUTOMATIC')).toBe(
      true,
    );
  });
});
