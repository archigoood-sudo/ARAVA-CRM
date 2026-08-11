import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudentSummary } from '@arava/shared';

import { CalendarService } from './calendar-service';
import {
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  INITIAL_OWNER_EMAIL,
  INITIAL_OWNER_PASSWORD,
  toSqliteUrl,
  type DatabaseClient,
} from './index';
import { ManagementService } from './management-service';
import { ApplicationService } from './services';
import { StudioService } from './studio-service';

describe('Sprint 4.1D attendance-based payroll', () => {
  let application: ApplicationService;
  let calendar: CalendarService;
  let database: DatabaseClient;
  let directory: string;
  let management: ManagementService;
  let ownerId: string;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-payroll-attendance-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'payroll.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    calendar = new CalendarService(database, application);
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
      newPassword: 'Owner!PayrollAttendance2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  it('uses only PRESENT, distinguishes pending/zero, honors substitution and stays idempotent', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Зарплатный филиал' });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach-attendance-payroll@arava.local',
      fullName: 'Тренер Основной',
      password: 'Coach!Payroll2026',
      role: 'COACH',
    });
    const substitute = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'substitute-attendance-payroll@arava.local',
      fullName: 'Тренер Замещающий',
      password: 'Substitute!Payroll2026',
      role: 'COACH',
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      coachId: coach.id,
      direction: 'Современный танец',
      name: 'Группа из двадцати',
      status: 'ACTIVE',
    });
    const students: StudentSummary[] = [];
    for (let index = 1; index <= 20; index += 1) {
      const student = await application.createStudent(ownerToken, {
        branchId: branch.id,
        firstName: `Ученик ${String(index)}`,
        lastName: 'Расчётный',
        status: 'ACTIVE',
      });
      students.push(student);
      await studio.addEnrollment(ownerToken, group.id, {
        joinedAt: '2026-08-01',
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: student.id,
      });
    }
    await management.createPayrollRule(ownerToken, {
      amountPerAttendee: 10_000,
      branchId: branch.id,
      coachId: coach.id,
      groupId: group.id,
      isActive: true,
      type: 'PER_ATTENDEE',
      validFrom: '2026-08-01',
    });
    await management.createPayrollRule(ownerToken, {
      amountPerAttendee: 10_000,
      branchId: branch.id,
      coachId: substitute.id,
      groupId: group.id,
      isActive: true,
      type: 'PER_ATTENDEE',
      validFrom: '2026-08-01',
    });

    const makeLesson = async (hour: number, completed: boolean) =>
      database.lesson.create({
        data: {
          attendanceCompletedAt: completed ? new Date('2026-08-10T20:00:00.000Z') : null,
          branchId: branch.id,
          coachId: coach.id,
          endsAt: new Date(`2026-08-10T${String(hour + 1).padStart(2, '0')}:00:00.000Z`),
          groupId: group.id,
          startsAt: new Date(`2026-08-10T${String(hour).padStart(2, '0')}:00:00.000Z`),
          status: 'COMPLETED',
        },
      });
    const eightPresent = await makeLesson(10, true);
    const threePresent = await makeLesson(12, true);
    const pending = await makeLesson(14, false);
    const zeroPresent = await makeLesson(16, true);
    const substituted = await makeLesson(18, true);
    await calendar.assignSubstitution(ownerToken, substituted.id, {
      reason: 'Плановая замена',
      substituteTrainerId: substitute.id,
    });
    const mark = async (lessonId: string, presentCount: number) =>
      database.attendance.createMany({
        data: students.map((student, index) => ({
          lessonId,
          markedAt: new Date('2026-08-10T20:00:00.000Z'),
          markedByUserId: ownerId,
          status: index < presentCount ? ('PRESENT' as const) : ('ABSENT' as const),
          studentId: student.id,
        })),
      });
    await mark(eightPresent.id, 8);
    await mark(threePresent.id, 3);
    await mark(zeroPresent.id, 0);
    await mark(substituted.id, 7);

    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: '2026-08-10',
      dateTo: '2026-08-10',
    });
    const first = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(first.pendingAttendance).toEqual([
      expect.objectContaining({ lessonId: pending.id, groupName: group.name }),
    ]);
    expect(first.accruals).toHaveLength(4);
    expect(first.totalAmount).toBe(180_000);
    expect(first.accruals.find(({ lessonId }) => lessonId === eightPresent.id)).toMatchObject({
      attendeeCount: 8,
      calculatedAmount: 80_000,
    });
    expect(first.accruals.find(({ lessonId }) => lessonId === threePresent.id)).toMatchObject({
      attendeeCount: 3,
      calculatedAmount: 30_000,
    });
    expect(first.accruals.find(({ lessonId }) => lessonId === zeroPresent.id)).toMatchObject({
      attendeeCount: 0,
      calculatedAmount: 0,
    });
    expect(first.accruals.find(({ lessonId }) => lessonId === substituted.id)).toMatchObject({
      attendeeCount: 7,
      calculatedAmount: 70_000,
      coachId: substitute.id,
    });
    expect(
      first.accruals.some(
        ({ coachId, lessonId }) => coachId === coach.id && lessonId === substituted.id,
      ),
    ).toBe(false);
    await expect(management.approvePayrollPeriod(ownerToken, period.id)).rejects.toThrow(
      'Посещаемость заполнена не для всех занятий',
    );

    await database.attendance.update({
      data: { status: 'PRESENT' },
      where: {
        lessonId_studentId: { lessonId: substituted.id, studentId: students[7]?.id ?? '' },
      },
    });
    const recalculated = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(recalculated.totalAmount).toBe(190_000);
    expect(recalculated.accruals.find(({ lessonId }) => lessonId === substituted.id)).toMatchObject(
      {
        attendeeCount: 8,
        calculatedAmount: 80_000,
      },
    );
    await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(await database.payrollAccrual.count({ where: { payrollPeriodId: period.id } })).toBe(4);

    await database.enrollment.updateMany({
      data: { status: 'LEFT' },
      where: { groupId: group.id },
    });
    expect((await management.calculatePayrollPeriod(ownerToken, period.id)).totalAmount).toBe(
      190_000,
    );
    await database.lesson.update({
      data: { attendanceCompletedAt: new Date('2026-08-10T20:00:00.000Z') },
      where: { id: pending.id },
    });
    const complete = await management.calculatePayrollPeriod(ownerToken, period.id);
    expect(complete.pendingAttendance).toEqual([]);
    expect(complete.accruals.find(({ lessonId }) => lessonId === pending.id)).toMatchObject({
      attendeeCount: 0,
      calculatedAmount: 0,
    });
    expect((await management.approvePayrollPeriod(ownerToken, period.id)).status).toBe('APPROVED');
    await expect(management.calculatePayrollPeriod(ownerToken, period.id)).rejects.toThrow(
      'Утверждённый расчёт нельзя изменить',
    );
  });
});
