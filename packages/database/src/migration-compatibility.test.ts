import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  toSqliteUrl,
  type DatabaseClient,
} from './index';
import { runtimeMigrations } from './runtime-migrations';

interface SqliteColumn {
  cid: bigint;
  dflt_value: string | null;
  name: string;
  notnull: bigint;
  pk: bigint;
  type: string;
}
interface SqliteForeignKey {
  from: string;
  on_delete: string;
  on_update: string;
  table: string;
  to: string;
}
interface SqliteIndex {
  name: string;
  origin: string;
  partial: bigint;
  unique: bigint;
}
interface SqliteIndexColumn {
  name: string;
}
interface SqliteIndexStructure {
  columns: string[];
  name: string;
  origin: string;
  partial: number;
  unique: number;
}
interface SqliteName {
  name: string;
}
interface SqliteTrigger {
  name: string;
  sql: string;
}

function singleConnectionSqliteUrl(databasePath: string): string {
  return `${toSqliteUrl(databasePath)}?connection_limit=1`;
}

async function applyCheckedInMigrations(
  database: DatabaseClient,
  maximumMigration = '99999999999999',
): Promise<void> {
  await database.$connect();
  const migrationsPath = resolve(import.meta.dirname, '../prisma/migrations');
  const directories = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name <= maximumMigration)
    .map((entry) => entry.name)
    .sort();
  for (const directory of directories) {
    const sql = await readFile(join(migrationsPath, directory, 'migration.sql'), 'utf8');
    for (const statement of (sql.match(/\s*CREATE\s+TRIGGER[\s\S]*?END;|[^;]+;/giu) ?? [])
      .map((value) => value.trim().replace(/;$/u, ''))
      .filter(Boolean)) {
      await database.$executeRawUnsafe(statement);
    }
  }
}

async function structure(database: DatabaseClient) {
  const tables = await database.$queryRawUnsafe<SqliteName[]>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_AppMigration') ORDER BY name`,
  );
  const result: Record<string, unknown> = {};
  for (const { name } of tables) {
    const escaped = name.replaceAll('"', '""');
    const columns = await database.$queryRawUnsafe<SqliteColumn[]>(
      `PRAGMA table_info("${escaped}")`,
    );
    const foreignKeys = await database.$queryRawUnsafe<SqliteForeignKey[]>(
      `PRAGMA foreign_key_list("${escaped}")`,
    );
    const indexes = await database.$queryRawUnsafe<SqliteIndex[]>(
      `PRAGMA index_list("${escaped}")`,
    );
    const indexStructures: SqliteIndexStructure[] = [];
    for (const index of indexes) {
      const indexColumns = await database.$queryRawUnsafe<SqliteIndexColumn[]>(
        `PRAGMA index_info("${index.name.replaceAll('"', '""')}")`,
      );
      indexStructures.push({
        columns: indexColumns.map(({ name: column }) => column),
        name: index.name,
        origin: index.origin,
        partial: Number(index.partial),
        unique: Number(index.unique),
      });
    }
    result[name] = {
      columns: columns.map((column) => ({
        default: column.dflt_value,
        name: column.name,
        notNull: Number(column.notnull),
        primary: Number(column.pk),
        type: column.type,
      })),
      foreignKeys: foreignKeys
        .map((key) => ({
          from: key.from,
          onDelete: key.on_delete,
          onUpdate: key.on_update,
          table: key.table,
          to: key.to,
        }))
        .sort((a, b) => a.from.localeCompare(b.from)),
      indexes: indexStructures,
    };
  }
  const triggers = await database.$queryRawUnsafe<SqliteTrigger[]>(
    `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name`,
  );
  result.__triggers = triggers.map(({ name, sql }) => ({
    name,
    sql: sql.replaceAll(/\s+/gu, ' ').trim(),
  }));
  return result;
}

