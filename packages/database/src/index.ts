import { PrismaClient } from '@prisma/client';

import { runtimeMigrations } from './runtime-migrations';

export type DatabaseClient = PrismaClient;

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  return new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export function toSqliteUrl(databasePath: string): string {
  const normalizedPath = databasePath.replaceAll('\\', '/');
  return `file:${normalizedPath}`;
}

export async function initializeDatabase(database: DatabaseClient): Promise<void> {
  await database.$connect();
  await database.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "_AppMigration" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  for (const migration of runtimeMigrations) {
    const applied = await database.$queryRawUnsafe<{ id: string }[]>(
      'SELECT "id" FROM "_AppMigration" WHERE "id" = ? LIMIT 1',
      migration.id,
    );

    if (applied.length > 0) continue;

    await database.$transaction(async (transaction) => {
      for (const statement of migration.statements) {
        await transaction.$executeRawUnsafe(statement);
      }

      await transaction.$executeRawUnsafe(
        'INSERT INTO "_AppMigration" ("id") VALUES (?)',
        migration.id,
      );
    });
  }

  await database.appSetting.upsert({
    create: { key: 'general.workspaceName', value: 'ARAVA Workspace' },
    update: {},
    where: { key: 'general.workspaceName' },
  });

  if ((await database.activityEvent.count()) === 0) {
    await database.activityEvent.create({
      data: {
        detail: 'Your CRM workspace is ready for contacts, companies, and opportunities.',
        title: 'ARAVA CRM initialized',
      },
    });
  }
}

export async function closeDatabase(database: DatabaseClient): Promise<void> {
  await database.$disconnect();
}
