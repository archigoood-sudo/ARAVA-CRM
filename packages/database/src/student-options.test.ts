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

describe('student selector options', () => {
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let service: ApplicationService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-student-options-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'test.db')));
    await initializeDatabase(database);
    service = new ApplicationService(database);
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await service.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Options2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  it('returns the complete non-archived branch-scoped dataset without pagination', async () => {
    const branchA = await service.createBranch(ownerToken, { name: 'Филиал A' });
    const branchB = await service.createBranch(ownerToken, { name: 'Филиал B' });
    await database.student.createMany({
      data: [
        ...Array.from({ length: 101 }, (_, index) => ({
          branchId: branchA.id,
          firstName: `Имя ${String(index).padStart(3, '0')}`,
          lastName: 'Ученик',
          status: 'ACTIVE' as const,
        })),
        {
          archivedAt: new Date(),
          branchId: branchA.id,
          firstName: 'Архивный',
          lastName: 'Ученик',
          status: 'ARCHIVED' as const,
        },
        ...Array.from({ length: 3 }, (_, index) => ({
          branchId: branchB.id,
          firstName: `Другой ${String(index)}`,
          lastName: 'Ученик',
          status: 'ACTIVE' as const,
        })),
      ],
    });
    await service.createUser(ownerToken, {
      branchIds: [branchA.id],
      email: 'admin-options@arava.local',
      fullName: 'Администратор',
      password: 'Admin!Options2026',
      role: 'ADMIN',
    });
    const admin = await service.login({
      email: 'admin-options@arava.local',
      password: 'Admin!Options2026',
    });
    await service.changePassword(admin.token, {
      currentPassword: 'Admin!Options2026',
      newPassword: 'Admin!OptionsChanged2026',
    });

    expect(await service.listStudentOptions(ownerToken)).toHaveLength(104);
    expect(await service.listStudentOptions(ownerToken, branchB.id)).toHaveLength(3);
    expect(await service.listStudentOptions(admin.token)).toHaveLength(101);
    await expect(service.listStudentOptions(admin.token, branchB.id)).rejects.toThrow();
  });
});