describe('Prisma and packaged runtime migration compatibility', () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  it('produces equivalent SQLite tables, columns, foreign keys, and indexes', async () => {
    const prismaDirectory = await mkdtemp(join(tmpdir(), 'arava-prisma-'));
    const runtimeDirectory = await mkdtemp(join(tmpdir(), 'arava-runtime-'));
    directories.push(prismaDirectory, runtimeDirectory);
    const prismaDatabase = createDatabaseClient(
      singleConnectionSqliteUrl(join(prismaDirectory, 'database.db')),
    );
    const runtimeDatabase = createDatabaseClient(
      singleConnectionSqliteUrl(join(runtimeDirectory, 'database.db')),
    );
    try {
      await applyCheckedInMigrations(prismaDatabase);
      await initializeDatabase(runtimeDatabase);
      expect(await structure(runtimeDatabase)).toEqual(await structure(prismaDatabase));
    } finally {
      await Promise.all([closeDatabase(prismaDatabase), closeDatabase(runtimeDatabase)]);
    }
  }, 30_000);

  it('upgrades a Sprint 4 database in place and migrates legacy managers to ADMIN', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arava-upgrade-'));
    directories.push(directory);
    const database = createDatabaseClient(
      singleConnectionSqliteUrl(join(directory, 'database.db')),
    );
    try {
      await applyCheckedInMigrations(database, '20260807000000_sprint_4');
      await database.$executeRawUnsafe(
        `CREATE TABLE "_AppMigration" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      );
      for (const id of [
        '20260803000000_initial',
        '20260804000000_sprint_1',
        '20260805000000_sprint_2',
        '20260806000000_sprint_3',
        '20260807000000_sprint_4',
      ]) {
        await database.$executeRawUnsafe('INSERT INTO "_AppMigration" ("id") VALUES (?)', id);
      }
      await database.$executeRawUnsafe(
        `INSERT INTO "User" (
          "id", "email", "fullName", "passwordHash", "role", "isActive",
          "mustChangePassword", "createdAt", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        'legacy-manager',
        'legacy@arava.local',
        'Существующий управляющий',
        'existing-secure-hash',
        'BRANCH_MANAGER',
        true,
        false,
      );
      await database.$executeRawUnsafe(
        `INSERT INTO "User" (
          "id", "email", "fullName", "passwordHash", "role", "isActive",
          "mustChangePassword", "createdAt", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        'existing-owner',
        'owner-existing@arava.local',
        'Существующий владелец',
        'owner-secure-hash',
        'OWNER',
        true,
        false,
      );
      await database.$executeRawUnsafe(
        `INSERT INTO "Branch" (
          "id", "name", "address", "phone", "isActive", "createdAt", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        'existing-branch',
        'Существующий филиал',
        'Существующий адрес',
        '+79990000000',
        true,
      );
      await database.$executeRawUnsafe(
        'INSERT INTO "UserBranch" ("userId", "branchId") VALUES (?, ?)',
        'legacy-manager',
        'existing-branch',
      );
      await database.$executeRawUnsafe(
        `INSERT INTO "DanceGroup" (
          "id", "name", "branchId", "direction", "capacity", "status", "createdAt", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        'existing-group',
        'Существующая группа',
        'existing-branch',
        'Хип-хоп',
        20,
        'ACTIVE',
      );
      await database.$executeRawUnsafe(
        `INSERT INTO "Lesson" (
          "id", "groupId", "branchId", "startsAt", "endsAt", "status", "createdAt", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        'existing-lesson-without-room',
        'existing-group',
        'existing-branch',
        '2026-08-01T15:00:00.000Z',
        '2026-08-01T16:00:00.000Z',
        'COMPLETED',
      );
      await initializeDatabase(database);
      const upgraded = await database.user.findUniqueOrThrow({
        where: { id: 'legacy-manager' },
      });

      expect(upgraded).toMatchObject({
        email: 'legacy@arava.local',
        failedLoginAttempts: 0,
        role: 'ADMIN',
        securityVersion: 1,
      });
      expect(upgraded.passwordHash).toBe('existing-secure-hash');
      expect(
        await database.userBranch.findUniqueOrThrow({
          where: {
            userId_branchId: { branchId: 'existing-branch', userId: 'legacy-manager' },
          },
        }),
      ).toMatchObject({ branchId: 'existing-branch', userId: 'legacy-manager' });
      expect(await database.user.count({ where: { role: 'OWNER' } })).toBe(1);
      expect(await database.student.count()).toBe(0);
      expect(
        await database.lesson.findUniqueOrThrow({ where: { id: 'existing-lesson-without-room' } }),
      ).toMatchObject({ attendanceCompletedAt: null, room: null, roomId: null });
      expect(await database.room.count()).toBe(0);
      expect(await database.membershipCard.count()).toBe(0);
      expect(await database.cardEvent.count()).toBe(0);
      expect(await database.cardScanEvent.count()).toBe(0);
      expect(await database.studentNote.count()).toBe(0);
      expect(
        await database.branch.findUniqueOrThrow({ where: { id: 'existing-branch' } }),
      ).toMatchObject({
        name: 'Существующий филиал',
      });
      expect(await database.$queryRawUnsafe(`PRAGMA integrity_check`)).toEqual([
        { integrity_check: 'ok' },
      ]);
    } finally {
      await closeDatabase(database);
    }
  }, 30_000);

  it('upgrades the current production schema in place and preserves operational and device settings data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arava-integration-upgrade-'));
    directories.push(directory);
    const database = createDatabaseClient(
      singleConnectionSqliteUrl(join(directory, 'database.db')),
    );
    try {
      await applyCheckedInMigrations(database, '20260811010000_sprint_4_2a');
      await database.$executeRawUnsafe(
        `CREATE TABLE "_AppMigration" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      );
      for (const { id } of runtimeMigrations.filter(
        ({ id }) =>
          id !== '20260818000000_sprint_4_4a' &&
          id !== '20260818020000_sprint_4_4d' &&
          id !== '20260818030000_sprint_4_5a' &&
          id !== '20260822000000_trainer_sync_1' &&
          id !== '20260828010000_student_documents',
      )) {
        await database.$executeRawUnsafe('INSERT INTO "_AppMigration" ("id") VALUES (?)', id);
      }
      await database.$executeRawUnsafe(
        `INSERT INTO "Branch" (
          "id", "name", "address", "phone", "isActive", "createdAt", "updatedAt"
        ) VALUES (
          'preserved-branch', 'Сохранённый филиал', '', '', true,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
      );
      await database.$executeRawUnsafe(
        `INSERT INTO "Student" (
          "id", "firstName", "lastName", "status", "branchId", "createdAt", "updatedAt"
        ) VALUES (
          'preserved-student', 'Ирина', 'Сохранённая', 'ACTIVE', 'preserved-branch',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
      );
      await database.$executeRawUnsafe(
        `INSERT INTO "AppSetting" ("key", "value", "updatedAt")
         VALUES ('customerDisplay.enabled', 'true', CURRENT_TIMESTAMP)`,
      );
      await initializeDatabase(database);
      expect(
        await database.student.findUnique({ where: { id: 'preserved-student' } }),
      ).toMatchObject({ firstName: 'Ирина' });
      expect(
        await database.appSetting.findUnique({ where: { key: 'customerDisplay.enabled' } }),
      ).toMatchObject({ value: 'true' });
      expect(await database.syncOutbox.count()).toBe(0);
      expect(await database.publication.count()).toBe(0);
      expect(await database.studentDocument.count()).toBe(0);
      await database.branch.update({
        data: { name: 'Обновлённый филиал' },
        where: { id: 'preserved-branch' },
      });
      expect(await database.syncOutbox.count({ where: { entityId: 'preserved-branch' } })).toBe(1);
      await database.danceGroup.create({
        data: {
          branchId: 'preserved-branch',
          direction: 'Тест',
          id: 'sync-test-group',
          name: 'Проверка',
        },
      });
      await database.lesson.create({
        data: {
          branchId: 'preserved-branch',
          endsAt: new Date('2026-08-18T11:00:00.000Z'),
          groupId: 'sync-test-group',
          id: 'sync-test-lesson',
          startsAt: new Date('2026-08-18T10:00:00.000Z'),
        },
      });
      await database.lesson.update({
        data: { cancellationReason: 'Проверка синхронизации', status: 'CANCELLED' },
        where: { id: 'sync-test-lesson' },
      });
      expect(
        await database.syncOutbox.findFirstOrThrow({
          orderBy: { createdAt: 'desc' },
          where: { entityId: 'sync-test-lesson', entityType: 'LESSON' },
        }),
      ).toMatchObject({ operation: 'UPSERT' });
    } finally {
      await closeDatabase(database);
    }
  }, 30_000);
});
