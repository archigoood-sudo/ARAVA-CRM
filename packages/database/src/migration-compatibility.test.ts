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
interface SqliteName {
  name: string;
}

async function applyCheckedInMigrations(database: DatabaseClient): Promise<void> {
  await database.$connect();
  const migrationsPath = resolve(import.meta.dirname, '../prisma/migrations');
  const directories = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
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
      indexes: await Promise.all(
        indexes.map(async (index) => ({
          columns: (
            await database.$queryRawUnsafe<SqliteIndexColumn[]>(
              `PRAGMA index_info("${index.name.replaceAll('"', '""')}")`,
            )
          ).map(({ name: column }) => column),
          name: index.name,
          origin: index.origin,
          partial: Number(index.partial),
          unique: Number(index.unique),
        })),
      ),
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
});
