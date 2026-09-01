import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAYOUT_CATEGORIES } from '@arava/shared';

import { ArchiveService } from './archive-service';
import { CalendarService } from './calendar-service';
import { FinanceService } from './finance-service';
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
import { ManagementService } from './management-service';
import { ApplicationService } from './services';
import { StudioService } from './studio-service';

describe('Sprint 6.1 schedule exceptions and global archive', () => {
  let application: ApplicationService;
  let archive: ArchiveService;
  let calendar: CalendarService;
  let database: DatabaseClient;
  let directory: string;
  let finance: FinanceService;
  let management: ManagementService;
  let ownerId: string;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-sprint-6-1-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'test.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    archive = new ArchiveService(database, application);
    calendar = new CalendarService(database, application);
    finance = new FinanceService(database, application);
    management = new ManagementService(database, application);
    studio = new StudioService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerId = owner.user.id;
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Schedule61',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function foundation() {
    const branch = await application.createBranch(ownerToken, {
      name: 'Центр',
      phone: '+79990000001',
    });
    const room = await calendar.createRoom(ownerToken, {
      branchId: branch.id,
      isActive: true,
      name: 'Зал 1',
      sortOrder: 0,
    });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach-61@arava.local',
      fullName: 'Анна Тренерова',
      password: 'Coach!Schedule61',
      role: 'COACH',
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      coachId: coach.id,
      direction: 'Танцы',
      name: 'Импульс',
      status: 'ACTIVE',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мила',
      lastName: 'Петрова',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, group.id, {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    return { branch, coach, group, room, student };
  }

  it('cancels without charging or payout and runs a linked makeup through canonical accounting', async () => {
    const { branch, coach, group, room, student } = await foundation();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 4,
      name: '4 занятия',
      price: 40_000,
      type: 'LESSON_PACK',
      validityDays: 60,
    });
    const subscription = await finance.createSubscription(ownerToken, {
      initialPayment: {
        amount: 40_000,
        paidAt: '2026-08-01T09:00:00+03:00',
        paymentMethod: 'CASH',
      },
      expiresAt: '2026-09-30',
      salePrice: 40_000,
      startsAt: '2026-08-01',
      studentId: student.id,
      tariffId: tariff.id,
    });
    await management.saveTrainerPayoutProfile(ownerToken, {
      effectiveFrom: '2026-08-01',
      rules: PAYOUT_CATEGORIES.map((category) =>
        category === 'MAKEUP'
          ? { category, mode: 'FIXED_PER_LESSON' as const, amount: 2_000 }
          : category === 'REGULAR_ATTENDANCE'
            ? { category, mode: 'FIXED_PER_ATTENDANCE' as const, amount: 1_000 }
            : { category },
      ),
      trainerId: coach.id,
    });
    const original = await studio.createLesson(ownerToken, {
      coachId: coach.id,
      endsAt: '2026-08-20T19:00:00+03:00',
      groupId: group.id,
      roomId: room.id,
      startsAt: '2026-08-20T18:00:00+03:00',
    });
    const cancelled = await studio.cancelLesson(ownerToken, original.id, {
      cancellationReason: 'Зал закрыт',
      requiresMakeup: true,
    });
    expect(cancelled).toMatchObject({ makeupState: 'PENDING', status: 'CANCELLED' });
    expect((await finance.getSubscription(ownerToken, subscription.id)).lessonsUsed).toBe(0);
    const emptyPeriod = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: '2026-08-20',
      dateTo: '2026-08-20',
    });
    expect(
      (await management.calculatePayrollPeriod(ownerToken, emptyPeriod.id)).accruals,
    ).toHaveLength(0);

    const makeup = await studio.scheduleMakeupLesson(ownerToken, original.id, {
      coachId: coach.id,
      endsAt: '2026-08-21T19:00:00+03:00',
      roomId: room.id,
      startsAt: '2026-08-21T18:00:00+03:00',
    });
    expect(makeup).toMatchObject({ makeupForLessonId: original.id, payoutCategory: 'MAKEUP' });
    await expect(
      studio.scheduleMakeupLesson(ownerToken, original.id, {
        coachId: coach.id,
        endsAt: '2026-08-22T19:00:00+03:00',
        roomId: room.id,
        startsAt: '2026-08-22T18:00:00+03:00',
      }),
    ).resolves.toMatchObject({ id: makeup.id });
    await studio.saveAttendance(ownerToken, makeup.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);
    expect((await finance.getSubscription(ownerToken, subscription.id)).lessonsUsed).toBe(1);
    const makeupPeriod = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: '2026-08-21',
      dateTo: '2026-08-21',
    });
    expect((await management.calculatePayrollPeriod(ownerToken, makeupPeriod.id)).accruals).toEqual(
      [expect.objectContaining({ calculatedAmount: 2_000, payoutCategory: 'MAKEUP' })],
    );
    expect((await studio.getLesson(ownerToken, original.id)).makeupState).toBe('COMPLETED');
    await closeDatabase(database);
    database = createDatabaseClient(toSqliteUrl(join(directory, 'test.db')));
    await initializeDatabase(database);
    expect(await database.lesson.findUnique({ where: { id: makeup.id } })).toMatchObject({
      makeupForLessonId: original.id,
      payoutCategory: 'MAKEUP',
    });
  });

  it('reschedules one occurrence, retains the weekly template and suppresses the old occurrence', async () => {
    const { branch, coach, group, room } = await foundation();
    const schedule = await studio.createSchedule(ownerToken, {
      branchId: branch.id,
      coachId: coach.id,
      endTime: '19:00',
      groupId: group.id,
      isActive: true,
      roomId: room.id,
      startTime: '18:00',
      validFrom: '2026-08-01',
      weekday: 4,
    });
    const occurrence = await studio.materializeLessonOccurrence(ownerToken, {
      groupId: group.id,
      startsAt: '2026-08-20T15:00:00.000Z',
    });
    const moved = await studio.rescheduleLesson(ownerToken, occurrence.id, {
      coachId: coach.id,
      endsAt: '2026-08-21T17:00:00.000Z',
      roomId: room.id,
      startsAt: '2026-08-21T16:00:00.000Z',
    });
    expect(moved).toMatchObject({
      originalStartsAt: '2026-08-20T15:00:00.000Z',
      startsAt: '2026-08-21T16:00:00.000Z',
    });
    expect(await database.weeklySchedule.findUnique({ where: { id: schedule.id } })).toMatchObject({
      isActive: true,
      startTime: '18:00',
      weekday: 4,
    });
    const actor = await application.authenticate(ownerToken);
    const oldDay = await new LessonOccurrenceService(database).resolveDay(
      actor,
      new Date('2026-08-20T12:00:00.000Z'),
    );
    const newDay = await new LessonOccurrenceService(database).resolveDay(
      actor,
      new Date('2026-08-21T12:00:00.000Z'),
    );
    expect(oldDay.filter(({ groupId }) => groupId === group.id)).toHaveLength(0);
    expect(newDay.filter(({ groupId }) => groupId === group.id)).toEqual([
      expect.objectContaining({
        lessonId: occurrence.id,
        startsAt: new Date('2026-08-21T16:00:00.000Z'),
      }),
    ]);
  });

  it('lists/restores canonical archived entities and protects history from permanent deletion', async () => {
    const { branch, coach, group, room, student } = await foundation();
    const safeGroup = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 5,
      direction: 'Балет',
      name: 'Пустая группа',
      status: 'RECRUITING',
    });
    const activeEmptyGroup = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 5,
      direction: 'Балет',
      name: 'Активная пустая группа',
      status: 'RECRUITING',
    });
    await application.archiveStudent(ownerToken, student.id);
    await studio.archiveGroup(ownerToken, group.id);
    await studio.archiveGroup(ownerToken, safeGroup.id);
    await calendar.archiveRoom(ownerToken, room.id);
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 1,
      name: 'Архивный тариф',
      price: 10_000,
      type: 'SINGLE_LESSON',
    });
    await finance.archiveTariff(ownerToken, tariff.id);
    const category = await management.createExpenseCategory(ownerToken, {
      branchId: branch.id,
      isActive: true,
      name: 'Архивная категория',
    });
    await management.archiveExpenseCategory(ownerToken, category.id);
    const trainer = await database.user.findUniqueOrThrow({ where: { id: coach.id } });
    await application.updateUser(ownerToken, coach.id, {
      branchIds: [branch.id],
      fullName: trainer.fullName,
      isActive: false,
      role: 'COACH',
    });
    const listed = await archive.list(ownerToken, {});
    expect(listed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: student.id, type: 'STUDENT' }),
        expect.objectContaining({ entityId: coach.id, type: 'TRAINER' }),
        expect.objectContaining({ entityId: group.id, type: 'GROUP' }),
        expect.objectContaining({ entityId: room.id, type: 'ROOM' }),
        expect.objectContaining({ entityId: tariff.id, type: 'TARIFF' }),
        expect.objectContaining({ entityId: category.id, type: 'EXPENSE_CATEGORY' }),
      ]),
    );
    expect((await archive.list(ownerToken, { search: 'Пустая' })).items).toHaveLength(1);
    expect((await archive.list(ownerToken, { type: 'TRAINER' })).items).toHaveLength(1);
    await expect(archive.deletePermanently(ownerToken, 'STUDENT', student.id)).rejects.toThrow(
      'связана значимая история',
    );
    await expect(
      archive.deletePermanently(ownerToken, 'GROUP', activeEmptyGroup.id),
    ).rejects.toThrow('не находится в архиве');
    await archive.deletePermanently(ownerToken, 'GROUP', safeGroup.id);
    expect(await database.danceGroup.findUnique({ where: { id: safeGroup.id } })).toBeNull();
    await archive.restore(ownerToken, 'STUDENT', student.id);
    await archive.restore(ownerToken, 'TRAINER', coach.id);
    await archive.restore(ownerToken, 'GROUP', group.id);
    expect(await database.student.findUnique({ where: { id: student.id } })).toMatchObject({
      archivedAt: null,
      status: 'ACTIVE',
    });
    expect(await database.user.findUnique({ where: { id: coach.id } })).toMatchObject({
      isActive: true,
    });
    expect(await database.danceGroup.count({ where: { id: group.id } })).toBe(1);
    expect(await database.danceGroup.findUnique({ where: { id: group.id } })).toMatchObject({
      archivedAt: null,
      status: 'PAUSED',
    });
  });

  it('enforces ADMIN branch scope and denies COACH archive access', async () => {
    const { branch, coach } = await foundation();
    const other = await application.createBranch(ownerToken, { name: 'Север' });
    const hidden = await studio.createGroup(ownerToken, {
      branchId: other.id,
      capacity: 10,
      direction: 'Танцы',
      name: 'Скрытая',
      status: 'ACTIVE',
    });
    await studio.archiveGroup(ownerToken, hidden.id);
    const admin = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'admin-61@arava.local',
      fullName: 'Администратор',
      password: 'Admin!Schedule61',
      role: 'ADMIN',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Schedule61',
    });
    const coachSession = await application.login({
      email: coach.email,
      password: 'Coach!Schedule61',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Schedule61',
      newPassword: 'Admin!Changed61',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Schedule61',
      newPassword: 'Coach!Changed61',
    });
    expect(
      (await archive.list(adminSession.token, {})).items.some(
        ({ entityId }) => entityId === hidden.id,
      ),
    ).toBe(false);
    await expect(archive.restore(adminSession.token, 'GROUP', hidden.id)).rejects.toThrow();
    await expect(archive.list(coachSession.token, {})).rejects.toThrow('Доступ к архиву запрещён');
  });

  it('writes auditable exception actions', async () => {
    const { coach, group, room } = await foundation();
    const lesson = await studio.createLesson(ownerToken, {
      coachId: coach.id,
      endsAt: '2026-08-25T19:00:00+03:00',
      groupId: group.id,
      roomId: room.id,
      startsAt: '2026-08-25T18:00:00+03:00',
    });
    await studio.rescheduleLesson(ownerToken, lesson.id, {
      coachId: coach.id,
      endsAt: '2026-08-26T19:00:00+03:00',
      roomId: room.id,
      startsAt: '2026-08-26T18:00:00+03:00',
    });
    await studio.cancelLesson(ownerToken, lesson.id, {
      cancellationReason: 'Перенос отменён',
      requiresMakeup: true,
    });
    expect(
      await database.auditLog.findMany({
        select: { action: true },
        where: { actorUserId: ownerId, entityId: lesson.id },
      }),
    ).toEqual(
      expect.arrayContaining([{ action: 'LESSON_RESCHEDULED' }, { action: 'LESSON_CANCELLED' }]),
    );
  });
});
