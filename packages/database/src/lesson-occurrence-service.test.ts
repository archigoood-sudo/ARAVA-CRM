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
import { LessonOccurrenceService } from './lesson-occurrence-service';
import { isoWeekday, startOfLocalDay } from './schedule';
import { ApplicationService } from './services';
import { StudioService } from './studio-service';

describe('canonical daily lesson occurrences', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let resolver: LessonOccurrenceService;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-occurrences-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'occurrences.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    studio = new StudioService(database, application);
    resolver = new LessonOccurrenceService(database);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Occurrences2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function fixture(date: Date) {
    const branch = await application.createBranch(ownerToken, { name: 'Дневной филиал' });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      direction: 'Хип-хоп',
      name: 'KDS BABY',
      status: 'ACTIVE',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мила',
      lastName: 'Петрова',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, group.id, {
      joinedAt: '2026-01-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    const room = await database.room.create({
      data: { branchId: branch.id, name: 'Зал 1' },
    });
    const schedule = await database.weeklySchedule.create({
      data: {
        branchId: branch.id,
        endTime: '19:30',
        groupId: group.id,
        isActive: true,
        roomId: room.id,
        startTime: '18:30',
        validFrom: startOfLocalDay(date),
        weekday: isoWeekday(date),
      },
    });
    return { branch, group, room, schedule };
  }

  it('resolves a recurring lesson without a materialized Lesson row', async () => {
    const today = new Date(2026, 7, 24, 12);
    await fixture(today);
    const actor = await application.authenticate(ownerToken);

    await expect(resolver.resolveDay(actor, today)).resolves.toMatchObject([
      {
        attendanceMarked: 0,
        expectedStudents: 1,
        source: 'WEEKLY_SCHEDULE',
        trialStudents: 0,
      },
    ]);
  });

  it('uses a materialized lesson once and lets cancellation suppress its recurring occurrence', async () => {
    const today = new Date(2026, 7, 24, 12);
    const { branch, group, room, schedule } = await fixture(today);
    const startsAt = new Date(2026, 7, 24, 18, 30);
    const lesson = await database.lesson.create({
      data: {
        branchId: branch.id,
        endsAt: new Date(2026, 7, 24, 19, 30),
        groupId: group.id,
        roomId: room.id,
        scheduleTemplateId: schedule.id,
        startsAt,
      },
    });
    const actor = await application.authenticate(ownerToken);

    await expect(resolver.resolveDay(actor, today)).resolves.toMatchObject([
      { lessonId: lesson.id, source: 'LESSON' },
    ]);
    expect(await resolver.resolveDay(actor, today)).toHaveLength(1);

    await database.lesson.update({ data: { status: 'CANCELLED' }, where: { id: lesson.id } });
    await expect(resolver.resolveDay(actor, today)).resolves.toEqual([]);
  });

  it('excludes recurring occurrences covered by an exception or room closure', async () => {
    const today = new Date(2026, 7, 24, 12);
    const { branch, room } = await fixture(today);
    const actor = await application.authenticate(ownerToken);
    const startAt = new Date(2026, 7, 24, 18);
    const endAt = new Date(2026, 7, 24, 20);
    const exception = await database.calendarException.create({
      data: {
        branchId: branch.id,
        endAt,
        startAt,
        title: 'Выходной',
        type: 'DAY_OFF',
      },
    });
    await expect(resolver.resolveDay(actor, today)).resolves.toEqual([]);

    await database.calendarException.delete({ where: { id: exception.id } });
    await database.roomClosure.create({
      data: {
        createdByUserId: actor.id,
        endAt,
        reason: 'Ремонт',
        roomId: room.id,
        startAt,
      },
    });
    await expect(resolver.resolveDay(actor, today)).resolves.toEqual([]);
  });

  it('keeps recurring occurrences inside the administrator branch scope', async () => {
    const today = new Date(2026, 7, 24, 12);
    const visibleBranch = await application.createBranch(ownerToken, { name: 'Доступный' });
    const hiddenBranch = await application.createBranch(ownerToken, { name: 'Скрытый' });
    const [visibleGroup, hiddenGroup] = await Promise.all([
      studio.createGroup(ownerToken, {
        branchId: visibleBranch.id,
        capacity: 20,
        direction: 'Хип-хоп',
        name: 'Видимая группа',
        status: 'ACTIVE',
      }),
      studio.createGroup(ownerToken, {
        branchId: hiddenBranch.id,
        capacity: 20,
        direction: 'Хип-хоп',
        name: 'Скрытая группа',
        status: 'ACTIVE',
      }),
    ]);
    await database.weeklySchedule.createMany({
      data: [visibleGroup, hiddenGroup].map((group, index) => ({
        branchId: index === 0 ? visibleBranch.id : hiddenBranch.id,
        endTime: '19:30',
        groupId: group.id,
        startTime: '18:30',
        validFrom: startOfLocalDay(today),
        weekday: isoWeekday(today),
      })),
    });
    await application.createUser(ownerToken, {
      branchIds: [visibleBranch.id],
      email: 'daily-admin@arava.local',
      fullName: 'Администратор',
      password: 'Admin!Occurrences2026',
      role: 'ADMIN',
    });
    const admin = await application.login({
      email: 'daily-admin@arava.local',
      password: 'Admin!Occurrences2026',
    });
    await application.changePassword(admin.token, {
      currentPassword: 'Admin!Occurrences2026',
      newPassword: 'Admin!OccurrencesChanged2026',
    });
    const actor = await application.authenticate(admin.token);

    await expect(resolver.resolveDay(actor, today)).resolves.toMatchObject([
      { branchId: visibleBranch.id, source: 'WEEKLY_SCHEDULE' },
    ]);
  });
});
