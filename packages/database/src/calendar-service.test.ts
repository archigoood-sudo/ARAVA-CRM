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
import { CalendarService } from './calendar-service';
import { ManagementService } from './management-service';
import { StudioService } from './studio-service';

describe('Sprint 4.1B calendar service', () => {
  let application: ApplicationService;
  let calendar: CalendarService;
  let database: DatabaseClient;
  let directory: string;
  let management: ManagementService;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-calendar-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'calendar.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    calendar = new CalendarService(database, application);
    management = new ManagementService(database, application);
    studio = new StudioService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Calendar2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function setup() {
    const branch = await application.createBranch(ownerToken, {
      address: 'ул. Танцевальная, 1',
      name: 'Центр',
      phone: '+79990000001',
    });
    const otherBranch = await application.createBranch(ownerToken, {
      name: 'Север',
    });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach-calendar@arava.local',
      fullName: 'Анна Тренерова',
      password: 'Coach!Calendar2026',
      role: 'COACH',
    });
    const substitute = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'substitute@arava.local',
      fullName: 'Мария Замена',
      password: 'Substitute!Calendar2026',
      role: 'COACH',
    });
    const manager = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'admin-calendar@arava.local',
      fullName: 'Администратор',
      password: 'Admin!Calendar2026',
      role: 'ADMIN',
    });
    const managerSession = await application.login({
      email: manager.email,
      password: 'Admin!Calendar2026',
    });
    const coachSession = await application.login({
      email: coach.email,
      password: 'Coach!Calendar2026',
    });
    await application.changePassword(managerSession.token, {
      currentPassword: 'Admin!Calendar2026',
      newPassword: 'Admin!ChangedCalendar2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Calendar2026',
      newPassword: 'Coach!ChangedCalendar2026',
    });
    const firstGroup = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      coachId: coach.id,
      direction: 'Хип-хоп',
      name: 'Импульс',
      status: 'ACTIVE',
    });
    const secondGroup = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      coachId: substitute.id,
      direction: 'Брейк-данс',
      name: 'Ритм',
      status: 'ACTIVE',
    });
    const thirdGroup = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      direction: 'Контемпорари',
      name: 'Поток',
      status: 'ACTIVE',
    });
    const roomOne = await calendar.createRoom(ownerToken, {
      branchId: branch.id,
      capacity: 15,
      isActive: true,
      name: 'Зал 1',
      sortOrder: 1,
    });
    const roomTwo = await calendar.createRoom(ownerToken, {
      branchId: branch.id,
      isActive: true,
      name: 'Зал 2',
      sortOrder: 2,
    });
    return {
      branch,
      coach,
      coachToken: coachSession.token,
      firstGroup,
      managerToken: managerSession.token,
      otherBranch,
      roomOne,
      roomTwo,
      secondGroup,
      substitute,
      thirdGroup,
    };
  }

  it('enforces room permissions, branch consistency, archival and history preservation', async () => {
    const context = await setup();
    await expect(
      calendar.createRoom(context.managerToken, {
        branchId: context.otherBranch.id,
        isActive: true,
        name: 'Недоступный зал',
        sortOrder: 0,
      }),
    ).rejects.toThrow('нет доступа к этому филиалу');
    await expect(
      calendar.createRoom(context.coachToken, {
        branchId: context.branch.id,
        isActive: true,
        name: 'Тренерский зал',
        sortOrder: 0,
      }),
    ).rejects.toThrow('недостаточно прав');
    await expect(
      studio.createLesson(ownerToken, {
        endsAt: '2026-08-10T16:00:00.000Z',
        groupId: context.firstGroup.id,
        roomId: context.roomOne.id,
        startsAt: '2026-08-10T15:00:00.000Z',
      }),
    ).resolves.toBeDefined();
    await calendar.archiveRoom(ownerToken, context.roomOne.id);
    expect(await database.lesson.count({ where: { roomId: context.roomOne.id } })).toBe(1);
    await expect(
      studio.createLesson(ownerToken, {
        endsAt: '2026-08-10T18:00:00.000Z',
        groupId: context.thirdGroup.id,
        roomId: context.roomOne.id,
        startsAt: '2026-08-10T17:00:00.000Z',
      }),
    ).rejects.toThrow('Выбранный зал недоступен');
  });

  it('allows parallel rooms and adjacent events but rejects room, trainer and group overlaps', async () => {
    const context = await setup();
    await studio.createLesson(ownerToken, {
      coachId: context.coach.id,
      endsAt: '2026-08-10T16:00:00.000Z',
      groupId: context.firstGroup.id,
      roomId: context.roomOne.id,
      startsAt: '2026-08-10T15:00:00.000Z',
    });
    await expect(
      studio.createLesson(ownerToken, {
        coachId: context.substitute.id,
        endsAt: '2026-08-10T16:00:00.000Z',
        groupId: context.thirdGroup.id,
        roomId: context.roomTwo.id,
        startsAt: '2026-08-10T15:00:00.000Z',
      }),
    ).resolves.toBeDefined();
    await expect(
      studio.createLesson(ownerToken, {
        coachId: context.substitute.id,
        endsAt: '2026-08-10T17:00:00.000Z',
        groupId: context.secondGroup.id,
        roomId: context.roomOne.id,
        startsAt: '2026-08-10T16:00:00.000Z',
      }),
    ).resolves.toBeDefined();
    await expect(
      studio.createLesson(ownerToken, {
        endsAt: '2026-08-10T15:45:00.000Z',
        groupId: context.secondGroup.id,
        roomId: context.roomOne.id,
        startsAt: '2026-08-10T15:15:00.000Z',
      }),
    ).rejects.toThrow(/зал/iu);
    await expect(
      studio.createLesson(ownerToken, {
        coachId: context.coach.id,
        endsAt: '2026-08-10T15:45:00.000Z',
        groupId: context.secondGroup.id,
        roomId: context.roomTwo.id,
        startsAt: '2026-08-10T15:15:00.000Z',
      }),
    ).rejects.toThrow('Тренер уже занят');
    await expect(
      studio.createLesson(ownerToken, {
        endsAt: '2026-08-10T15:45:00.000Z',
        groupId: context.firstGroup.id,
        roomId: context.roomTwo.id,
        startsAt: '2026-08-10T15:15:00.000Z',
      }),
    ).rejects.toThrow('У группы уже есть занятие');
  });

  it('uses rentals and closures as room blockers and returns affected events and free windows', async () => {
    const context = await setup();
    await calendar.createRental(ownerToken, {
      branchId: context.branch.id,
      clientName: 'Театр танца',
      endAt: '2026-08-11T12:00:00.000Z',
      roomId: context.roomOne.id,
      startAt: '2026-08-11T10:00:00.000Z',
    });
    await expect(
      studio.createLesson(ownerToken, {
        endsAt: '2026-08-11T11:30:00.000Z',
        groupId: context.firstGroup.id,
        roomId: context.roomOne.id,
        startsAt: '2026-08-11T11:00:00.000Z',
      }),
    ).rejects.toThrow('зал занят арендой');
    const lesson = await studio.createLesson(ownerToken, {
      endsAt: '2026-08-11T14:00:00.000Z',
      groupId: context.firstGroup.id,
      roomId: context.roomOne.id,
      startsAt: '2026-08-11T13:00:00.000Z',
    });
    const closure = {
      endAt: '2026-08-11T14:30:00.000Z',
      reason: 'Технические работы',
      roomId: context.roomOne.id,
      startAt: '2026-08-11T13:30:00.000Z',
    };
    await expect(calendar.previewClosure(ownerToken, closure)).resolves.toMatchObject({
      affected: [{ id: lesson.id, type: 'LESSON' }],
    });
    await calendar.createClosure(ownerToken, closure);
    await expect(
      studio.createLesson(ownerToken, {
        endsAt: '2026-08-11T14:20:00.000Z',
        groupId: context.secondGroup.id,
        roomId: context.roomOne.id,
        startsAt: '2026-08-11T14:00:00.000Z',
      }),
    ).rejects.toThrow('временно закрыт');
    const windows = await calendar.availability(ownerToken, context.roomOne.id, '2026-08-11');
    expect(windows.some(({ kind }) => kind === 'FREE')).toBe(true);
    expect(windows.some(({ kind }) => kind === 'RENTAL')).toBe(true);
    expect(windows.some(({ kind }) => kind === 'CLOSURE')).toBe(true);
  });

  it('respects calendar exceptions, copies schedules and attributes payroll to a substitute', async () => {
    const context = await setup();
    await studio.createSchedule(ownerToken, {
      branchId: context.branch.id,
      coachId: context.coach.id,
      endTime: '19:00',
      groupId: context.firstGroup.id,
      isActive: true,
      roomId: context.roomOne.id,
      startTime: '18:00',
      validFrom: '2026-08-01',
      weekday: 1,
    });
    await calendar.createException(ownerToken, {
      branchId: context.branch.id,
      endAt: '2026-08-10T23:59:59.999Z',
      startAt: '2026-08-10T00:00:00.000Z',
      title: 'Праздничный день',
      type: 'HOLIDAY',
    });
    await expect(
      studio.generateLessons(ownerToken, { dateFrom: '2026-08-10', dateTo: '2026-08-10' }),
    ).resolves.toEqual({ created: 0, skipped: 1 });
    const lesson = await studio.createLesson(ownerToken, {
      coachId: context.coach.id,
      endsAt: '2026-08-12T16:00:00.000Z',
      groupId: context.firstGroup.id,
      roomId: context.roomOne.id,
      startsAt: '2026-08-12T15:00:00.000Z',
    });
    await expect(
      calendar.copyDay(ownerToken, { sourceDate: '2026-08-12', targetDate: '2026-08-13' }),
    ).resolves.toMatchObject({ conflicts: 0, copied: 1 });
    const substituteConflict = await studio.createLesson(ownerToken, {
      coachId: context.substitute.id,
      endsAt: '2026-08-12T15:45:00.000Z',
      groupId: context.secondGroup.id,
      roomId: context.roomTwo.id,
      startsAt: '2026-08-12T15:15:00.000Z',
    });
    await expect(
      calendar.assignSubstitution(ownerToken, lesson.id, {
        substituteTrainerId: context.substitute.id,
      }),
    ).rejects.toThrow('Тренер уже занят');
    await studio.cancelLesson(ownerToken, substituteConflict.id, {
      cancellationReason: 'Освобождение тренера для замены',
    });
    await calendar.assignSubstitution(ownerToken, lesson.id, {
      substituteTrainerId: context.substitute.id,
    });
    expect(await database.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).toMatchObject({
      coachId: context.substitute.id,
    });
    await database.lesson.update({
      data: { attendanceCompletedAt: new Date(), status: 'COMPLETED' },
      where: { id: lesson.id },
    });
    await database.payrollRule.create({
      data: {
        branchId: context.branch.id,
        coachId: context.substitute.id,
        fixedAmount: 150_000,
        type: 'FIXED_PER_LESSON',
        validFrom: new Date('2026-08-01T00:00:00.000Z'),
      },
    });
    const period = await database.payrollPeriod.create({
      data: {
        branchId: context.branch.id,
        createdByUserId: (await application.authenticate(ownerToken)).id,
        dateFrom: new Date('2026-08-01T00:00:00.000Z'),
        dateTo: new Date('2026-08-31T23:59:59.999Z'),
      },
    });
    await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(
      await database.payrollAccrual.findFirstOrThrow({ where: { lessonId: lesson.id } }),
    ).toMatchObject({ coachId: context.substitute.id, finalAmount: 150_000 });
  });
  it('assigns, replaces and removes one occurrence without changing roster, ledger or future schedule', async () => {
    const c = await setup();
    const schedule = await studio.createSchedule(ownerToken, {
      branchId: c.branch.id,
      groupId: c.firstGroup.id,
      coachId: c.coach.id,
      weekday: 1,
      startTime: '18:00',
      endTime: '19:00',
      validFrom: '2026-08-01',
      isActive: true,
    });
    const lesson = await studio.createLesson(ownerToken, {
      groupId: c.firstGroup.id,
      startsAt: '2026-08-10T15:00:00Z',
      endsAt: '2026-08-10T16:00:00Z',
      coachId: c.coach.id,
    });
    const future = await studio.createLesson(ownerToken, {
      groupId: c.firstGroup.id,
      startsAt: '2026-08-17T15:00:00Z',
      endsAt: '2026-08-17T16:00:00Z',
      coachId: c.coach.id,
    });
    const third = await application.createUser(ownerToken, {
      branchIds: [c.branch.id],
      email: 'third-substitute@arava.local',
      fullName: 'Третья Тренер',
      password: 'Third!Trainer2026',
      role: 'COACH',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: c.branch.id,
      firstName: 'Ученик',
      lastName: 'Замена',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, c.firstGroup.id, {
      studentId: student.id,
      joinedAt: '2026-08-01',
      status: 'ACTIVE',
      overrideCapacity: false,
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { studentId: student.id, status: 'PRESENT' },
    ]);
    const before = {
      attendance: await database.attendance.findMany(),
      ledger: await database.subscriptionLedger.findMany(),
      subscriptions: await database.subscription.findMany(),
      roster: (await studio.getAttendance(ownerToken, lesson.id)).participants,
      schedule: await database.weeklySchedule.findUnique({ where: { id: schedule.id } }),
      future: await database.lesson.findUnique({ where: { id: future.id } }),
    };
    const first = await calendar.assignSubstitution(c.managerToken, lesson.id, {
      substituteTrainerId: c.substitute.id,
    });
    const changed = await calendar.assignSubstitution(c.managerToken, lesson.id, {
      substituteTrainerId: third.id,
    });
    expect(changed.id).toBe(first.id);
    expect(changed.originalTrainerId).toBe(c.coach.id);
    expect(changed.originalTrainerName).toBe(c.coach.fullName);
    await database.$disconnect();
    expect(
      await new StudioService(database, new ApplicationService(database)).getLesson(
        ownerToken,
        lesson.id,
      ),
    ).toMatchObject({
      coachId: third.id,
      substituteCoachId: third.id,
      originalCoachId: c.coach.id,
    });
    await calendar.removeSubstitution(c.managerToken, lesson.id);
    expect(await studio.getLesson(ownerToken, lesson.id)).toMatchObject({
      coachId: c.coach.id,
      substituteCoachId: undefined,
    });
    const outboxBefore = await database.syncOutbox.count();
    await calendar.removeSubstitution(c.managerToken, lesson.id);
    expect(await database.syncOutbox.count()).toBe(outboxBefore);
    expect(await database.attendance.findMany()).toEqual(before.attendance);
    expect(await database.subscriptionLedger.findMany()).toEqual(before.ledger);
    expect(await database.subscription.findMany()).toEqual(before.subscriptions);
    expect((await studio.getAttendance(ownerToken, lesson.id)).participants).toEqual(before.roster);
    expect(await database.weeklySchedule.findUnique({ where: { id: schedule.id } })).toEqual(
      before.schedule,
    );
    expect(await database.lesson.findUnique({ where: { id: future.id } })).toEqual(before.future);
    expect(await database.lesson.count()).toBe(2);
    expect(await database.trainerSubstitution.count()).toBe(0);
    const operations = await database.syncOutbox.findMany({
      where: { entityType: 'SUBSTITUTION', entityId: first.id },
    });
    expect(operations.filter((row) => row.operation === 'UPSERT')).toHaveLength(2);
    expect(operations.filter((row) => row.operation === 'ARCHIVE')).toHaveLength(1);
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'TRAINER_SUBSTITUTION_REMOVED', entityId: first.id },
    });
    expect(JSON.parse(audit.detail ?? '{}')).toMatchObject({
      beforeTrainerId: third.id,
      afterTrainerId: c.coach.id,
    });
  });

  it('rejects cancelled lessons, inactive trainers and COACH mutations without side effects', async () => {
    const c = await setup();
    const lesson = await studio.createLesson(ownerToken, {
      groupId: c.firstGroup.id,
      coachId: c.coach.id,
      startsAt: '2026-08-10T15:00:00Z',
      endsAt: '2026-08-10T16:00:00Z',
    });
    await expect(
      calendar.assignSubstitution(c.coachToken, lesson.id, {
        substituteTrainerId: c.substitute.id,
      }),
    ).rejects.toThrow('недостаточно прав');
    await expect(calendar.removeSubstitution(c.coachToken, lesson.id)).rejects.toThrow(
      'недостаточно прав',
    );
    await database.user.update({ where: { id: c.substitute.id }, data: { isActive: false } });
    await expect(
      calendar.assignSubstitution(ownerToken, lesson.id, { substituteTrainerId: c.substitute.id }),
    ).rejects.toThrow('недоступен');
    await database.user.update({ where: { id: c.substitute.id }, data: { isActive: true } });
    await calendar.assignSubstitution(ownerToken, lesson.id, {
      substituteTrainerId: c.substitute.id,
    });
    await studio.cancelLesson(ownerToken, lesson.id, { cancellationReason: 'Отмена для проверки' });
    const before = await database.syncOutbox.count();
    await expect(
      calendar.assignSubstitution(ownerToken, lesson.id, { substituteTrainerId: c.substitute.id }),
    ).rejects.toThrow('отменённого');
    await expect(calendar.removeSubstitution(ownerToken, lesson.id)).rejects.toThrow('отменённого');
    expect(await database.syncOutbox.count()).toBe(before);
    expect(await database.trainerSubstitution.count()).toBe(1);
  });

  it('uses the substitute policy effective on the lesson date and excludes the regular trainer', async () => {
    const c = await setup();
    const lesson = await studio.createLesson(ownerToken, {
      groupId: c.firstGroup.id,
      coachId: c.coach.id,
      startsAt: '2026-08-10T15:00:00Z',
      endsAt: '2026-08-10T16:00:00Z',
    });
    await calendar.assignSubstitution(ownerToken, lesson.id, {
      substituteTrainerId: c.substitute.id,
    });
    await database.lesson.update({
      where: { id: lesson.id },
      data: { status: 'COMPLETED', attendanceCompletedAt: new Date() },
    });
    const ownerId = (await application.authenticate(ownerToken)).id;
    for (const [trainerId, category, amount, effectiveFrom] of [
      [c.coach.id, 'REGULAR_ATTENDANCE', 50000, '2026-08-01'],
      [c.substitute.id, 'SUBSTITUTION', 75000, '2026-08-01'],
      [c.substitute.id, 'SUBSTITUTION', 99000, '2026-08-15'],
    ] as const)
      await database.trainerPayoutRule.create({
        data: {
          trainerId,
          category,
          mode: 'FIXED_PER_LESSON',
          amount,
          effectiveFrom: new Date(effectiveFrom),
          createdByUserId: ownerId,
        },
      });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: c.branch.id,
      dateFrom: '2026-08-10',
      dateTo: '2026-08-10',
      trainerId: c.substitute.id,
    });
    const result = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(result.accruals).toHaveLength(1);
    expect(result.accruals[0]).toMatchObject({
      lessonId: lesson.id,
      coachId: c.substitute.id,
      finalAmount: 75000,
    });
    expect(
      await database.payrollAccrual.count({ where: { lessonId: lesson.id, coachId: c.coach.id } }),
    ).toBe(0);
    expect(
      (await management.getPayrollPrintPeriod(ownerToken, period.id)).accruals[0],
    ).toMatchObject({ coachId: c.substitute.id, lessonId: lesson.id, finalAmount: 75000 });
  });
});
