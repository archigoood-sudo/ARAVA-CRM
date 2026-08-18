import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CustomerDisplayService } from './customer-display-service';
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

describe('безопасные данные экрана клиента', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let service: CustomerDisplayService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-customer-display-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'display.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    service = new CustomerDisplayService(database, application);
    const session = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = session.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Display2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  it('отдаёт только публично разрешённые поля и свежие группы/занятие', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Центр' });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      email: 'secret@example.test',
      firstName: 'Артём',
      lastName: 'Иванов',
      notes: 'Секретная заметка',
      phone: '+79991112233',
      status: 'ACTIVE',
    });
    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        capacity: 20,
        direction: 'Хип-хоп',
        name: 'Hip-Hop 10–12',
        status: 'ACTIVE',
      },
    });
    await database.enrollment.create({
      data: { groupId: group.id, joinedAt: new Date(), status: 'ACTIVE', studentId: student.id },
    });
    const startsAt = new Date(Date.now() + 3_600_000);
    await database.lesson.create({
      data: {
        branchId: branch.id,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        groupId: group.id,
        room: 'Зал 1',
        startsAt,
        status: 'PLANNED',
      },
    });

    const result = await service.getSafeStudent(ownerToken, student.id);
    expect(Object.keys(result).sort()).toEqual(
      [
        'firstName',
        'groups',
        'lastNameInitial',
        'nextLesson',
        'remainingLessons',
        'subscriptionExpiresAt',
        'subscriptionStatus',
      ].sort(),
    );
    expect(result).toMatchObject({
      firstName: 'Артём',
      groups: ['Hip-Hop 10–12'],
      subscriptionStatus: 'NONE',
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'phone',
      'email',
      'notes',
      'debt',
      'payment',
      'barcode',
      'audit',
      student.id,
      '+79991112233',
      'secret@example.test',
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it('разрешает настройки только владельцу', async () => {
    const admin = await application.createUser(ownerToken, {
      branchIds: [],
      email: 'display-admin@arava.local',
      fullName: 'Администратор',
      password: 'Admin!Display2026',
      role: 'ADMIN',
    });
    const coach = await application.createUser(ownerToken, {
      branchIds: [],
      email: 'display-coach@arava.local',
      fullName: 'Тренер',
      password: 'Coach!Display2026',
      role: 'COACH',
    });
    const login = await application.login({ email: coach.email, password: 'Coach!Display2026' });
    await application.changePassword(login.token, {
      currentPassword: 'Coach!Display2026',
      newPassword: 'Coach!DisplayChanged2026',
    });
    const adminLogin = await application.login({
      email: admin.email,
      password: 'Admin!Display2026',
    });
    await application.changePassword(adminLogin.token, {
      currentPassword: 'Admin!Display2026',
      newPassword: 'Admin!DisplayChanged2026',
    });
    await expect(service.getConfiguration(login.token)).rejects.toThrow('только владельцу');
    await expect(service.getConfiguration(adminLogin.token)).rejects.toThrow('только владельцу');
    await expect(
      service.updateSettings(ownerToken, {
        customerSeconds: 15,
        enabled: true,
        fullscreen: true,
        showLastName: false,
        slideSeconds: 8,
      }),
    ).resolves.toMatchObject({ enabled: true });
  });
});
