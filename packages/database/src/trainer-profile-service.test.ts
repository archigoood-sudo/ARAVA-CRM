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
import { TrainerProfileService } from './trainer-profile-service';

describe('Sprint 4.3D trainer profile', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let profiles: TrainerProfileService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-trainer-profile-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'trainer.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    profiles = new TrainerProfileService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!TrainerProfile2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function foundation() {
    const branch = await application.createBranch(ownerToken, { name: 'Центральный' });
    const hiddenBranch = await application.createBranch(ownerToken, { name: 'Северный' });
    const trainer = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'trainer-profile@arava.local',
      fullName: 'Анна Тренерова',
      password: 'Trainer!Profile2026',
      phone: '+79990001010',
      role: 'COACH',
      trainerDescription: 'Тренер основной группы.',
    });
    const substitute = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'substitute-profile@arava.local',
      fullName: 'Ирина Замена',
      password: 'Substitute!Profile2026',
      role: 'COACH',
    });
    const hiddenTrainer = await application.createUser(ownerToken, {
      branchIds: [hiddenBranch.id],
      email: 'hidden-profile@arava.local',
      fullName: 'Скрытый Тренер',
      password: 'Hidden!Profile2026',
      role: 'COACH',
    });
    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        capacity: 20,
        coachId: trainer.id,
        direction: 'Хип-хоп',
        name: 'Основная группа',
        status: 'ACTIVE',
      },
    });
    const hiddenGroup = await database.danceGroup.create({
      data: {
        branchId: hiddenBranch.id,
        capacity: 15,
        coachId: hiddenTrainer.id,
        direction: 'Балет',
        name: 'Скрытая группа',
        status: 'ACTIVE',
      },
    });
    await database.danceGroup.create({
      data: {
        archivedAt: new Date(),
        branchId: branch.id,
        capacity: 12,
        coachId: trainer.id,
        direction: 'Контемпорари',
        name: 'Архивная группа',
        status: 'ARCHIVED',
      },
    });
    const now = new Date();
    const payrollMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 10);
    const month = `${String(payrollMonth.getFullYear())}-${String(payrollMonth.getMonth() + 1).padStart(2, '0')}`;
    const past = payrollMonth;
    const replacementPast = new Date(payrollMonth.getTime() + 24 * 60 * 60_000);
    const future = new Date(now.getTime() + 3 * 86_400_000);
    const studentA = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Алина',
      lastName: 'Первая',
      status: 'ACTIVE',
    });
    const studentB = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Вера',
      lastName: 'Вторая',
      status: 'ACTIVE',
    });
    const studentC = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мария',
      lastName: 'Третья',
      status: 'ACTIVE',
    });
    await database.enrollment.createMany({
      data: [studentA, studentB, studentC].map((student) => ({
        groupId: group.id,
        joinedAt: past,
        status: 'ACTIVE' as const,
        studentId: student.id,
      })),
    });
    await database.weeklySchedule.create({
      data: {
        branchId: branch.id,
        coachId: trainer.id,
        endTime: '19:00',
        groupId: group.id,
        isActive: true,
        startTime: '18:00',
        validFrom: past,
        weekday: 2,
      },
    });
    const conducted = await database.lesson.create({
      data: {
        attendanceCompletedAt: past,
        branchId: branch.id,
        coachId: trainer.id,
        endsAt: new Date(past.getTime() + 3_600_000),
        groupId: group.id,
        startsAt: past,
        status: 'COMPLETED',
      },
    });
    await database.attendance.createMany({
      data: [
        {
          lessonId: conducted.id,
          markedAt: past,
          markedByUserId: trainer.id,
          status: 'PRESENT',
          studentId: studentA.id,
        },
        {
          lessonId: conducted.id,
          markedAt: past,
          markedByUserId: trainer.id,
          status: 'ABSENT',
          studentId: studentB.id,
        },
        {
          lessonId: conducted.id,
          markedAt: past,
          markedByUserId: trainer.id,
          status: 'LATE',
          studentId: studentC.id,
        },
      ],
    });
    const replaced = await database.lesson.create({
      data: {
        attendanceCompletedAt: replacementPast,
        branchId: branch.id,
        coachId: substitute.id,
        endsAt: new Date(replacementPast.getTime() + 3_600_000),
        groupId: group.id,
        startsAt: replacementPast,
        status: 'COMPLETED',
      },
    });
    await database.trainerSubstitution.create({
      data: {
        createdByUserId: trainer.id,
        lessonId: replaced.id,
        originalTrainerId: trainer.id,
        substituteTrainerId: substitute.id,
      },
    });
    await database.attendance.create({
      data: {
        lessonId: replaced.id,
        markedAt: replacementPast,
        markedByUserId: substitute.id,
        status: 'PRESENT',
        studentId: studentA.id,
      },
    });
    const pending = await database.lesson.create({
      data: {
        branchId: branch.id,
        coachId: trainer.id,
        endsAt: new Date(replacementPast.getTime() + 7_200_000),
        groupId: group.id,
        startsAt: new Date(replacementPast.getTime() + 3_900_000),
        status: 'COMPLETED',
      },
    });
    await database.lesson.create({
      data: {
        branchId: branch.id,
        coachId: trainer.id,
        endsAt: new Date(future.getTime() + 3_600_000),
        groupId: group.id,
        startsAt: future,
        status: 'PLANNED',
      },
    });
    await database.payrollRule.create({
      data: {
        amountPerAttendee: 10_000,
        branchId: branch.id,
        coachId: trainer.id,
        groupId: group.id,
        isActive: true,
        type: 'PER_ATTENDEE',
        validFrom: new Date(payrollMonth.getFullYear(), payrollMonth.getMonth(), 1),
      },
    });
    const period = await database.payrollPeriod.create({
      data: {
        createdByUserId: trainer.id,
        dateFrom: new Date(payrollMonth.getFullYear(), payrollMonth.getMonth(), 1),
        dateTo: new Date(payrollMonth.getFullYear(), payrollMonth.getMonth() + 1, 0, 23, 59, 59),
        status: 'APPROVED',
      },
    });
    await database.payrollAccrual.create({
      data: {
        attendeeCount: 1,
        baseAmount: 10_000,
        branchId: branch.id,
        calculatedAmount: 10_000,
        coachId: trainer.id,
        finalAmount: 10_000,
        groupId: group.id,
        lessonId: conducted.id,
        payrollPeriodId: period.id,
        type: 'PER_ATTENDEE',
      },
    });
    await database.payrollPeriod.create({
      data: {
        branchId: branch.id,
        createdByUserId: trainer.id,
        dateFrom: new Date(payrollMonth.getFullYear(), payrollMonth.getMonth(), 1),
        dateTo: new Date(payrollMonth.getFullYear(), payrollMonth.getMonth() + 1, 0, 23, 59, 59),
        status: 'DRAFT',
      },
    });
    return {
      branch,
      conducted,
      group,
      hiddenBranch,
      hiddenGroup,
      hiddenTrainer,
      month,
      pending,
      substitute,
      trainer,
    };
  }

  it('aggregates bounded schedule, groups, actual activity, PRESENT attendance and stored payroll', async () => {
    const context = await foundation();
    const overview = await profiles.getOverview(ownerToken, context.trainer.id, context.month);
    expect(overview.trainer).toMatchObject({
      branches: [{ id: context.branch.id, name: 'Центральный' }],
      directions: ['Хип-хоп'],
      fullName: 'Анна Тренерова',
      isActive: true,
      trainerDescription: 'Тренер основной группы.',
    });
    expect(overview.groups).toEqual([
      expect.objectContaining({ name: 'Основная группа', studentCount: 3 }),
    ]);
    expect(overview.historicalGroups).toEqual([
      expect.objectContaining({ name: 'Архивная группа', status: 'ARCHIVED' }),
    ]);
    expect(overview.schedule).toHaveLength(1);
    expect(overview.activity).toMatchObject({ conducted: 2, substitutionsConducted: 0 });
    expect(overview.attendance).toEqual({
      averagePresent: 2,
      completedLessons: 1,
      percentage: 67,
      presentTotal: 2,
    });
    expect(overview.payroll).toMatchObject({
      accruedAmount: 10_000,
      approvedAmount: 10_000,
      lessonsIncluded: 1,
      paidAmount: 0,
      pendingAttendanceCount: 1,
      presentCount: 1,
    });
    expect(overview.substitutions.outgoing).toHaveLength(1);
    expect(overview.attention.map(({ code }) => code)).toContain('PENDING_ATTENDANCE');
  });

  it('attributes substituted lessons and attendance to the actual trainer only', async () => {
    const context = await foundation();
    const substitute = await profiles.getOverview(ownerToken, context.substitute.id, context.month);
    expect(substitute.activity).toMatchObject({ conducted: 1, substitutionsConducted: 1 });
    expect(substitute.attendance.presentTotal).toBe(1);
    const regular = await profiles.getOverview(ownerToken, context.trainer.id, context.month);
    expect(regular.activity.scheduled).toBeGreaterThan(regular.activity.conducted);
    expect(regular.substitutions.outgoing[0]).toMatchObject({
      substituteTrainerName: 'Ирина Замена',
    });
  });

  it('enforces self-service and ADMIN branch isolation while preserving inactive history', async () => {
    const context = await foundation();
    const trainerSession = await application.login({
      email: context.trainer.email,
      password: 'Trainer!Profile2026',
    });
    await application.changePassword(trainerSession.token, {
      currentPassword: 'Trainer!Profile2026',
      newPassword: 'Trainer!ProfileChanged2026',
    });
    await expect(
      profiles.getOverview(trainerSession.token, context.trainer.id, context.month),
    ).resolves.toMatchObject({ permissions: { ownProfile: true } });
    await expect(
      profiles.getOverview(trainerSession.token, context.substitute.id, context.month),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION' });

    const admin = await application.createUser(ownerToken, {
      branchIds: [context.branch.id],
      email: 'trainer-admin@arava.local',
      fullName: 'Администратор Тренеров',
      password: 'Admin!Trainer2026',
      role: 'ADMIN',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Trainer2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Trainer2026',
      newPassword: 'Admin!TrainerChanged2026',
    });
    await expect(
      profiles.getOverview(adminSession.token, context.trainer.id, context.month),
    ).resolves.toMatchObject({
      groups: [expect.objectContaining({ branchId: context.branch.id })],
    });
    await expect(
      profiles.getOverview(adminSession.token, context.hiddenTrainer.id, context.month),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION' });

    await application.updateUser(ownerToken, context.trainer.id, {
      branchIds: [context.branch.id],
      fullName: context.trainer.fullName,
      isActive: false,
      phone: context.trainer.phone,
      role: 'COACH',
    });
    const inactive = await profiles.getOverview(ownerToken, context.trainer.id, context.month);
    expect(inactive.trainer.isActive).toBe(false);
    expect(inactive.trainer.trainerDescription).toBe('Тренер основной группы.');
    expect(inactive.activity.conducted).toBeGreaterThan(0);
    expect(inactive.payroll.details).toHaveLength(1);
    expect(inactive.attention.map(({ code }) => code)).toContain('INACTIVE_ASSIGNED');
  });
});
