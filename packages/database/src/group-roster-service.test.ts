import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GroupRosterService } from './group-roster-service';
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
import { StudentBulkService } from './student-bulk-service';
import { StudioService } from './studio-service';

describe('Group roster workspace', () => {
  let application: ApplicationService;
  let bulk: StudentBulkService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let roster: GroupRosterService;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-group-roster-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'roster.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    studio = new StudioService(database, application);
    bulk = new StudentBulkService(database, application);
    roster = new GroupRosterService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Roster2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function base() {
    const branch = await application.createBranch(ownerToken, {
      address: 'ул. Состав, 1',
      name: 'Центр',
      phone: '+79990000001',
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 10,
      direction: 'Хип-хоп',
      name: 'Основная группа',
      status: 'ACTIVE',
    });
    const target = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 10,
      direction: 'Хип-хоп',
      name: 'Целевая группа',
      status: 'RECRUITING',
    });
    const students = await Promise.all(
      [
        ['Анна', 'Активная'],
        ['Татьяна', 'Пробная'],
        ['Фёдор', 'Замороженный'],
        ['Буду', 'Позже'],
        ['Бывшая', 'Участница'],
      ].map(([firstName, lastName]) =>
        application.createStudent(ownerToken, {
          birthDate: '2016-08-20',
          branchId: branch.id,
          firstName: firstName ?? '',
          lastName: lastName ?? '',
          phone: '+79991112233',
          status: 'ACTIVE',
        }),
      ),
    );
    const [current, trial, frozen, future, former] = students;
    if (!current || !trial || !frozen || !future || !former)
      throw new Error('Не созданы тестовые ученики.');
    await database.enrollment.createMany({
      data: [
        {
          groupId: group.id,
          joinedAt: new Date('2026-08-20T00:00:00.000Z'),
          status: 'ACTIVE',
          studentId: current.id,
        },
        {
          groupId: group.id,
          joinedAt: new Date('2026-08-01T00:00:00.000Z'),
          status: 'TRIAL',
          studentId: trial.id,
        },
        {
          groupId: group.id,
          joinedAt: new Date('2026-08-01T00:00:00.000Z'),
          status: 'FROZEN',
          studentId: frozen.id,
        },
        {
          groupId: group.id,
          joinedAt: new Date('2026-09-01T00:00:00.000Z'),
          status: 'ACTIVE',
          studentId: future.id,
        },
        {
          groupId: group.id,
          joinedAt: new Date('2026-07-01T00:00:00.000Z'),
          leftAt: new Date('2026-08-01T00:00:00.000Z'),
          status: 'LEFT',
          studentId: former.id,
        },
      ],
    });
    return { branch, current, former, frozen, future, group, target, trial };
  }

  it('derives current, future, former, trial, frozen, recent and capacity from membership dates', async () => {
    const { former, group } = await base();
    const result = await roster.get(ownerToken, group.id, '2026-08-26');
    expect(result).toMatchObject({
      activeCount: 1,
      capacity: 10,
      capacityOccupiedCount: 4,
      currentCount: 3,
      formerCount: 1,
      freePlaces: 6,
      frozenCount: 1,
      futureCount: 1,
      recentlyAddedCount: 1,
      trialCount: 1,
    });
    expect(result.members.find(({ studentId }) => studentId === former.id)).toMatchObject({
      joinedAt: '2026-07-01',
      leftAt: '2026-08-01',
      segment: 'FORMER',
    });
    const onExitDate = await roster.get(ownerToken, group.id, '2026-08-01');
    expect(onExitDate.members.find(({ studentId }) => studentId === former.id)?.segment).toBe(
      'CURRENT',
    );
  });

  it('returns the canonical subscription, total debt and last attendance in this group without N+1 calls', async () => {
    const { branch, current, group, target } = await base();
    const owner = await database.user.findFirstOrThrow({ where: { role: 'OWNER' } });
    const single = await database.tariff.create({
      data: {
        branchId: branch.id,
        isActive: true,
        lessonCount: 1,
        name: 'Разовое',
        price: 100000,
        type: 'SINGLE_LESSON',
      },
    });
    const pack = await database.tariff.create({
      data: {
        branchId: branch.id,
        isActive: true,
        lessonCount: 8,
        name: '8 занятий',
        price: 800000,
        type: 'LESSON_PACK',
      },
    });
    const subscription = await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: owner.id,
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
        lessonLimit: 8,
        lessonsUsed: 3,
        purchasedAt: new Date('2026-08-01T00:00:00.000Z'),
        salePrice: 800000,
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        status: 'ACTIVE',
        studentId: current.id,
        tariffId: pack.id,
      },
    });
    await database.payment.create({
      data: {
        amount: 300000,
        branchId: branch.id,
        createdByUserId: owner.id,
        paidAt: new Date('2026-08-01T12:00:00.000Z'),
        paymentMethod: 'CASH',
        studentId: current.id,
        subscriptionId: subscription.id,
      },
    });
    const groupLesson = await database.lesson.create({
      data: {
        branchId: branch.id,
        endsAt: new Date('2026-08-20T16:00:00.000Z'),
        groupId: group.id,
        startsAt: new Date('2026-08-20T15:00:00.000Z'),
        status: 'COMPLETED',
      },
    });
    const otherLesson = await database.lesson.create({
      data: {
        branchId: branch.id,
        endsAt: new Date('2026-08-25T16:00:00.000Z'),
        groupId: target.id,
        startsAt: new Date('2026-08-25T15:00:00.000Z'),
        status: 'COMPLETED',
      },
    });
    for (const lesson of [groupLesson, otherLesson])
      await database.attendance.create({
        data: {
          lessonId: lesson.id,
          markedAt: new Date('2026-08-26T09:00:00.000Z'),
          markedByUserId: owner.id,
          status: 'PRESENT',
          studentId: current.id,
        },
      });

    const result = await roster.get(ownerToken, group.id, '2026-08-26');
    const member = result.members.find(({ studentId }) => studentId === current.id);
    expect(member).toMatchObject({
      lastAttendanceAt: groupLesson.startsAt.toISOString(),
      subscription: {
        remainingLessons: 5,
        status: 'ACTIVE',
        tariffName: pack.name,
      },
      totalDebt: 700000,
    });
    expect(single.id).toBeTruthy();
    expect(result.members.find(({ studentName }) => studentName.includes('Пробная'))).toMatchObject(
      {
        lastAttendanceAt: undefined,
        subscription: undefined,
        totalDebt: 0,
      },
    );
  });

  it('enforces branch scope and removes phone/debt from a COACH projection', async () => {
    const { branch, group } = await base();
    const coachUser = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach-roster@arava.local',
      fullName: 'Тренер Состава',
      password: 'Coach!Roster2026',
      role: 'COACH',
    });
    await database.danceGroup.update({ data: { coachId: coachUser.id }, where: { id: group.id } });
    const coachLogin = await application.login({
      email: 'coach-roster@arava.local',
      password: 'Coach!Roster2026',
    });
    await application.changePassword(coachLogin.token, {
      currentPassword: 'Coach!Roster2026',
      newPassword: 'Coach!RosterChanged2026',
    });
    const coachView = await roster.get(coachLogin.token, group.id, '2026-08-26');
    expect(coachView.members.every((member) => member.studentPhone === undefined)).toBe(true);
    expect(coachView.members.every((member) => member.totalDebt === undefined)).toBe(true);

    const otherBranch = await application.createBranch(ownerToken, {
      address: 'ул. Другая, 2',
      name: 'Другой филиал',
      phone: '+79990000002',
    });
    const otherGroup = await studio.createGroup(ownerToken, {
      branchId: otherBranch.id,
      capacity: 10,
      direction: 'Балет',
      name: 'Чужая группа',
      status: 'ACTIVE',
    });
    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'admin-roster@arava.local',
      fullName: 'Администратор Состава',
      password: 'Admin!Roster2026',
      role: 'ADMIN',
    });
    const adminLogin = await application.login({
      email: 'admin-roster@arava.local',
      password: 'Admin!Roster2026',
    });
    await application.changePassword(adminLogin.token, {
      currentPassword: 'Admin!Roster2026',
      newPassword: 'Admin!RosterChanged2026',
    });
    await expect(roster.get(adminLogin.token, group.id, '2026-08-26')).resolves.toMatchObject({
      currentCount: 3,
    });
    await expect(roster.get(adminLogin.token, otherGroup.id, '2026-08-26')).rejects.toThrow(
      'нет доступа к этому филиалу',
    );
    await expect(roster.get(coachLogin.token, otherGroup.id, '2026-08-26')).rejects.toThrow(
      'нет доступа к этому филиалу',
    );
  });

  it('reflects add, move, remove and status actions through the canonical 4.9A service', async () => {
    const { current, group, target, trial } = await base();
    const addCandidate = await application.createStudent(ownerToken, {
      branchId: group.branchId,
      firstName: 'Новая',
      lastName: 'Участница',
      status: 'ACTIVE',
    });
    const addInput = {
      effectiveDate: '2026-08-26',
      groupId: group.id,
      overrideCapacity: false,
      studentIds: [addCandidate.id],
    };
    const addPreview = await bulk.previewAddToGroup(ownerToken, addInput);
    await bulk.addToGroup(ownerToken, addInput, addPreview.previewKey);
    const duplicate = await bulk.previewAddToGroup(ownerToken, addInput);
    expect(duplicate).toMatchObject({ eligibleCount: 0, skippedCount: 1 });

    const moveInput = {
      effectiveDate: '2026-08-27',
      overrideCapacity: false,
      sourceGroupId: group.id,
      studentIds: [current.id],
      targetGroupId: target.id,
    };
    const movePreview = await bulk.previewMoveToGroup(ownerToken, moveInput);
    await bulk.moveToGroup(ownerToken, moveInput, movePreview.previewKey);
    const removeInput = {
      effectiveDate: '2026-08-27',
      groupId: group.id,
      studentIds: [trial.id],
    };
    const removePreview = await bulk.previewRemoveFromGroup(ownerToken, removeInput);
    await bulk.removeFromGroup(ownerToken, removeInput, removePreview.previewKey);
    const statusInput = { status: 'FROZEN' as const, studentIds: [addCandidate.id] };
    const statusPreview = await bulk.previewChangeStatus(ownerToken, statusInput);
    await bulk.changeStatus(ownerToken, statusInput, statusPreview.previewKey);

    const result = await roster.get(ownerToken, group.id, '2026-08-28');
    expect(result.members.find(({ studentId }) => studentId === current.id)?.segment).toBe(
      'FORMER',
    );
    expect(result.members.find(({ studentId }) => studentId === trial.id)?.segment).toBe('FORMER');
    expect(result.members.find(({ studentId }) => studentId === addCandidate.id)).toMatchObject({
      segment: 'CURRENT',
      studentStatus: 'FROZEN',
    });
    expect(await database.enrollment.count({ where: { studentId: current.id } })).toBe(2);
  });
});
