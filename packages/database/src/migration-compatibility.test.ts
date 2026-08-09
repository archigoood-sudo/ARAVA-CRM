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
    for (const statement of sql
      .split(';')
      .map((value) => value.trim())
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
    const prismaDatabase = createDatabaseClient(toSqliteUrl(join(prismaDirectory, 'database.db')));
    const runtimeDatabase = createDatabaseClient(
      toSqliteUrl(join(runtimeDirectory, 'database.db')),
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
    const database = createDatabaseClient(toSqliteUrl(join(directory, 'database.db')));
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
      ).toMatchObject({ room: null, roomId: null });
      expect(await database.room.count()).toBe(0);
      expect(await database.membershipCard.count()).toBe(0);
      expect(await database.cardEvent.count()).toBe(0);
      expect(await database.cardScanEvent.count()).toBe(0);
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
});
