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
import { StudentProfileService } from './student-profile-service';

describe('Sprint 4.2A student profile', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let profiles: StudentProfileService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-profile-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'profile.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    profiles = new StudentProfileService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Profile2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function foundation() {
    const branch = await application.createBranch(ownerToken, { name: 'Профильный филиал' });
    const otherBranch = await application.createBranch(ownerToken, { name: 'Закрытый филиал' });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'profile-coach@arava.local',
      fullName: 'Тренер Профиля',
      password: 'Coach!Profile2026',
      role: 'COACH',
    });
    const student = await application.createStudent(ownerToken, {
      birthDate: '2015-04-12',
      branchId: branch.id,
      firstName: 'Анна',
      lastName: 'Профильная',
      status: 'ACTIVE',
    });
    await application.createContact(ownerToken, student.id, {
      fullName: 'Марина Профильная',
      isPrimary: true,
      phone: '+79990001122',
      relationship: 'Мама',
      whatsapp: true,
    });
    const hiddenStudent = await application.createStudent(ownerToken, {
      branchId: otherBranch.id,
      firstName: 'Скрытый',
      lastName: 'Ученик',
      status: 'ACTIVE',
    });
    const now = new Date();
    const future = new Date(now.getTime() + 2 * 86_400_000);
    const past = new Date(now.getTime() - 2 * 86_400_000);
    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        capacity: 20,
        coachId: coach.id,
        direction: 'Хип-хоп',
        name: 'Профильная группа',
        status: 'ACTIVE',
      },
    });
    const otherGroup = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        capacity: 20,
        direction: 'Балет',
        name: 'Чужая группа',
        status: 'ACTIVE',
      },
    });
    await database.enrollment.createMany({
      data: [
        { groupId: group.id, joinedAt: now, status: 'ACTIVE', studentId: student.id },
        { groupId: otherGroup.id, joinedAt: now, status: 'ACTIVE', studentId: student.id },
      ],
    });
    await database.weeklySchedule.create({
      data: {
        branchId: branch.id,
        endTime: '19:00',
        groupId: group.id,
        isActive: true,
        startTime: '18:00',
        validFrom: now,
        weekday: 2,
      },
    });
    const completedLesson = await database.lesson.create({
      data: {
        attendanceCompletedAt: now,
        branchId: branch.id,
        coachId: coach.id,
        endsAt: new Date(past.getTime() + 3_600_000),
        groupId: group.id,
        startsAt: past,
        status: 'COMPLETED',
      },
    });
    await database.lesson.create({
      data: {
        branchId: branch.id,
        coachId: coach.id,
        endsAt: new Date(future.getTime() + 3_600_000),
        groupId: group.id,
        startsAt: future,
        status: 'PLANNED',
      },
    });
    await database.attendance.create({
      data: {
        lessonId: completedLesson.id,
        markedAt: now,
        markedByUserId: coach.id,
        status: 'PRESENT',
        studentId: student.id,
      },
    });
    const tariff = await database.tariff.create({
      data: { lessonCount: 10, name: '10 занятий', price: 10_000, type: 'LESSON_PACK' },
    });
    const subscription = await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: coach.id,
        lessonLimit: 10,
        lessonsUsed: 8,
        purchasedAt: now,
        salePrice: 10_000,
        startsAt: past,
        status: 'ACTIVE',
        studentId: student.id,
        tariffId: tariff.id,
      },
    });
    await database.payment.create({
      data: {
        amount: 6_000,
        branchId: branch.id,
        createdByUserId: coach.id,
        paidAt: now,
        paymentMethod: 'CARD',
        studentId: student.id,
        subscriptionId: subscription.id,
      },
    });
    const card = await database.membershipCard.create({
      data: {
        barcode: '0000042001',
        createdByUserId: coach.id,
        issuedAt: now,
        status: 'ASSIGNED',
        studentId: student.id,
      },
    });
    await database.cardScanEvent.create({
      data: {
        barcode: card.barcode,
        cardId: card.id,
        result: 'OPENED',
        studentId: student.id,
      },
    });
    return { branch, coach, hiddenStudent, otherGroup, student };
  }

  it('aggregates operational, finance, attendance, card, notes, warnings and history', async () => {
    const context = await foundation();
    const note = await profiles.createNote(ownerToken, context.student.id, {
      text: 'Позвонить перед занятием',
    });
    const overview = await profiles.getOverview(ownerToken, context.student.id);
    expect(overview).toMatchObject({
      access: 'ADMIN',
      attendance: { attended: 1, percentage: 100 },
      card: { barcode: '0000042001', status: 'ASSIGNED' },
      currentSubscription: { debt: 4_000, remainingLessons: 2, tariffName: '10 занятий' },
      totalDebt: 4_000,
    });
    expect(overview.contacts).toHaveLength(1);
    expect(overview.groups).toHaveLength(2);
    expect(overview.upcomingLessons).toHaveLength(1);
    expect(overview.recentPayments).toHaveLength(1);
    expect(overview.notes).toEqual([expect.objectContaining({ id: note.id })]);
    expect(overview.history).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'STUDENT_NOTE_CREATED' })]),
    );
    expect(overview.warnings.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['DEBT', 'LOW_BALANCE']),
    );
    await profiles.updateNote(ownerToken, note.id, { text: 'Заметка изменена' });
    await profiles.archiveNote(ownerToken, note.id);
    expect((await profiles.getOverview(ownerToken, context.student.id)).notes).toEqual([]);
    await application.archiveStudent(ownerToken, context.student.id);
    const archived = await profiles.getOverview(ownerToken, context.student.id);
    expect(archived.student.status).toBe('ARCHIVED');
    expect(archived.currentSubscription?.tariffName).toBe('10 занятий');
    expect(archived.card?.barcode).toBe('0000042001');
  });

  it('enforces branch isolation and returns a trainer-safe projection', async () => {
    const context = await foundation();
    const admin = await application.createUser(ownerToken, {
      branchIds: [context.branch.id],
      email: 'profile-admin@arava.local',
      fullName: 'Администратор Профиля',
      password: 'Admin!Profile2026',
      role: 'ADMIN',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Profile2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Profile2026',
      newPassword: 'Admin!ProfileChanged2026',
    });
    await expect(
      profiles.getOverview(adminSession.token, context.student.id),
    ).resolves.toMatchObject({
      access: 'ADMIN',
    });
    await expect(
      profiles.getOverview(adminSession.token, context.hiddenStudent.id),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION' });
    const coachSession = await application.login({
      email: context.coach.email,
      password: 'Coach!Profile2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Profile2026',
      newPassword: 'Coach!ProfileChanged2026',
    });
    const safe = await profiles.getOverview(coachSession.token, context.student.id);
    expect(safe).toMatchObject({
      access: 'TRAINER',
      card: undefined,
      contacts: [],
      currentSubscription: undefined,
      history: [],
      notes: [],
      recentPayments: [],
      totalDebt: undefined,
    });
    expect(safe.groups.map(({ groupId }) => groupId)).not.toContain(context.otherGroup.id);
    await expect(
      profiles.getOverview(coachSession.token, context.hiddenStudent.id),
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION',
    });
    await expect(
      profiles.createNote(coachSession.token, context.student.id, { text: 'Нельзя' }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION' });
  });
});
