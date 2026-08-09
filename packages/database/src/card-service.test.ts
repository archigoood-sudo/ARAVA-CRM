import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CardService } from './card-service';
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
import { ApplicationService } from './services';
import { StudioService } from './studio-service';

describe('Sprint 4.1C membership cards', () => {
  let application: ApplicationService;
  let cards: CardService;
  let database: DatabaseClient;
  let directory: string;
  let finance: FinanceService;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-cards-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'cards.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    cards = new CardService(database, application);
    finance = new FinanceService(database, application);
    studio = new StudioService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Cards2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function setup() {
    const branch = await application.createBranch(ownerToken, { name: 'Центр' });
    const otherBranch = await application.createBranch(ownerToken, { name: 'Север' });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Анна',
      lastName: 'Петрова',
      phone: '+79990000001',
      status: 'ACTIVE',
    });
    const secondStudent = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мария',
      lastName: 'Иванова',
      status: 'ACTIVE',
    });
    const inaccessibleStudent = await application.createStudent(ownerToken, {
      branchId: otherBranch.id,
      firstName: 'Ольга',
      lastName: 'Северова',
      status: 'ACTIVE',
    });
    const admin = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'admin-cards@arava.local',
      fullName: 'Администратор карт',
      password: 'Admin!Cards2026',
      role: 'ADMIN',
    });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'coach-cards@arava.local',
      fullName: 'Тренер карт',
      password: 'Coach!Cards2026',
      role: 'COACH',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Cards2026',
    });
    const coachSession = await application.login({
      email: coach.email,
      password: 'Coach!Cards2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Cards2026',
      newPassword: 'Admin!ChangedCards2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Cards2026',
      newPassword: 'Coach!ChangedCards2026',
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      coachId: coach.id,
      direction: 'Хип-хоп',
      name: 'Карточная группа',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, group.id, {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    return {
      adminToken: adminSession.token,
      branch,
      coachToken: coachSession.token,
      inaccessibleStudent,
      otherBranch,
      secondStudent,
      student,
    };
  }

  it('preserves leading zeroes, uniqueness and one active card per student', async () => {
    const context = await setup();
    const registered = await cards.registerCard(ownerToken, { barcode: '0000001001' });
    expect(registered).toMatchObject({ barcode: '0000001001', status: 'FREE' });
    await expect(cards.registerCard(ownerToken, { barcode: '0000001001' })).rejects.toThrow(
      'уже зарегистрирована',
    );
    const assigned = await cards.assignCard(ownerToken, {
      barcode: '0000001001',
      registerIfUnknown: false,
      studentId: context.student.id,
    });
    expect(assigned).toMatchObject({
      barcode: '0000001001',
      status: 'ASSIGNED',
      studentId: context.student.id,
    });
    await cards.registerCard(ownerToken, { barcode: '0000001002' });
    await expect(
      database.membershipCard.update({
        data: { status: 'ASSIGNED', studentId: context.student.id },
        where: { barcode: '0000001002' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      cards.assignCard(ownerToken, {
        barcode: '0000001002',
        registerIfUnknown: false,
        studentId: context.student.id,
      }),
    ).rejects.toThrow('уже есть активная');
    await expect(
      cards.assignCard(ownerToken, {
        barcode: '0000001001',
        registerIfUnknown: false,
        studentId: context.secondStudent.id,
      }),
    ).rejects.toThrow('другому клиенту');
    expect(
      await database.auditLog.count({ where: { action: 'CARD_ASSIGN_OCCUPIED_REJECTED' } }),
    ).toBe(1);
  });

  it('registers unknown cards during assignment and preserves lost replacement history', async () => {
    const context = await setup();
    const oldCard = await cards.assignCard(ownerToken, {
      barcode: '0000002001',
      registerIfUnknown: true,
      studentId: context.student.id,
    });
    const replacement = await cards.replaceCard(ownerToken, {
      comment: 'Карта потеряна',
      newBarcode: '0000002002',
      oldCardId: oldCard.id,
      oldCardStatus: 'LOST',
      registerIfUnknown: true,
      studentId: context.student.id,
    });
    expect(await cards.resolveScan(ownerToken, oldCard.barcode)).toMatchObject({ result: 'LOST' });
    expect(replacement).toMatchObject({ status: 'ASSIGNED', studentId: context.student.id });
    const history = await cards.cardHistory(ownerToken, oldCard.id);
    expect(history.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining(['REGISTERED', 'ASSIGNED', 'REPLACED', 'SCANNED']),
    );

    await cards.markLost(ownerToken, replacement.id, { comment: 'Замена' });
    const finalCard = await cards.assignCard(ownerToken, {
      barcode: '0000002003',
      registerIfUnknown: true,
      studentId: context.student.id,
    });
    await cards.blockCard(ownerToken, finalCard.id, { comment: 'Проверка блокировки' });
    expect(await cards.resolveScan(ownerToken, finalCard.barcode)).toMatchObject({
      result: 'BLOCKED',
    });
    await cards.reactivateCard(ownerToken, finalCard.id, {});
    expect(await cards.resolveScan(ownerToken, finalCard.barcode)).toMatchObject({
      result: 'OPENED',
    });
  });

  it('resolves scans without changing attendance, subscription balance or finances', async () => {
    const context = await setup();
    const tariff = await finance.createTariff(ownerToken, {
      branchId: context.branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 8,
      name: 'Восемь занятий',
      price: 80_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    });
    const subscription = await finance.createSubscription(ownerToken, {
      salePrice: 80_000,
      startsAt: '2026-08-01',
      studentId: context.student.id,
      tariffId: tariff.id,
    });
    const card = await cards.assignCard(ownerToken, {
      barcode: '0000003001',
      registerIfUnknown: true,
      studentId: context.student.id,
    });
    const before = {
      attendance: await database.attendance.count({ where: { studentId: context.student.id } }),
      ledger: await database.subscriptionLedger.count({
        where: { subscriptionId: subscription.id },
      }),
      payments: await database.payment.count({ where: { studentId: context.student.id } }),
      subscription: await database.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      }),
    };
    expect(await cards.resolveScan(ownerToken, card.barcode)).toMatchObject({
      result: 'OPENED',
      studentId: context.student.id,
    });
    const after = await database.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(await database.attendance.count({ where: { studentId: context.student.id } })).toBe(
      before.attendance,
    );
    expect(
      await database.subscriptionLedger.count({ where: { subscriptionId: subscription.id } }),
    ).toBe(before.ledger);
    expect(await database.payment.count({ where: { studentId: context.student.id } })).toBe(
      before.payments,
    );
    expect(after.lessonsUsed).toBe(before.subscription.lessonsUsed);
    expect(await cards.resolveScan(ownerToken, '0000003999')).toEqual({
      barcode: '0000003999',
      result: 'UNKNOWN',
    });
    expect((await cards.scanHistory(ownerToken)).map(({ result }) => result)).toEqual(
      expect.arrayContaining(['OPENED', 'UNKNOWN']),
    );
  });

  it('enforces management, trainer access and branch isolation in the service layer', async () => {
    const context = await setup();
    const accessible = await cards.assignCard(ownerToken, {
      barcode: '0000004001',
      registerIfUnknown: true,
      studentId: context.student.id,
    });
    const inaccessible = await cards.assignCard(ownerToken, {
      barcode: '0000004002',
      registerIfUnknown: true,
      studentId: context.inaccessibleStudent.id,
    });
    await expect(cards.registerCard(context.coachToken, { barcode: '0000004003' })).rejects.toThrow(
      'недостаточно прав',
    );
    await expect(
      cards.assignCard(context.adminToken, {
        barcode: '0000004004',
        registerIfUnknown: true,
        studentId: context.inaccessibleStudent.id,
      }),
    ).rejects.toThrow('нет доступа к этому филиалу');
    expect(await cards.resolveScan(context.coachToken, accessible.barcode)).toMatchObject({
      result: 'OPENED',
      studentId: context.student.id,
    });
    expect(await cards.resolveScan(context.coachToken, inaccessible.barcode)).toEqual(
      expect.objectContaining({ result: 'ACCESS_DENIED', studentId: undefined }),
    );
    expect(await cards.resolveScan(context.adminToken, inaccessible.barcode)).toEqual(
      expect.objectContaining({ result: 'ACCESS_DENIED', studentId: undefined }),
    );
    await cards.archiveCard(ownerToken, accessible.id, { comment: 'История сохраняется' });
    expect(await cards.resolveScan(ownerToken, accessible.barcode)).toMatchObject({
      result: 'ARCHIVED',
    });
    await expect(cards.archiveCard(context.adminToken, inaccessible.id, {})).rejects.toThrow();
  });
});
