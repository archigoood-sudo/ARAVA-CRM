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
import { ManagementService } from './management-service';

describe('read-only payroll print snapshots', () => {
  let database: DatabaseClient;
  let directory: string;
  let application: ApplicationService;
  let management: ManagementService;
  let token: string;
  let ownerId: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-payroll-print-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'test.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    management = new ManagementService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    token = owner.token;
    ownerId = owner.user.id;
    await application.changePassword(token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Print2026',
    });
  });
  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { recursive: true, force: true });
  });
  async function fixture(status: 'CALCULATED' | 'APPROVED' | 'PAID') {
    const branch = await application.createBranch(token, { name: 'Исходный филиал' });
    const trainer = await application.createUser(token, {
      branchIds: [branch.id],
      email: 'print-coach@arava.local',
      fullName: 'Сохранённый заменяющий',
      password: 'Coach!Print2026',
      role: 'COACH',
    });
    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        name: 'Сохранённая группа',
        direction: 'Танцы',
        capacity: 20,
        status: 'ACTIVE',
      },
    });
    const lesson = await database.lesson.create({
      data: {
        branchId: branch.id,
        groupId: group.id,
        coachId: ownerId,
        startsAt: new Date('2026-08-17T10:00:00Z'),
        endsAt: new Date('2026-08-17T11:00:00Z'),
        status: 'COMPLETED',
        attendanceCompletedAt: new Date('2026-08-17T11:00:00Z'),
      },
    });
    const period = await database.payrollPeriod.create({
      data: {
        branchId: branch.id,
        dateFrom: new Date('2026-08-01'),
        dateTo: new Date('2026-08-31'),
        trainerId: trainer.id,
        trainerName: trainer.fullName,
        sheetNumber: 'ЗП-2026-0001',
        createdByUserId: ownerId,
        status,
      },
    });
    const row = await database.payrollAccrual.create({
      data: {
        payrollPeriodId: period.id,
        coachId: trainer.id,
        branchId: branch.id,
        groupId: group.id,
        lessonId: lesson.id,
        type: 'FIXED_PER_LESSON',
        baseAmount: 50000,
        calculatedAmount: 50000,
        finalAmount: 50000,
        payoutCategory: 'SUBSTITUTION',
        payoutMode: 'FIXED_PER_LESSON',
        lessonStartsAtSnapshot: lesson.startsAt,
        groupNameSnapshot: group.name,
        branchNameSnapshot: branch.name,
        manualAddedAt: new Date('2026-09-01'),
        manualAddedByUserId: ownerId,
        manualAdditionReason: 'Подтверждено владельцем',
      },
    });
    return { branch, trainer, group, lesson, period, row };
  }
  it.each(['CALCULATED', 'APPROVED', 'PAID'] as const)(
    'keeps %s dates, money and actual substitute immutable after source edits',
    async (status) => {
      const f = await fixture(status);
      const before = await management.getPayrollPrintPeriod(token, f.period.id);
      expect(before.accruals[0]).toMatchObject({
        coachId: f.trainer.id,
        coachName: f.trainer.fullName,
        lessonStartsAt: '2026-08-17T10:00:00.000Z',
        manualAdditionReason: 'Подтверждено владельцем',
      });
      await database.lesson.update({
        where: { id: f.lesson.id },
        data: { startsAt: new Date('2026-10-10T15:00:00Z'), coachId: null, status: 'CANCELLED' },
      });
      await database.danceGroup.update({
        where: { id: f.group.id },
        data: { name: 'Изменённая группа' },
      });
      await database.user.update({
        where: { id: f.trainer.id },
        data: { fullName: 'Изменённый тренер' },
      });
      await database.branch.update({
        where: { id: f.branch.id },
        data: { name: 'Изменённый филиал' },
      });
      const outboxBefore = await database.syncOutbox.findMany({ orderBy: { id: 'asc' } });
      expect(await management.getPayrollPrintPeriod(token, f.period.id)).toEqual(before);
      expect(await database.syncOutbox.findMany({ orderBy: { id: 'asc' } })).toEqual(outboxBefore);
      expect(await database.payrollAccrual.findUnique({ where: { id: f.row.id } })).toEqual(f.row);
      expect(await database.payrollPeriod.findUnique({ where: { id: f.period.id } })).toEqual(
        f.period,
      );
    },
  );
  it("refuses missing historical dates instead of reading today's lesson and does not backfill", async () => {
    const f = await fixture('APPROVED');
    await database.payrollAccrual.update({
      where: { id: f.row.id },
      data: { lessonStartsAtSnapshot: null },
    });
    await expect(management.getPayrollPrintPeriod(token, f.period.id)).rejects.toThrow(
      'отсутствует дата',
    );
    expect(
      (await database.payrollAccrual.findUniqueOrThrow({ where: { id: f.row.id } }))
        .lessonStartsAtSnapshot,
    ).toBeNull();
  });
});
