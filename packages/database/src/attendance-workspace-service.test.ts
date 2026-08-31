import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AttendanceScanLessonOption } from '@arava/shared';

import { AttendanceWorkspaceService, rankAttendanceOptions } from './attendance-workspace-service';
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
import { FinanceService } from './finance-service';
import { ManagementService } from './management-service';
import { StudioService } from './studio-service';

describe('Attendance 2.0 workspace', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let studio: StudioService;
  let workspace: AttendanceWorkspaceService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-attendance-workspace-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'attendance.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    studio = new StudioService(database, application);
    workspace = new AttendanceWorkspaceService(
      database,
      application,
      () => new Date('2026-08-23T10:30:00'),
      studio,
    );
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Attendance2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function fixture() {
    const branch = await application.createBranch(ownerToken, { name: 'Центр' });
    const otherBranch = await application.createBranch(ownerToken, { name: 'Север' });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach-attendance@arava.local',
      fullName: 'Анна Тренерова',
      password: 'Coach!Attendance2026',
      role: 'COACH',
    });
    const substitute = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'substitute-attendance@arava.local',
      fullName: 'Елена Подменова',
      password: 'Substitute!Attendance2026',
      role: 'COACH',
    });
    const admin = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'admin-attendance@arava.local',
      fullName: 'Администратор Центра',
      password: 'Admin!Attendance2026',
      role: 'ADMIN',
    });
    const coachSession = await application.login({
      email: coach.email,
      password: 'Coach!Attendance2026',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Attendance2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Attendance2026',
      newPassword: 'Coach!AttendanceChanged2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Attendance2026',
      newPassword: 'Admin!AttendanceChanged2026',
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      coachId: coach.id,
      direction: 'Хип-хоп',
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
    const current = await studio.createLesson(ownerToken, {
      coachId: coach.id,
      endsAt: '2026-08-23T11:00:00',
      groupId: group.id,
      startsAt: '2026-08-23T10:00:00',
    });
    const upcoming = await studio.createLesson(ownerToken, {
      coachId: coach.id,
      endsAt: '2026-08-23T13:00:00',
      groupId: group.id,
      startsAt: '2026-08-23T12:00:00',
    });
    const owner = await application.authenticate(ownerToken);
    await database.trainerSubstitution.create({
      data: {
        createdByUserId: owner.id,
        lessonId: upcoming.id,
        originalTrainerId: coach.id,
        substituteTrainerId: substitute.id,
      },
    });
    const cancelled = await studio.createLesson(ownerToken, {
      coachId: coach.id,
      endsAt: '2026-08-23T16:00:00',
      groupId: group.id,
      startsAt: '2026-08-23T15:00:00',
    });
    await studio.cancelLesson(ownerToken, cancelled.id, { cancellationReason: 'Отмена' });
    return {
      adminToken: adminSession.token,
      branch,
      cancelled,
      coachToken: coachSession.token,
      coach,
      current,
      group,
      otherBranch,
      student,
      upcoming,
    };
  }

  it('returns actual lessons, canonical roster counts and branch-scoped data', async () => {
    const data = await fixture();
    const day = await workspace.today(ownerToken, '2026-08-23');
    expect(day.lessons).toHaveLength(2);
    expect(day.lessons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attendanceExpected: 1,
          attendanceMarked: 0,
          effectiveTrainerName: 'Анна Тренерова',
          id: data.current.id,
        }),
        expect.objectContaining({
          effectiveTrainerName: 'Елена Подменова',
          id: data.upcoming.id,
        }),
      ]),
    );
    expect(day.lessons.some(({ id }) => id === data.cancelled.id)).toBe(false);
    const adminDay = await workspace.today(data.adminToken, '2026-08-23');
    expect(adminDay.lessons).toHaveLength(2);
    expect(adminDay.lessons.every(({ branchId }) => branchId === data.branch.id)).toBe(true);

    const restricted = await application.createUser(ownerToken, {
      branchIds: [data.otherBranch.id],
      email: 'restricted-attendance@arava.local',
      fullName: 'Другой администратор',
      password: 'Admin!OtherAttendance2026',
      role: 'ADMIN',
    });
    const restrictedSession = await application.login({
      email: restricted.email,
      password: 'Admin!OtherAttendance2026',
    });
    await application.changePassword(restrictedSession.token, {
      currentPassword: 'Admin!OtherAttendance2026',
      newPassword: 'Admin!OtherAttendanceChanged2026',
    });
    await expect(workspace.today(restrictedSession.token, '2026-08-23')).resolves.toEqual({
      date: '2026-08-23',
      lessons: [],
    });
  });

  it('offers valid lessons after a scan without writing attendance', async () => {
    const data = await fixture();
    const before = await database.attendance.count();
    const options = await workspace.scanOptions(ownerToken, data.student.id, '2026-08-23');
    expect(options.studentName).toBe('Мила Петрова');
    expect(options.lessons.map(({ lessonId }) => lessonId)).toEqual([
      data.current.id,
      data.upcoming.id,
    ]);
    expect(await database.attendance.count()).toBe(before);

    await studio.cancelLesson(ownerToken, data.upcoming.id, { cancellationReason: 'Перенос' });
    const singleOption = await workspace.scanOptions(ownerToken, data.student.id, '2026-08-23');
    expect(singleOption.lessons.map(({ lessonId }) => lessonId)).toEqual([data.current.id]);
    const studentWithoutLesson = await application.createStudent(ownerToken, {
      branchId: data.branch.id,
      firstName: 'Нет',
      lastName: 'Занятий',
      status: 'ACTIVE',
    });
    await expect(
      workspace.scanOptions(ownerToken, studentWithoutLesson.id, '2026-08-23'),
    ).resolves.toMatchObject({ lessons: [] });

    await studio.saveAttendance(ownerToken, data.current.id, [
      { status: 'ABSENT', studentId: data.student.id },
    ]);
    expect(
      (await workspace.scanOptions(ownerToken, data.student.id, '2026-08-23')).lessons[0],
    ).toMatchObject({ currentStatus: 'ABSENT' });
    await studio.saveAttendance(ownerToken, data.current.id, [
      { status: 'EXCUSED', studentId: data.student.id },
    ]);
    expect(
      (await workspace.scanOptions(ownerToken, data.student.id, '2026-08-23')).lessons[0],
    ).toMatchObject({ currentStatus: 'EXCUSED' });
    await studio.saveAttendance(ownerToken, data.current.id, [
      { status: 'PRESENT', studentId: data.student.id },
    ]);
    await studio.saveAttendance(ownerToken, data.current.id, [
      { status: 'PRESENT', studentId: data.student.id },
    ]);
    expect(await database.attendance.count({ where: { lessonId: data.current.id } })).toBe(1);
    const markedOptions = await workspace.scanOptions(ownerToken, data.student.id, '2026-08-23');
    expect(markedOptions.lessons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currentStatus: 'PRESENT', lessonId: data.current.id }),
      ]),
    );
    await expect(
      workspace.scanOptions(data.coachToken, data.student.id, '2026-08-23'),
    ).rejects.toThrow('Рабочее место «Посещения» доступно владельцу и администраторам.');
    const inaccessible = await application.createStudent(ownerToken, {
      branchId: data.otherBranch.id,
      firstName: 'Скрытый',
      lastName: 'Ученик',
      status: 'ACTIVE',
    });
    await expect(
      workspace.scanOptions(data.adminToken, inaccessible.id, '2026-08-23'),
    ).rejects.toThrow('У вас нет доступа к этому филиалу.');
  });

  it('offers a weekly-only occurrence and materializes it only after confirmed check-in', async () => {
    const data = await fixture();
    await database.weeklySchedule.create({
      data: {
        branchId: data.branch.id,
        coachId: data.coach.id,
        endTime: '15:00',
        groupId: data.group.id,
        isActive: true,
        startTime: '14:00',
        validFrom: new Date('2026-08-01T00:00:00'),
        weekday: 7,
      },
    });

    const before = await database.lesson.count();
    const options = await workspace.scanOptions(ownerToken, data.student.id, '2026-08-23');
    const recurring = options.lessons.find(({ source }) => source === 'WEEKLY_SCHEDULE');
    expect(recurring).toMatchObject({ groupId: data.group.id });
    expect(recurring).not.toHaveProperty('lessonId');
    expect(await database.lesson.count()).toBe(before);
    if (!recurring) throw new Error('Weekly occurrence was not offered to the scanner.');

    await workspace.confirmScan(ownerToken, {
      groupId: recurring.groupId,
      startsAt: recurring.startsAt,
      studentId: data.student.id,
    });
    await workspace.confirmScan(ownerToken, {
      groupId: recurring.groupId,
      startsAt: recurring.startsAt,
      studentId: data.student.id,
    });

    const materialized = await database.lesson.findMany({
      where: { groupId: data.group.id, startsAt: new Date(recurring.startsAt) },
    });
    expect(materialized).toHaveLength(1);
    const materializedLesson = materialized[0];
    if (!materializedLesson) throw new Error('Weekly occurrence was not materialized.');
    expect(
      await database.attendance.count({
        where: { lessonId: materializedLesson.id, studentId: data.student.id },
      }),
    ).toBe(1);
    expect(
      await database.syncOutbox.count({
        where: {
          entityType: 'ATTENDANCE_CHECKIN',
          entityId: `${materializedLesson.id}:${data.student.id}`,
        },
      }),
    ).toBe(1);
  });

  it('keeps historical marked students visible after enrolment changes', async () => {
    const data = await fixture();
    await studio.saveAttendance(ownerToken, data.current.id, [
      { status: 'PRESENT', studentId: data.student.id },
    ]);
    await database.enrollment.updateMany({
      data: { leftAt: new Date('2026-08-24T00:00:00'), status: 'LEFT' },
      where: { studentId: data.student.id },
    });
    await application.archiveStudent(ownerToken, data.student.id);
    const detail = await studio.getAttendance(ownerToken, data.current.id);
    expect(detail.participants).toEqual([
      expect.objectContaining({ status: 'PRESENT', studentId: data.student.id }),
    ]);
  });

  it('includes current students added later and supports an audited manual participant', async () => {
    const data = await fixture();
    const laterStudent = await application.createStudent(ownerToken, {
      branchId: data.branch.id,
      firstName: 'Новая',
      lastName: 'Участница',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, data.group.id, {
      joinedAt: '2026-08-24',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: laterStudent.id,
    });
    const membershipBefore = await database.enrollment.findFirstOrThrow({
      where: { groupId: data.group.id, studentId: laterStudent.id },
    });

    expect((await studio.getAttendance(ownerToken, data.current.id)).participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          addedToGroupLater: true,
          studentId: laterStudent.id,
        }),
        expect.objectContaining({ studentId: data.student.id }),
      ]),
    );
    await studio.saveAttendance(data.adminToken, data.current.id, [
      { status: 'PRESENT', studentId: laterStudent.id },
    ]);
    expect(
      await database.attendance.findUniqueOrThrow({
        where: {
          lessonId_studentId: { lessonId: data.current.id, studentId: laterStudent.id },
        },
      }),
    ).toMatchObject({ status: 'PRESENT' });
    expect(
      await database.enrollment.findFirstOrThrow({
        where: { groupId: data.group.id, studentId: laterStudent.id },
      }),
    ).toMatchObject({
      joinedAt: membershipBefore.joinedAt,
      leftAt: membershipBefore.leftAt,
      status: membershipBefore.status,
    });

    const manualStudent = await application.createStudent(ownerToken, {
      branchId: data.branch.id,
      firstName: 'Гость',
      lastName: 'Занятия',
      status: 'ACTIVE',
    });
    await studio.saveManualAttendance(data.adminToken, data.current.id, {
      status: 'PRESENT',
      studentId: manualStudent.id,
    });
    await studio.saveManualAttendance(data.adminToken, data.current.id, {
      status: 'PRESENT',
      studentId: manualStudent.id,
    });
    expect(
      await database.attendance.count({
        where: { lessonId: data.current.id, studentId: manualStudent.id },
      }),
    ).toBe(1);
    expect(
      await database.enrollment.count({
        where: { groupId: data.group.id, studentId: manualStudent.id },
      }),
    ).toBe(0);
    expect(
      await database.auditLog.count({
        where: {
          action: 'ATTENDANCE_STUDENT_MANUALLY_ADDED',
          entityId: `${data.current.id}:${manualStudent.id}`,
        },
      }),
    ).toBe(1);
    await expect(
      studio.saveManualAttendance(data.coachToken, data.current.id, {
        status: 'PRESENT',
        studentId: manualStudent.id,
      }),
    ).rejects.toThrow(/недостаточно прав/iu);

    const otherBranchStudent = await application.createStudent(ownerToken, {
      branchId: data.otherBranch.id,
      firstName: 'Другой',
      lastName: 'Филиал',
      status: 'ACTIVE',
    });
    await expect(
      studio.saveManualAttendance(data.adminToken, data.current.id, {
        status: 'PRESENT',
        studentId: otherBranchStudent.id,
      }),
    ).rejects.toThrow('У вас нет доступа к этому филиалу.');
  });

  it('resolves and materializes a past weekly occurrence once and reconciles canonical effects', async () => {
    const data = await fixture();
    const pastDate = '2026-08-20';
    await database.weeklySchedule.create({
      data: {
        branchId: data.branch.id,
        coachId: data.coach.id,
        endTime: '19:30',
        groupId: data.group.id,
        isActive: true,
        startTime: '18:30',
        validFrom: new Date('2026-08-01T00:00:00'),
        weekday: 4,
      },
    });

    const pastDay = await workspace.today(ownerToken, pastDate);
    expect(pastDay.lessons).toEqual([
      expect.objectContaining({
        attendanceExpected: 1,
        source: 'WEEKLY_SCHEDULE',
      }),
    ]);
    const occurrence = pastDay.lessons[0];
    if (!occurrence) throw new Error('Historical occurrence was not resolved.');
    const firstLesson = await workspace.openOccurrence(ownerToken, {
      groupId: occurrence.groupId,
      startsAt: occurrence.startsAt,
    });
    const repeatedLesson = await workspace.openOccurrence(ownerToken, {
      groupId: occurrence.groupId,
      startsAt: occurrence.startsAt,
    });
    expect(repeatedLesson.id).toBe(firstLesson.id);
    expect(
      await database.lesson.count({
        where: { groupId: data.group.id, startsAt: new Date(occurrence.startsAt) },
      }),
    ).toBe(1);
    const laterStudent = await application.createStudent(ownerToken, {
      branchId: data.branch.id,
      firstName: 'Поздняя',
      lastName: 'Участница',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, data.group.id, {
      joinedAt: '2026-08-21',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: laterStudent.id,
    });
    expect((await studio.getAttendance(ownerToken, firstLesson.id)).participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ addedToGroupLater: true, studentId: laterStudent.id }),
      ]),
    );

    const finance = new FinanceService(database, application);
    const tariff = await finance.createTariff(ownerToken, {
      branchId: data.branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 4,
      name: 'Исторические посещения',
      price: 40_000,
      type: 'LESSON_PACK',
      validityDays: 60,
    });
    const subscription = await finance.createSubscription(ownerToken, {
      initialPayment: {
        amount: 40_000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
      },
      salePrice: 40_000,
      startsAt: '2026-08-01',
      studentId: data.student.id,
      tariffId: tariff.id,
    });
    const laterSubscription = await finance.createSubscription(ownerToken, {
      initialPayment: {
        amount: 40_000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
      },
      salePrice: 40_000,
      startsAt: '2026-08-01',
      studentId: laterStudent.id,
      tariffId: tariff.id,
    });
    const management = new ManagementService(database, application);
    await management.createPayrollRule(ownerToken, {
      amountPerAttendee: 10_000,
      branchId: data.branch.id,
      coachId: data.coach.id,
      groupId: data.group.id,
      isActive: true,
      type: 'PER_ATTENDEE',
      validFrom: '2026-08-01',
    });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: data.branch.id,
      dateFrom: pastDate,
      dateTo: pastDate,
    });

    await studio.saveAttendance(ownerToken, firstLesson.id, [
      { status: 'PRESENT', studentId: data.student.id },
      { status: 'PRESENT', studentId: laterStudent.id },
    ]);
    await studio.saveAttendance(ownerToken, firstLesson.id, [
      { status: 'PRESENT', studentId: data.student.id },
    ]);
    expect(await database.attendance.count({ where: { lessonId: firstLesson.id } })).toBe(2);
    expect((await finance.getSubscription(ownerToken, subscription.id)).lessonsUsed).toBe(1);
    expect((await finance.getSubscription(ownerToken, laterSubscription.id)).lessonsUsed).toBe(1);
    expect((await management.calculatePayrollPeriod(ownerToken, period.id)).totalAmount).toBe(
      20_000,
    );

    await studio.saveAttendance(ownerToken, firstLesson.id, [
      { status: 'ABSENT', studentId: laterStudent.id },
    ]);
    expect((await finance.getSubscription(ownerToken, laterSubscription.id)).lessonsUsed).toBe(0);
    expect((await management.calculatePayrollPeriod(ownerToken, period.id)).totalAmount).toBe(
      10_000,
    );

    await studio.saveAttendance(ownerToken, firstLesson.id, [
      { status: 'ABSENT', studentId: data.student.id },
    ]);
    expect((await finance.getSubscription(ownerToken, subscription.id)).lessonsUsed).toBe(0);
    expect((await management.calculatePayrollPeriod(ownerToken, period.id)).totalAmount).toBe(0);

    await studio.saveAttendance(ownerToken, firstLesson.id, [
      { status: 'PRESENT', studentId: data.student.id },
    ]);
    expect((await finance.getSubscription(ownerToken, subscription.id)).lessonsUsed).toBe(1);
    expect((await management.calculatePayrollPeriod(ownerToken, period.id)).totalAmount).toBe(
      10_000,
    );
    await expect(
      workspace.openOccurrence(data.coachToken, {
        groupId: occurrence.groupId,
        startsAt: occurrence.startsAt,
      }),
    ).rejects.toThrow('Рабочее место «Посещения» доступно владельцу и администраторам.');
  });
});

it('ranks current, upcoming and past scan choices deterministically', () => {
  const option = (
    lessonId: string,
    startsAt: string,
    endsAt: string,
  ): AttendanceScanLessonOption => ({
    branchName: 'Центр',
    endsAt,
    groupId: `group-${lessonId}`,
    groupName: lessonId,
    id: lessonId,
    lessonId,
    source: 'LESSON',
    startsAt,
  });
  expect(
    rankAttendanceOptions(
      [
        option('past', '2026-08-23T08:00:00', '2026-08-23T09:00:00'),
        option('future', '2026-08-23T12:00:00', '2026-08-23T13:00:00'),
        option('current', '2026-08-23T10:00:00', '2026-08-23T11:00:00'),
      ],
      new Date('2026-08-23T10:30:00'),
    ).map(({ lessonId }) => lessonId),
  ).toEqual(['current', 'future', 'past']);
});
