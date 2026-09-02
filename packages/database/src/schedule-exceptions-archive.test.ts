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
    const actor = await application.authenticate(ownerToken);
    const originalDate = new Date(2026, 7, 20, 12);
    const originalOccurrence = (
      await new LessonOccurrenceService(database).resolveDay(actor, originalDate)
    ).find(({ groupId }) => groupId === group.id);
    expect(originalOccurrence).toBeDefined();
    const occurrence = await studio.materializeLessonOccurrence(ownerToken, {
      groupId: group.id,
      startsAt: originalOccurrence?.startsAt.toISOString() ?? '',
    });
    const movedStartsAt = new Date(2026, 7, 21, 18);
    const movedEndsAt = new Date(2026, 7, 21, 19);
    const moved = await studio.rescheduleLesson(ownerToken, occurrence.id, {
      coachId: coach.id,
      endsAt: movedEndsAt.toISOString(),
      roomId: room.id,
      startsAt: movedStartsAt.toISOString(),
    });
    expect(moved).toMatchObject({
      originalStartsAt: originalOccurrence?.startsAt.toISOString(),
      startsAt: movedStartsAt.toISOString(),
    });
    expect(await database.weeklySchedule.findUnique({ where: { id: schedule.id } })).toMatchObject({
      isActive: true,
      startTime: '18:00',
      weekday: 4,
    });
    const oldDay = await new LessonOccurrenceService(database).resolveDay(actor, originalDate);
    const newDay = await new LessonOccurrenceService(database).resolveDay(actor, movedStartsAt);
    expect(oldDay.filter(({ groupId }) => groupId === group.id)).toHaveLength(0);
    expect(newDay.filter(({ groupId }) => groupId === group.id)).toEqual([
      expect.objectContaining({
        lessonId: occurrence.id,
        startsAt: movedStartsAt,
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
    const studentDeletePreview = await archive.previewPermanentlyDelete(
      ownerToken,
      'STUDENT',
      student.id,
    );
    expect(studentDeletePreview.name).toBe('Петрова Мила');
    expect(studentDeletePreview.dependencies).toContainEqual({
      count: 1,
      key: 'enrollments',
      label: 'Участия в группах',
    });
    await expect(
      archive.deletePermanently(ownerToken, 'GROUP', activeEmptyGroup.id, {
        confirmationName: activeEmptyGroup.name,
      }),
    ).rejects.toThrow('не находится в архиве');
    await archive.deletePermanently(ownerToken, 'GROUP', safeGroup.id, {
      confirmationName: safeGroup.name,
    });
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

  it('permanently deletes an archived student and owned records but retains shared media', async () => {
    const { branch, coach, group, student } = await foundation();
    const otherStudent = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Лев',
      lastName: 'Смирнов',
      status: 'ACTIVE',
    });
    const lesson = await studio.createLesson(ownerToken, {
      coachId: coach.id,
      endsAt: '2026-08-27T19:00:00+03:00',
      groupId: group.id,
      startsAt: '2026-08-27T18:00:00+03:00',
    });
    await studio.saveAttendance(ownerToken, lesson.id, [
      { status: 'PRESENT', studentId: student.id },
    ]);
    const tariff = await finance.createTariff(ownerToken, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 4,
      name: 'Удаляемый абонемент',
      price: 40_000,
      type: 'LESSON_PACK',
    });
    await finance.createSubscription(ownerToken, {
      initialPayment: {
        amount: 40_000,
        paidAt: '2026-08-01T09:00:00+03:00',
        paymentMethod: 'CASH',
      },
      salePrice: 40_000,
      startsAt: '2026-08-01',
      studentId: student.id,
      tariffId: tariff.id,
    });
    const sharedMediaId = '11111111-1111-1111-1111-111111111111.pdf';
    const privateMediaId = '22222222-2222-2222-2222-222222222222.pdf';
    await database.studentDocument.createMany({
      data: [
        {
          attachmentFileName: 'shared.pdf',
          attachmentMediaId: sharedMediaId,
          attachmentMimeType: 'application/pdf',
          documentDate: new Date('2026-08-01T00:00:00+03:00'),
          documentType: 'CONTRACT',
          source: 'EXISTING',
          status: 'SIGNED',
          studentId: student.id,
        },
        {
          attachmentFileName: 'private.pdf',
          attachmentMediaId: privateMediaId,
          attachmentMimeType: 'application/pdf',
          documentDate: new Date('2026-08-02T00:00:00+03:00'),
          documentType: 'MEDIA_CONSENT',
          source: 'EXISTING',
          status: 'SIGNED',
          studentId: student.id,
        },
        {
          attachmentFileName: 'shared.pdf',
          attachmentMediaId: sharedMediaId,
          attachmentMimeType: 'application/pdf',
          documentDate: new Date('2026-08-01T00:00:00+03:00'),
          documentType: 'CONTRACT',
          source: 'EXISTING',
          status: 'SIGNED',
          studentId: otherStudent.id,
        },
      ],
    });
    await application.archiveStudent(ownerToken, student.id);
    const preview = await archive.previewPermanentlyDelete(ownerToken, 'STUDENT', student.id);
    expect(preview.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ count: 1, key: 'attendance' }),
        expect.objectContaining({ count: 2, key: 'documents' }),
        expect.objectContaining({ key: 'payments' }),
        expect.objectContaining({ key: 'subscriptions' }),
      ]),
    );
    const result = await archive.deletePermanently(ownerToken, 'STUDENT', student.id, {
      confirmationName: preview.name,
    });
    expect(result.documentMediaIds).toEqual([privateMediaId]);
    expect(await database.student.findUnique({ where: { id: student.id } })).toBeNull();
    expect(await database.attendance.count({ where: { studentId: student.id } })).toBe(0);
    expect(await database.subscription.count({ where: { studentId: student.id } })).toBe(0);
    expect(await database.payment.count({ where: { studentId: student.id } })).toBe(0);
    expect(await database.studentDocument.count({ where: { studentId: student.id } })).toBe(0);
    expect(
      await database.studentDocument.count({ where: { attachmentMediaId: sharedMediaId } }),
    ).toBe(1);
    const deletionAudit = await database.auditLog.findFirst({
      where: { action: 'STUDENT_PERMANENTLY_DELETED', entityId: student.id },
    });
    expect(deletionAudit?.detail).toContain('documents');
  });

  it('deletes trainer-owned payroll data and detaches shared schedule records', async () => {
    const { branch, coach, group } = await foundation();
    const lesson = await studio.createLesson(ownerToken, {
      coachId: coach.id,
      endsAt: '2026-08-28T19:00:00+03:00',
      groupId: group.id,
      startsAt: '2026-08-28T18:00:00+03:00',
    });
    await management.saveTrainerPayoutProfile(ownerToken, {
      effectiveFrom: '2026-08-01',
      rules: PAYOUT_CATEGORIES.map((category) =>
        category === 'REGULAR_ATTENDANCE'
          ? { amount: 1_000, category, mode: 'FIXED_PER_LESSON' as const }
          : { category },
      ),
      trainerId: coach.id,
    });
    const period = await management.createPayrollPeriod(ownerToken, {
      branchId: branch.id,
      dateFrom: '2026-08-28',
      dateTo: '2026-08-28',
    });
    await management.calculatePayrollPeriod(ownerToken, period.id);
    const coachRow = await database.user.findUniqueOrThrow({ where: { id: coach.id } });
    await application.updateUser(ownerToken, coach.id, {
      branchIds: [branch.id],
      fullName: coachRow.fullName,
      isActive: false,
      role: 'COACH',
    });
    const preview = await archive.previewPermanentlyDelete(ownerToken, 'TRAINER', coach.id);
    expect(preview.preservedSharedRecords.join(' ')).toContain('Занятия');
    await archive.deletePermanently(ownerToken, 'TRAINER', coach.id, {
      confirmationName: preview.name,
    });
    expect(await database.user.findUnique({ where: { id: coach.id } })).toBeNull();
    expect(await database.trainerPayoutRule.count({ where: { trainerId: coach.id } })).toBe(0);
    expect(await database.payrollAccrual.count({ where: { coachId: coach.id } })).toBe(0);
    expect(await database.lesson.findUnique({ where: { id: lesson.id } })).toEqual(
      expect.objectContaining({ coachId: null }),
    );
    expect(await database.danceGroup.findUnique({ where: { id: group.id } })).toEqual(
      expect.objectContaining({ coachId: null }),
    );
  });

  it('rolls the entire permanent deletion back on a database error', async () => {
    const { student } = await foundation();
    await application.archiveStudent(ownerToken, student.id);
    await database.$executeRawUnsafe(`
      CREATE TRIGGER fail_student_delete
      BEFORE DELETE ON Student
      WHEN OLD.id = '${student.id}'
      BEGIN
        SELECT RAISE(ABORT, 'forced rollback');
      END;
    `);
    await expect(
      archive.deletePermanently(ownerToken, 'STUDENT', student.id, {
        confirmationName: `${student.lastName} ${student.firstName}`,
      }),
    ).rejects.toThrow();
    expect(await database.student.findUnique({ where: { id: student.id } })).not.toBeNull();
    expect(await database.enrollment.count({ where: { studentId: student.id } })).toBe(1);
    expect(
      await database.auditLog.count({
        where: { action: 'STUDENT_PERMANENTLY_DELETED', entityId: student.id },
      }),
    ).toBe(0);
  });

  it('keeps archive non-destructive and restricts permanent deletion to OWNER', async () => {
    const { branch, student } = await foundation();
    await application.archiveStudent(ownerToken, student.id);
    expect(await database.enrollment.count({ where: { studentId: student.id } })).toBe(1);
    const admin = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'archive-admin@arava.local',
      fullName: 'Администратор архива',
      password: 'Admin!Archive61',
      role: 'ADMIN',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Archive61',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Archive61',
      newPassword: 'Admin!ArchiveChanged61',
    });
    await expect(
      archive.previewPermanentlyDelete(adminSession.token, 'STUDENT', student.id),
    ).rejects.toThrow('только владельцу');
    expect(await database.student.findUnique({ where: { id: student.id } })).not.toBeNull();
  });
});
