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
    const upcomingLesson = await database.lesson.create({
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
    return {
      branch,
      coach,
      completedLesson,
      hiddenStudent,
      otherBranch,
      otherGroup,
      student,
      upcomingLesson,
    };
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
    expect(overview.upcomingLessons.length).toBeGreaterThanOrEqual(1);
    expect(overview.upcomingLessons).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: context.upcomingLesson.id })]),
    );
    expect(overview.recentPayments).toHaveLength(1);
    expect(overview.notes).toEqual([expect.objectContaining({ id: note.id })]);
    expect(overview.history).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'STUDENT_NOTE_CREATED' })]),
    );
    expect(overview.warnings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('student:debt:'),
        expect.stringContaining('attendance:uncovered:'),
      ]),
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

  it('builds subscriptions, uncovered debt, membership history, trials and deterministic actions', async () => {
    const context = await foundation();
    const futureGroup = await database.danceGroup.create({
      data: {
        branchId: context.branch.id,
        capacity: 20,
        direction: 'Contemporary',
        name: 'Будущая группа',
        status: 'RECRUITING',
      },
    });
    const formerGroup = await database.danceGroup.create({
      data: {
        branchId: context.branch.id,
        capacity: 20,
        direction: 'Jazz',
        name: 'Прошлая группа',
        status: 'ACTIVE',
      },
    });
    const now = new Date();
    await database.enrollment.createMany({
      data: [
        {
          groupId: futureGroup.id,
          joinedAt: new Date(now.getTime() + 5 * 86_400_000),
          status: 'ACTIVE',
          studentId: context.student.id,
        },
        {
          groupId: formerGroup.id,
          joinedAt: new Date(now.getTime() - 20 * 86_400_000),
          leftAt: new Date(now.getTime() - 5 * 86_400_000),
          status: 'LEFT',
          studentId: context.student.id,
        },
      ],
    });
    const extraTariff = await database.tariff.create({
      data: { lessonCount: 4, name: 'Ещё 4 занятия', price: 3_000, type: 'LESSON_PACK' },
    });
    const extraSubscription = await database.subscription.create({
      data: {
        branchId: context.branch.id,
        createdByUserId: context.coach.id,
        lessonLimit: 4,
        purchasedAt: now,
        salePrice: 3_000,
        startsAt: now,
        status: 'ACTIVE',
        studentId: context.student.id,
        tariffId: extraTariff.id,
      },
    });
    await database.payment.create({
      data: {
        amount: 3_000,
        branchId: context.branch.id,
        createdByUserId: context.coach.id,
        paidAt: now,
        paymentMethod: 'CASH',
        studentId: context.student.id,
        subscriptionId: extraSubscription.id,
      },
    });
    await database.tariff.create({
      data: {
        branchId: context.branch.id,
        lessonCount: 1,
        name: 'Разовое занятие',
        price: 450,
        type: 'SINGLE_LESSON',
      },
    });
    await database.trialAppointment.create({
      data: {
        createdByUserId: context.coach.id,
        externalLeadId: `student:${context.student.id}`,
        groupId: context.otherGroup.id,
        lessonId: context.upcomingLesson.id,
        studentId: context.student.id,
      },
    });

    const overview = await profiles.getOverview(ownerToken, context.student.id);
    expect(overview.activeSubscriptions).toHaveLength(2);
    expect(overview.finance).toMatchObject({
      uncoveredDebt: 450,
      uncoveredAttendances: [expect.objectContaining({ lessonId: context.completedLesson.id })],
    });
    expect(overview.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: futureGroup.id, segment: 'FUTURE' }),
        expect.objectContaining({ groupId: formerGroup.id, segment: 'FORMER' }),
      ]),
    );
    expect(overview.trials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lessonId: context.upcomingLesson.id, state: 'SCHEDULED' }),
      ]),
    );
    expect(overview.recentPayments[0]?.purpose).toBeTypeOf('string');
    expect(overview.primaryAction).toMatchObject({ kind: 'PAYMENT' });
    expect(overview.attentionItems.length).toBeGreaterThan(0);
  });

  it('returns a useful empty workspace and selects sale as the primary action', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Пустой профиль' });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Новый',
      lastName: 'Ученик',
      status: 'ACTIVE',
    });
    const overview = await profiles.getOverview(ownerToken, student.id);
    expect(overview).toMatchObject({
      activeSubscriptions: [],
      attendance: { recent: [] },
      groups: [],
      primaryAction: { kind: 'SALE', label: 'Продать абонемент' },
      recentPayments: [],
      trials: [],
    });
    expect(overview.finance?.totalDebt).toBe(0);
  });

  it('enforces branch isolation and returns a trainer-safe projection', async () => {
    const context = await foundation();
    const foreignGroup = await database.danceGroup.create({
      data: {
        branchId: context.otherBranch.id,
        capacity: 10,
        direction: 'Скрытое направление',
        name: 'Группа другого филиала',
        status: 'ACTIVE',
      },
    });
    await database.enrollment.create({
      data: {
        groupId: foreignGroup.id,
        joinedAt: new Date(),
        status: 'ACTIVE',
        studentId: context.student.id,
      },
    });
    const foreignTariff = await database.tariff.create({
      data: {
        branchId: context.otherBranch.id,
        lessonCount: 2,
        name: 'Скрытый тариф',
        price: 2_000,
        type: 'LESSON_PACK',
      },
    });
    await database.subscription.create({
      data: {
        branchId: context.otherBranch.id,
        createdByUserId: context.coach.id,
        lessonLimit: 2,
        purchasedAt: new Date(),
        salePrice: 2_000,
        startsAt: new Date(),
        status: 'ACTIVE',
        studentId: context.student.id,
        tariffId: foreignTariff.id,
      },
    });
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
    const adminOverview = await profiles.getOverview(adminSession.token, context.student.id);
    expect(adminOverview).toMatchObject({
      access: 'ADMIN',
    });
    expect(adminOverview.groups.map(({ groupId }) => groupId)).not.toContain(foreignGroup.id);
    expect(adminOverview.activeSubscriptions.map(({ tariffName }) => tariffName)).not.toContain(
      'Скрытый тариф',
    );
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
