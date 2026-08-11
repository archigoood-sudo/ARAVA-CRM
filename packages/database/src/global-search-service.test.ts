import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CalendarService } from './calendar-service';
import { CardService } from './card-service';
import { GlobalSearchService } from './global-search-service';
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
import { StudioService } from './studio-service';

describe('Sprint 4.1D global search', () => {
  let application: ApplicationService;
  let cards: CardService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let search: GlobalSearchService;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-search-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'search.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    cards = new CardService(database, application);
    search = new GlobalSearchService(database, application);
    studio = new StudioService(database, application);
    const session = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = session.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Search2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function foundation() {
    const branch = await application.createBranch(ownerToken, {
      address: 'улица Поисковая, 10',
      name: 'Центральный поиск',
    });
    const hiddenBranch = await application.createBranch(ownerToken, { name: 'Скрытый север' });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'trainer-search@arava.local',
      fullName: 'Денис Поплавский',
      password: 'Coach!Search2026',
      phone: '+79991112233',
      role: 'COACH',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      email: 'artem@example.local',
      firstName: 'Артём',
      lastName: 'Иванов',
      phone: '+79990001122',
      status: 'ACTIVE',
    });
    await application.createContact(ownerToken, student.id, {
      fullName: 'Марина Иванова',
      isPrimary: true,
      phone: '+79995554433',
      relationship: 'Мама',
      whatsapp: true,
    });
    const hiddenStudent = await application.createStudent(ownerToken, {
      branchId: hiddenBranch.id,
      firstName: 'Секретный',
      lastName: 'Ученик',
      status: 'ACTIVE',
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      coachId: coach.id,
      direction: 'Хип-хоп',
      name: 'Hip-Hop 10–12',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, group.id, {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    const calendar = new CalendarService(database, application);
    const room = await calendar.createRoom(ownerToken, {
      branchId: branch.id,
      capacity: 30,
      isActive: true,
      name: 'Зеркальный зал',
      sortOrder: 0,
    });
    await cards.assignCard(ownerToken, {
      barcode: '0000012345',
      registerIfUnknown: true,
      studentId: student.id,
    });
    return { branch, coach, group, hiddenBranch, hiddenStudent, room, student };
  }

  it('finds every supported entity and preserves leading zeroes', async () => {
    await foundation();
    const cases = [
      ['иванов', 'STUDENT'],
      ['иванов артём', 'STUDENT'],
      ['0001122', 'STUDENT'],
      ['Марина', 'STUDENT'],
      ['5554433', 'STUDENT'],
      ['hip-hop', 'GROUP'],
      ['поплавский', 'TRAINER'],
      ['поисковая', 'BRANCH'],
      ['зеркальный', 'ROOM'],
      ['0000012345', 'CARD'],
    ] as const;
    for (const [query, type] of cases)
      expect(
        (await search.search(ownerToken, `  ${query}  `)).some((item) => item.type === type),
      ).toBe(true);
    expect(
      (await search.search(ownerToken, '0000012345')).find(({ type }) => type === 'CARD'),
    ).toMatchObject({ title: '0000012345', type: 'CARD' });
  });

  it('filters ADMIN and COACH results in the service layer', async () => {
    const context = await foundation();
    const admin = await application.createUser(ownerToken, {
      branchIds: [context.branch.id],
      email: 'admin-search@arava.local',
      fullName: 'Администратор поиска',
      password: 'Admin!Search2026',
      role: 'ADMIN',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Search2026',
    });
    const coachSession = await application.login({
      email: context.coach.email,
      password: 'Coach!Search2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Search2026',
      newPassword: 'Admin!SearchChanged2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Search2026',
      newPassword: 'Coach!SearchChanged2026',
    });
    expect(await search.search(adminSession.token, 'Секретный')).toEqual([]);
    expect(await search.search(coachSession.token, 'Секретный')).toEqual([]);
    expect(await search.search(coachSession.token, 'Иванов')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: context.student.id, type: 'STUDENT' }),
      ]),
    );
    expect(await search.search(coachSession.token, 'Hip-Hop')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: context.group.id, type: 'GROUP' })]),
    );
    expect(await search.search(coachSession.token, '0000012345')).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'CARD' })]),
    );
    expect(await search.search(coachSession.token, 'Администратор')).toEqual([]);
  });
});
