import { PrismaClient } from '@prisma/client';

import { runtimeMigrations } from './runtime-migrations';
import { hashPassword } from './security';

export const INITIAL_OWNER_EMAIL = 'owner@arava.local';
export const INITIAL_OWNER_PASSWORD = 'Arava!ChangeMe1';

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
    create: { key: 'general.workspaceName', value: 'Рабочее пространство ARAVA' },
    update: {},
    where: { key: 'general.workspaceName' },
  });
  await database.appSetting.updateMany({
    data: { value: 'Рабочее пространство ARAVA' },
    where: { key: 'general.workspaceName', value: 'ARAVA Workspace' },
  });

  if ((await database.user.count()) === 0) {
    const configuredEmail = process.env.ARAVA_INITIAL_OWNER_EMAIL?.trim().toLowerCase();
    const configuredPassword = process.env.ARAVA_INITIAL_OWNER_PASSWORD;
    const email = configuredEmail?.length ? configuredEmail : INITIAL_OWNER_EMAIL;
    const password = configuredPassword?.length ? configuredPassword : INITIAL_OWNER_PASSWORD;
    await database.user.create({
      data: {
        email,
        fullName: 'Владелец ARAVA',
        mustChangePassword: true,
        passwordHash: await hashPassword(password),
        role: 'OWNER',
      },
    });
  }
  await database.user.updateMany({
    data: { fullName: 'Владелец ARAVA' },
    where: { email: INITIAL_OWNER_EMAIL, fullName: 'ARAVA Owner' },
  });

  await database.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });

  if ((await database.activityEvent.count()) === 0) {
    await database.activityEvent.create({
      data: {
        detail: 'Локальное рабочее пространство готово для филиалов, учеников и их семей.',
        title: 'ARAVA CRM готова к работе',
      },
    });
  }
  await database.activityEvent.updateMany({
    data: {
      detail: 'Локальное рабочее пространство готово для филиалов, учеников и их семей.',
      title: 'ARAVA CRM готова к работе',
    },
    where: { title: 'ARAVA CRM initialized' },
  });
}

export async function closeDatabase(database: DatabaseClient): Promise<void> {
  await database.$disconnect();
}

export { ApplicationService, isBranchVisibleToUser } from './services';
export { StudioService } from './studio-service';
export { FinanceService } from './finance-service';
export { ManagementService } from './management-service';
export {
  addDays,
  applyAttendanceWriteOff,
  reverseAttendanceWriteOffs,
  reverseLessonWriteOffs,
  subscriptionStatusAt,
} from './subscription-ledger';
export {
  combineLocalDateAndTime,
  dateRangesOverlap,
  endOfLocalDay,
  isoWeekday,
  scheduleWindowsOverlap,
  startOfLocalDay,
  timeRangesOverlap,
} from './schedule';
export {
  accessibleBranchIds,
  assertCapability,
  assertBranchAccess,
  assertPermission,
  canAccessBranch,
  type DomainAction,
} from './permissions';
export {
  createSessionToken,
  DomainError,
  type DomainErrorCode,
  hashPassword,
  hashSessionToken,
  normalizePhone,
  verifyPassword,
} from './security';
