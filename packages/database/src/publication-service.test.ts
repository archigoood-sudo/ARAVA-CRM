import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PublicationService } from './publication-service';
import { ApplicationService } from './services';
import { StudioService } from './studio-service';
import {
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  INITIAL_OWNER_EMAIL,
  INITIAL_OWNER_PASSWORD,
  toSqliteUrl,
  type DatabaseClient,
} from './index';

describe('PublicationService', () => {
  let database: DatabaseClient;
  let directory: string;
  let application: ApplicationService;
  let ownerToken: string;
  let publications: PublicationService;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-publications-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'arava.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    studio = new StudioService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Publications2026',
    });
    publications = new PublicationService(database, application);
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  it('keeps drafts local and queues published edits and archives transactionally', async () => {
    const draft = await publications.create(ownerToken, {
      audienceMode: 'ALL_CLIENTS',
      body: 'Важная новость',
      targetIds: [],
      title: 'Новость ARAVA',
      type: 'NEWS',
    });
    expect(draft).toMatchObject({ status: 'DRAFT', syncState: 'LOCAL' });
    expect(await database.syncOutbox.count({ where: { entityType: 'PUBLICATION' } })).toBe(0);
    const published = await publications.publish(ownerToken, draft.id);
    expect(published).toMatchObject({ status: 'PUBLISHED', syncState: 'PENDING' });
    await publications.update(ownerToken, draft.id, {
      audienceMode: 'ALL_CLIENTS',
      body: 'Обновлённая новость',
      targetIds: [],
      title: 'Новость ARAVA',
      type: 'NEWS',
    });
    await publications.archive(ownerToken, draft.id);
    expect(
      await database.syncOutbox.findMany({
        where: { entityType: 'PUBLICATION' },
        orderBy: { createdAt: 'asc' },
      }),
    ).toEqual([
      expect.objectContaining({ entityId: draft.id, operation: 'UPSERT' }),
      expect.objectContaining({ entityId: draft.id, operation: 'UPSERT' }),
      expect.objectContaining({ entityId: draft.id, operation: 'ARCHIVE' }),
    ]);
    expect(
      await database.auditLog.count({ where: { entityId: draft.id, entityType: 'Publication' } }),
    ).toBe(4);
  });

  it('enforces restricted ADMIN targets and blocks COACH management in the service layer', async () => {
    const branchA = await application.createBranch(ownerToken, { name: 'Центр' });
    const branchB = await application.createBranch(ownerToken, { name: 'Север' });
    const groupA = await studio.createGroup(ownerToken, {
      branchId: branchA.id,
      capacity: 20,
      direction: 'Хип-хоп',
      name: 'Группа А',
      status: 'ACTIVE',
    });
    const groupB = await studio.createGroup(ownerToken, {
      branchId: branchB.id,
      capacity: 20,
      direction: 'Контемп',
      name: 'Группа Б',
      status: 'ACTIVE',
    });
    const admin = await application.createUser(ownerToken, {
      branchIds: [branchA.id],
      email: 'publication-admin@arava.local',
      fullName: 'Администратор',
      password: 'Admin!Publications2026',
      role: 'ADMIN',
    });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branchA.id],
      email: 'publication-coach@arava.local',
      fullName: 'Тренер',
      password: 'Coach!Publications2026',
      role: 'COACH',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Publications2026',
    });
    const coachSession = await application.login({
      email: coach.email,
      password: 'Coach!Publications2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Publications2026',
      newPassword: 'Admin!PublicationsChanged2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Publications2026',
      newPassword: 'Coach!PublicationsChanged2026',
    });
    await expect(
      publications.create(adminSession.token, {
        audienceMode: 'GROUPS',
        body: 'Для группы А',
        targetIds: [groupA.id],
        title: 'Разрешено',
        type: 'INFO',
      }),
    ).resolves.toMatchObject({ status: 'DRAFT' });
    await expect(
      publications.create(adminSession.token, {
        audienceMode: 'GROUPS',
        body: 'Для группы Б',
        targetIds: [groupB.id],
        title: 'Запрещено',
        type: 'INFO',
      }),
    ).rejects.toThrow('нет доступа');
    await expect(
      publications.create(adminSession.token, {
        audienceMode: 'ALL_CLIENTS',
        body: 'Всем',
        targetIds: [],
        title: 'Запрещено',
        type: 'NEWS',
      }),
    ).rejects.toThrow('Ограниченный администратор');
    await expect(publications.list(coachSession.token)).rejects.toThrow('У тренера нет доступа');
  });
});
