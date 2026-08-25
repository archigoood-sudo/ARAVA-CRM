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
import { StudentBulkService } from './student-bulk-service';
import { StudioService } from './studio-service';

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (!item) throw new Error(`Не найден тестовый элемент ${String(index)}.`);
  return item;
}

describe('Student bulk operations', () => {
  let application: ApplicationService;
  let bulk: StudentBulkService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-student-bulk-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'bulk.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    studio = new StudioService(database, application);
    bulk = new StudentBulkService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Bulk2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function fixture(capacity = 10) {
    const branch = await application.createBranch(ownerToken, {
      address: 'ул. Массовая, 1',
      name: 'Центр',
      phone: '+79990000001',
    });
    const source = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity,
      direction: 'Хип-хоп',
      name: 'Группа A',
      status: 'ACTIVE',
    });
    const target = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity,
      direction: 'Хип-хоп',
      name: 'Группа B',
      status: 'RECRUITING',
    });
    const students = await Promise.all(
      ['Анна', 'Борис', 'Вера'].map((firstName, index) =>
        application.createStudent(ownerToken, {
          branchId: branch.id,
          firstName,
          lastName: `Ученик${String(index + 1)}`,
          status: 'ACTIVE',
        }),
      ),
    );
    return { branch, source, students, target };
  }

  it('adds all eligible students atomically, skips duplicates, audits and syncs records', async () => {
    const { source, students } = await fixture();
    await studio.addEnrollment(ownerToken, source.id, {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: at(students, 0).id,
    });
    await database.syncOutbox.deleteMany();

    const input = {
      effectiveDate: '2026-08-25',
      groupId: source.id,
      overrideCapacity: false,
      studentIds: students.map(({ id }) => id),
    };
    const preview = await bulk.previewAddToGroup(ownerToken, input);
    expect(preview).toMatchObject({ eligibleCount: 2, invalidCount: 0, skippedCount: 1 });
    expect(preview.items[0]).toMatchObject({ outcome: 'SKIPPED', reason: 'Уже состоит в группе.' });

    const result = await bulk.addToGroup(ownerToken, input, preview.previewKey);
    expect(result).toMatchObject({ changedCount: 2, skippedCount: 1 });
    expect(
      await database.enrollment.count({
        where: { groupId: source.id, leftAt: null, status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] } },
      }),
    ).toBe(3);
    expect(await database.auditLog.count({ where: { action: 'ENROLLMENT_ADDED' } })).toBe(3);
    expect(await database.syncOutbox.count({ where: { entityType: 'GROUP_MEMBERSHIP' } })).toBe(2);

    const retryPreview = await bulk.previewAddToGroup(ownerToken, input);
    expect(retryPreview).toMatchObject({ canExecute: false, eligibleCount: 0, skippedCount: 3 });
    await expect(bulk.addToGroup(ownerToken, input, preview.previewKey)).rejects.toThrow(
      'Данные изменились после проверки',
    );
  });

  it('reports invalid students and rolls the complete transaction back after a write failure', async () => {
    const { source, students } = await fixture();
    const input = {
      effectiveDate: '2026-08-25',
      groupId: source.id,
      overrideCapacity: false,
      studentIds: [at(students, 0).id, at(students, 1).id, 'missing-student'],
    };
    const preview = await bulk.previewAddToGroup(ownerToken, input);
    expect(preview).toMatchObject({ eligibleCount: 2, invalidCount: 1 });
    await database.$executeRawUnsafe(
      `CREATE TRIGGER "test_bulk_abort" BEFORE INSERT ON "Enrollment"
       WHEN NEW."studentId" = '${at(students, 1).id}'
       BEGIN SELECT RAISE(ABORT, 'forced batch failure'); END`,
    );
    await expect(bulk.addToGroup(ownerToken, input, preview.previewKey)).rejects.toThrow();
    expect(await database.enrollment.count({ where: { groupId: source.id } })).toBe(0);
    expect(await database.auditLog.count({ where: { action: 'ENROLLMENT_ADDED' } })).toBe(0);
  });

  it('rechecks capacity inside the serialized transaction and permits an audited override', async () => {
    const { source, students } = await fixture(1);
    const firstInput = {
      effectiveDate: '2026-08-25',
      groupId: source.id,
      overrideCapacity: false,
      studentIds: [at(students, 0).id],
    };
    const secondInput = { ...firstInput, studentIds: [at(students, 1).id] };
    const [firstPreview, secondPreview] = await Promise.all([
      bulk.previewAddToGroup(ownerToken, firstInput),
      bulk.previewAddToGroup(ownerToken, secondInput),
    ]);
    const results = await Promise.allSettled([
      bulk.addToGroup(ownerToken, firstInput, firstPreview.previewKey),
      bulk.addToGroup(ownerToken, secondInput, secondPreview.previewKey),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(await database.enrollment.count({ where: { groupId: source.id, leftAt: null } })).toBe(
      1,
    );

    const overrideInput = { ...secondInput, overrideCapacity: true };
    const overridePreview = await bulk.previewAddToGroup(ownerToken, overrideInput);
    expect(overridePreview.capacity?.exceedsCapacity).toBe(true);
    await bulk.addToGroup(ownerToken, overrideInput, overridePreview.previewKey);
    expect(await database.auditLog.count({ where: { action: 'CAPACITY_OVERRIDDEN' } })).toBe(1);
  });

  it('moves only the selected source membership and preserves attendance history', async () => {
    const { branch, source, students, target } = await fixture();
    const membership = await studio.addEnrollment(ownerToken, source.id, {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: at(students, 0).id,
    });
    const lesson = await database.lesson.create({
      data: {
        branchId: branch.id,
        endsAt: new Date('2026-08-20T16:00:00.000Z'),
        groupId: source.id,
        startsAt: new Date('2026-08-20T15:00:00.000Z'),
      },
    });
    const owner = await database.user.findFirstOrThrow({ where: { role: 'OWNER' } });
    const tariff = await database.tariff.create({
      data: { lessonCount: 8, name: '8 занятий', price: 500000, type: 'LESSON_PACK' },
    });
    const subscription = await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: owner.id,
        lessonLimit: 8,
        purchasedAt: new Date('2026-08-01T00:00:00.000Z'),
        salePrice: 500000,
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        studentId: at(students, 0).id,
        tariffId: tariff.id,
      },
    });
    const payment = await database.payment.create({
      data: {
        amount: 500000,
        branchId: branch.id,
        createdByUserId: owner.id,
        paidAt: new Date('2026-08-01T00:00:00.000Z'),
        paymentMethod: 'CASH',
        studentId: at(students, 0).id,
        subscriptionId: subscription.id,
      },
    });
    await database.attendance.create({
      data: {
        lessonId: lesson.id,
        markedAt: new Date('2026-08-20T15:00:00.000Z'),
        markedByUserId: owner.id,
        status: 'PRESENT',
        studentId: at(students, 0).id,
      },
    });
    const input = {
      effectiveDate: '2026-08-25',
      overrideCapacity: false,
      sourceGroupId: source.id,
      studentIds: [at(students, 0).id],
      targetGroupId: target.id,
    };
    const preview = await bulk.previewMoveToGroup(ownerToken, input);
    await bulk.moveToGroup(ownerToken, input, preview.previewKey);

    expect(
      await database.enrollment.findUniqueOrThrow({ where: { id: membership.id } }),
    ).toMatchObject({
      leftAt: new Date('2026-08-25T00:00:00.000Z'),
      status: 'LEFT',
    });
    expect(
      await database.enrollment.count({
        where: { groupId: target.id, leftAt: null, studentId: at(students, 0).id },
      }),
    ).toBe(1);
    expect(await database.attendance.count({ where: { lessonId: lesson.id } })).toBe(1);
    expect(await database.subscription.count({ where: { id: subscription.id } })).toBe(1);
    expect(await database.payment.count({ where: { id: payment.id } })).toBe(1);
    expect(await database.student.count({ where: { id: at(students, 0).id } })).toBe(1);
  });

  it('ends memberships on the selected local date without deleting students or history', async () => {
    const { source, students } = await fixture();
    const membership = await studio.addEnrollment(ownerToken, source.id, {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: at(students, 0).id,
    });
    const input = {
      effectiveDate: '2026-08-24',
      groupId: source.id,
      studentIds: [at(students, 0).id, at(students, 1).id],
    };
    const preview = await bulk.previewRemoveFromGroup(ownerToken, input);
    expect(preview).toMatchObject({ eligibleCount: 1, skippedCount: 1 });
    await bulk.removeFromGroup(ownerToken, input, preview.previewKey);
    expect(
      await database.enrollment.findUniqueOrThrow({ where: { id: membership.id } }),
    ).toMatchObject({
      leftAt: new Date('2026-08-24T00:00:00.000Z'),
      status: 'LEFT',
    });
    expect(await database.student.count()).toBe(3);
  });

  it('changes only different student statuses and leaves memberships untouched', async () => {
    const { source, students } = await fixture();
    await studio.addEnrollment(ownerToken, source.id, {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: at(students, 0).id,
    });
    await application.updateStudent(ownerToken, at(students, 1).id, {
      ...at(students, 1),
      status: 'FROZEN',
    });
    const membershipCount = await database.enrollment.count();
    const input = {
      status: 'FROZEN' as const,
      studentIds: [at(students, 0).id, at(students, 1).id],
    };
    const preview = await bulk.previewChangeStatus(ownerToken, input);
    expect(preview).toMatchObject({ eligibleCount: 1, skippedCount: 1 });
    await bulk.changeStatus(ownerToken, input, preview.previewKey);
    expect(
      await database.student.findUniqueOrThrow({ where: { id: at(students, 0).id } }),
    ).toMatchObject({
      status: 'FROZEN',
    });
    expect(await database.enrollment.count()).toBe(membershipCount);
  });

  it('rejects a stale preview before mutation', async () => {
    const { source, students } = await fixture();
    const input = {
      effectiveDate: '2026-08-25',
      groupId: source.id,
      overrideCapacity: false,
      studentIds: [at(students, 0).id],
    };
    const preview = await bulk.previewAddToGroup(ownerToken, input);
    await application.updateStudent(ownerToken, at(students, 0).id, {
      ...at(students, 0),
      status: 'TRIAL',
    });
    await expect(bulk.addToGroup(ownerToken, input, preview.previewKey)).rejects.toThrow(
      'Данные изменились после проверки',
    );
    expect(await database.enrollment.count({ where: { groupId: source.id } })).toBe(0);
  });

  it('enforces ADMIN branch scope and denies COACH through the service layer', async () => {
    const { branch, source, students } = await fixture();
    const otherBranch = await application.createBranch(ownerToken, {
      address: 'ул. Чужая, 2',
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
      email: 'admin-bulk@arava.local',
      fullName: 'Администратор',
      password: 'Admin!Bulk2026',
      role: 'ADMIN',
    });
    const admin = await application.login({
      email: 'admin-bulk@arava.local',
      password: 'Admin!Bulk2026',
    });
    await application.changePassword(admin.token, {
      currentPassword: 'Admin!Bulk2026',
      newPassword: 'Admin!Changed2026',
    });
    await expect(
      bulk.previewAddToGroup(admin.token, {
        effectiveDate: '2026-08-25',
        groupId: source.id,
        overrideCapacity: false,
        studentIds: [at(students, 0).id],
      }),
    ).resolves.toMatchObject({ eligibleCount: 1 });
    await expect(
      bulk.previewAddToGroup(admin.token, {
        effectiveDate: '2026-08-25',
        groupId: otherGroup.id,
        overrideCapacity: false,
        studentIds: [at(students, 0).id],
      }),
    ).rejects.toThrow('нет доступа к этому филиалу');

    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach-bulk@arava.local',
      fullName: 'Тренер',
      password: 'Coach!Bulk2026',
      role: 'COACH',
    });
    const coach = await application.login({
      email: 'coach-bulk@arava.local',
      password: 'Coach!Bulk2026',
    });
    await application.changePassword(coach.token, {
      currentPassword: 'Coach!Bulk2026',
      newPassword: 'Coach!Changed2026',
    });
    await expect(
      bulk.previewChangeStatus(coach.token, {
        status: 'FROZEN',
        studentIds: [at(students, 0).id],
      }),
    ).rejects.toThrow('недостаточно прав');
  });
});
