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
import { AttentionService } from './attention-service';

const NOW = new Date('2026-08-14T12:00:00.000Z');
const at = (days: number, hours = 0) =>
  new Date(NOW.getTime() + days * 86_400_000 + hours * 3_600_000);

describe('Sprint 4.2B attention center', () => {
  let application: ApplicationService;
  let attention: AttentionService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-attention-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'attention.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    attention = new AttentionService(database, application, () => NOW);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Attention2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function branchFoundation(name = 'Центр') {
    const branch = await application.createBranch(ownerToken, { name });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: `${String(name.length)}-coach@arava.local`,
      fullName: `Тренер ${name}`,
      password: 'Coach!Attention2026',
      role: 'COACH',
    });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мария',
      lastName: name,
      status: 'ACTIVE',
    });
    return { branch, coach, student };
  }

  it('derives student, subscription, debt and card warnings and resolves them from source data', async () => {
    const { branch, coach, student } = await branchFoundation();
    let items = await attention.listItems(ownerToken);
    expect(items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        `student:no-group:${student.id}`,
        `student:no-subscription:${student.id}`,
      ]),
    );

    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        capacity: 20,
        coachId: coach.id,
        direction: 'Балет',
        name: 'Основная',
        status: 'ACTIVE',
      },
    });
    await database.enrollment.create({
      data: { groupId: group.id, joinedAt: NOW, status: 'ACTIVE', studentId: student.id },
    });
    const tariff = await database.tariff.create({
      data: { lessonCount: 10, name: 'Десять занятий', price: 10_000, type: 'LESSON_PACK' },
    });
    const subscription = await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: coach.id,
        expiresAt: at(4),
        lessonLimit: 10,
        lessonsUsed: 8,
        purchasedAt: at(-1),
        salePrice: 10_000,
        startsAt: at(-1),
        status: 'ACTIVE',
        studentId: student.id,
        tariffId: tariff.id,
      },
    });
    const payment = await database.payment.create({
      data: {
        amount: 4_000,
        branchId: branch.id,
        createdByUserId: coach.id,
        paidAt: NOW,
        paymentMethod: 'CARD',
        studentId: student.id,
        subscriptionId: subscription.id,
      },
    });
    const card = await database.membershipCard.create({
      data: {
        barcode: '0000042201',
        createdByUserId: coach.id,
        status: 'LOST',
        studentId: student.id,
      },
    });

    items = await attention.listItems(ownerToken);
    expect(items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        `subscription:expiring:${subscription.id}`,
        `student:debt:${student.id}`,
        `card:lost:${card.id}`,
      ]),
    );
    expect(items.map(({ id }) => id)).not.toContain(`subscription:low:${subscription.id}`);
    expect(items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: `student:no-group:${student.id}` })]),
    );

    await database.payment.create({
      data: {
        amount: 6_000,
        branchId: branch.id,
        createdByUserId: coach.id,
        paidAt: at(1),
        paymentMethod: 'CASH',
        studentId: student.id,
        subscriptionId: subscription.id,
      },
    });
    await database.subscription.update({
      data: { expiresAt: at(20), lessonsUsed: 5 },
      where: { id: subscription.id },
    });
    await database.membershipCard.update({ data: { status: 'ASSIGNED' }, where: { id: card.id } });
    items = await attention.listItems(ownerToken);
    expect(items.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining([
        `subscription:low:${subscription.id}`,
        `subscription:expiring:${subscription.id}`,
        `student:debt:${student.id}`,
        `card:lost:${card.id}`,
      ]),
    );
    expect(payment.amount).toBe(4_000);
  });

  it('keeps subscription retention current and warns only at one remaining lesson', async () => {
    const { branch, coach, student } = await branchFoundation('Удержание');
    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        capacity: 20,
        coachId: coach.id,
        direction: 'Танцы',
        name: 'Удержание',
        status: 'ACTIVE',
      },
    });
    await database.enrollment.create({
      data: { groupId: group.id, joinedAt: at(-30), status: 'ACTIVE', studentId: student.id },
    });
    const tariff = await database.tariff.create({
      data: { lessonCount: 10, name: 'Десять', price: 10_000, type: 'LESSON_PACK' },
    });
    const expired = await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: coach.id,
        expiresAt: at(-2),
        lessonLimit: 10,
        lessonsUsed: 10,
        purchasedAt: at(-40),
        salePrice: 10_000,
        startsAt: at(-40),
        status: 'EXPIRED',
        studentId: student.id,
        tariffId: tariff.id,
      },
    });
    const active = await database.subscription.create({
      data: {
        branchId: branch.id,
        createdByUserId: coach.id,
        expiresAt: at(20),
        lessonLimit: 10,
        lessonsUsed: 8,
        purchasedAt: at(-1),
        salePrice: 10_000,
        startsAt: at(-1),
        status: 'ACTIVE',
        studentId: student.id,
        tariffId: tariff.id,
      },
    });

    let items = await attention.listItems(ownerToken, { category: 'SUBSCRIPTIONS' });
    expect(items.some(({ entityId }) => entityId === expired.id)).toBe(false);
    expect(items.some(({ id }) => id === `subscription:low:${active.id}`)).toBe(false);

    await database.subscription.update({ data: { lessonsUsed: 9 }, where: { id: active.id } });
    items = await attention.listItems(ownerToken, { category: 'SUBSCRIPTIONS' });
    const lowBalance = items.find(({ id }) => id === `subscription:low:${active.id}`);
    expect(lowBalance?.title).toContain('осталось 1 занятие');
  });

  it('creates one retention signal after three explicit consecutive absences', async () => {
    const { branch, coach, student } = await branchFoundation('Пропуски');
    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        capacity: 20,
        coachId: coach.id,
        direction: 'Танцы',
        name: 'Регулярная группа',
        status: 'ACTIVE',
      },
    });
    const enrollment = await database.enrollment.create({
      data: { groupId: group.id, joinedAt: at(-2.5), status: 'ACTIVE', studentId: student.id },
    });
    let latestLessonId = '';
    for (const day of [-3, -2, -1]) {
      const lesson = await database.lesson.create({
        data: {
          attendanceCompletedAt: NOW,
          branchId: branch.id,
          coachId: coach.id,
          endsAt: at(day, 1),
          groupId: group.id,
          startsAt: at(day),
          status: 'COMPLETED',
        },
      });
      await database.attendance.create({
        data: {
          lessonId: lesson.id,
          markedAt: NOW,
          markedByUserId: coach.id,
          status: 'ABSENT',
          studentId: student.id,
        },
      });
      latestLessonId = lesson.id;
    }

    let items = await attention.listItems(ownerToken, { category: 'ATTENDANCE' });
    expect(items.some(({ id }) => id === `attendance:retention:${student.id}`)).toBe(false);
    await database.enrollment.update({
      data: { joinedAt: at(-10) },
      where: { id: enrollment.id },
    });
    items = await attention.listItems(ownerToken, { category: 'ATTENDANCE' });
    expect(items.filter(({ id }) => id === `attendance:retention:${student.id}`)).toHaveLength(1);
    await database.attendance.update({
      data: { status: 'PRESENT' },
      where: { lessonId_studentId: { lessonId: latestLessonId, studentId: student.id } },
    });
    items = await attention.listItems(ownerToken, { category: 'ATTENDANCE' });
    expect(items.some(({ id }) => id === `attendance:retention:${student.id}`)).toBe(false);
  });

  it('applies grace periods to trial outcome and THINKING follow-up signals', async () => {
    const { branch, coach, student } = await branchFoundation('Пробное');
    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        capacity: 20,
        coachId: coach.id,
        direction: 'Танцы',
        name: 'Пробная группа',
        status: 'ACTIVE',
      },
    });
    const lesson = await database.lesson.create({
      data: {
        branchId: branch.id,
        coachId: coach.id,
        endsAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
        groupId: group.id,
        startsAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
        status: 'COMPLETED',
      },
    });
    const trial = await database.trialAppointment.create({
      data: {
        createdByUserId: coach.id,
        externalLeadId: `student:${student.id}`,
        groupId: group.id,
        lessonId: lesson.id,
        studentId: student.id,
      },
    });
    let items = await attention.listItems(ownerToken, { category: 'TRIALS' });
    expect(items).toContainEqual(
      expect.objectContaining({ id: `trial:outcome:${trial.id}`, severity: 'WARNING' }),
    );

    await database.trialAppointment.update({
      data: { outcome: 'THINKING', updatedAt: new Date(NOW.getTime() - 23 * 60 * 60 * 1000) },
      where: { id: trial.id },
    });
    items = await attention.listItems(ownerToken, { category: 'TRIALS' });
    expect(items.some(({ entityId }) => entityId === trial.id)).toBe(false);
    await database.trialAppointment.update({
      data: { updatedAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) },
      where: { id: trial.id },
    });
    items = await attention.listItems(ownerToken, { category: 'TRIALS' });
    expect(items).toContainEqual(
      expect.objectContaining({ id: `trial:thinking:${trial.id}`, severity: 'INFO' }),
    );
    await database.trialAppointment.update({
      data: { outcome: 'NO_SHOW' },
      where: { id: trial.id },
    });
    items = await attention.listItems(ownerToken, { category: 'TRIALS' });
    expect(items).toContainEqual(
      expect.objectContaining({ id: `trial:missed:${trial.id}`, severity: 'WARNING' }),
    );
    await database.trialAppointment.update({
      data: { supersededAt: NOW },
      where: { id: trial.id },
    });
    items = await attention.listItems(ownerToken, { category: 'TRIALS' });
    expect(items.some(({ entityId }) => entityId === trial.id)).toBe(false);
  });

  it('surfaces failed payment operations and removes the task after resolution', async () => {
    const { branch, coach, student } = await branchFoundation('Оплата');
    const operation = await database.paymentOperation.create({
      data: {
        amount: 5_000,
        branchId: branch.id,
        createdByUserId: coach.id,
        currency: 'RUB',
        failureReason: 'Терминал не подтвердил оплату.',
        idempotencyKey: 'attention-payment-failure',
        providerType: 'ACQUIRING',
        purpose: 'Абонемент',
        status: 'FAILED',
        studentId: student.id,
      },
    });

    let items = await attention.listItems(ownerToken, { category: 'PAYMENTS' });
    expect(items).toContainEqual(
      expect.objectContaining({
        actionRoute: `/students/${student.id}?paymentOperationId=${operation.id}`,
        description:
          'Оплата не завершена. Откройте операцию, чтобы проверить состояние или повторить попытку.',
        entityId: operation.id,
        id: `payment-operation:failed:${operation.id}`,
        severity: 'CRITICAL',
      }),
    );

    await database.paymentOperation.update({
      data: { status: 'CANCELLED' },
      where: { id: operation.id },
    });
    items = await attention.listItems(ownerToken, { category: 'PAYMENTS' });
    expect(items.some(({ entityId }) => entityId === operation.id)).toBe(false);
  });

  it('opens uncovered attendance in its canonical direct-payment context', async () => {
    const { branch, coach, student } = await branchFoundation('Разовое');
    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        capacity: 20,
        coachId: coach.id,
        direction: 'Хип-хоп',
        name: 'Разовая группа',
        status: 'ACTIVE',
      },
    });
    const lesson = await database.lesson.create({
      data: {
        branchId: branch.id,
        endsAt: at(-1, 1),
        groupId: group.id,
        startsAt: at(-1),
        status: 'COMPLETED',
      },
    });
    await database.attendance.create({
      data: {
        lessonId: lesson.id,
        markedAt: NOW,
        markedByUserId: coach.id,
        status: 'PRESENT',
        studentId: student.id,
      },
    });

    const items = await attention.listItems(ownerToken, { category: 'SUBSCRIPTIONS' });
    expect(items).toContainEqual(
      expect.objectContaining({
        actionRoute: `/students/${student.id}?action=attendance-payment&lessonId=${lesson.id}`,
        id: `attendance:uncovered:${lesson.id}:${student.id}`,
      }),
    );
  });

  it('shows serious integration failures only to OWNER', async () => {
    await database.appSetting.createMany({
      data: [
        { key: 'integration.enabled', value: 'true' },
        { key: 'integration.lastState', value: 'AUTH_ERROR' },
      ],
    });
    const items = await attention.listItems(ownerToken);
    expect(items).toContainEqual(
      expect.objectContaining({
        category: 'INTEGRATION',
        id: 'integration:AUTH_ERROR',
        severity: 'CRITICAL',
      }),
    );
  });

  it('flags only past incomplete attendance and preserves zero-PRESENT completion semantics', async () => {
    const { branch, coach, student } = await branchFoundation('Посещаемость');
    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        capacity: 20,
        coachId: coach.id,
        direction: 'Танцы',
        name: 'Вечерняя',
        status: 'ACTIVE',
      },
    });
    const incomplete = await database.lesson.create({
      data: {
        branchId: branch.id,
        coachId: coach.id,
        endsAt: at(-1, 1),
        groupId: group.id,
        startsAt: at(-1),
        status: 'COMPLETED',
      },
    });
    const completedWithoutPresent = await database.lesson.create({
      data: {
        attendanceCompletedAt: NOW,
        branchId: branch.id,
        coachId: coach.id,
        endsAt: at(-2, 1),
        groupId: group.id,
        startsAt: at(-2),
        status: 'COMPLETED',
      },
    });
    const future = await database.lesson.create({
      data: {
        branchId: branch.id,
        coachId: coach.id,
        endsAt: at(1, 1),
        groupId: group.id,
        startsAt: at(1),
        status: 'PLANNED',
      },
    });
    await database.attendance.create({
      data: {
        lessonId: completedWithoutPresent.id,
        markedAt: NOW,
        markedByUserId: coach.id,
        status: 'ABSENT',
        studentId: student.id,
      },
    });
    let attendance = await attention.listItems(ownerToken, { category: 'ATTENDANCE' });
    expect(attendance.map(({ entityId }) => entityId)).toEqual([incomplete.id]);
    expect(attendance.map(({ entityId }) => entityId)).not.toContain(future.id);
    await database.lesson.update({
      data: { attendanceCompletedAt: NOW },
      where: { id: incomplete.id },
    });
    attendance = await attention.listItems(ownerToken, { category: 'ATTENDANCE' });
    expect(attendance).toEqual([]);
  });

  it('derives room closure, schedule, substitution and payroll operational items', async () => {
    const { branch, coach } = await branchFoundation('Операционный');
    const substitute = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'substitute-attention@arava.local',
      fullName: 'Тренер Замены',
      password: 'Coach!Substitute2026',
      role: 'COACH',
    });
    const group = await database.danceGroup.create({
      data: {
        branchId: branch.id,
        capacity: 20,
        coachId: coach.id,
        direction: 'Джаз',
        name: 'Джаз',
        status: 'ACTIVE',
      },
    });
    const room = await database.room.create({
      data: { branchId: branch.id, isActive: true, name: 'Большой зал' },
    });
    const futureLesson = await database.lesson.create({
      data: {
        branchId: branch.id,
        coachId: substitute.id,
        endsAt: at(1, 2),
        groupId: group.id,
        roomId: room.id,
        startsAt: at(1, 1),
        status: 'PLANNED',
      },
    });
    const closure = await database.roomClosure.create({
      data: {
        createdByUserId: coach.id,
        endAt: at(1, 3),
        reason: 'Ремонт',
        roomId: room.id,
        startAt: at(1),
      },
    });
    const substitution = await database.trainerSubstitution.create({
      data: {
        createdByUserId: coach.id,
        lessonId: futureLesson.id,
        originalTrainerId: coach.id,
        substituteTrainerId: substitute.id,
      },
    });
    const pastLesson = await database.lesson.create({
      data: {
        branchId: branch.id,
        coachId: coach.id,
        endsAt: at(-1, 1),
        groupId: group.id,
        startsAt: at(-1),
        status: 'COMPLETED',
      },
    });
    await database.payrollRule.create({
      data: {
        amountPerAttendee: 100,
        branchId: branch.id,
        coachId: coach.id,
        isActive: true,
        type: 'PER_ATTENDEE',
        validFrom: at(-30),
      },
    });
    const period = await database.payrollPeriod.create({
      data: {
        branchId: branch.id,
        createdByUserId: coach.id,
        dateFrom: at(-7),
        dateTo: NOW,
        status: 'CALCULATED',
      },
    });

    let items = await attention.listItems(ownerToken);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `room:closure:${closure.id}` }),
        expect.objectContaining({ id: `substitution:${substitution.id}`, severity: 'INFO' }),
        expect.objectContaining({ id: `payroll:attendance:${period.id}`, severity: 'CRITICAL' }),
      ]),
    );
    const otherRoom = await database.room.create({
      data: { branchId: branch.id, isActive: true, name: 'Малый зал' },
    });
    await database.lesson.update({
      data: { roomId: otherRoom.id },
      where: { id: futureLesson.id },
    });
    await database.lesson.update({
      data: { attendanceCompletedAt: NOW },
      where: { id: pastLesson.id },
    });
    items = await attention.listItems(ownerToken);
    expect(items.map(({ id }) => id)).not.toContain(`room:closure:${closure.id}`);
    expect(items.map(({ id }) => id)).not.toContain(`payroll:attendance:${period.id}`);
    expect(items.map(({ id }) => id)).toContain(`payroll:review:${period.id}`);
  });

  it('enforces OWNER scope, ADMIN branch isolation and denies TRAINER IPC-level data', async () => {
    const visible = await branchFoundation('Доступный');
    const hidden = await branchFoundation('Скрытый');
    const admin = await application.createUser(ownerToken, {
      branchIds: [visible.branch.id],
      email: 'attention-admin@arava.local',
      fullName: 'Администратор Центра',
      password: 'Admin!Attention2026',
      role: 'ADMIN',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Attention2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Attention2026',
      newPassword: 'Admin!AttentionChanged2026',
    });
    const coachSession = await application.login({
      email: visible.coach.email,
      password: 'Coach!Attention2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Attention2026',
      newPassword: 'Coach!AttentionChanged2026',
    });

    const ownerItems = await attention.listItems(ownerToken);
    expect(new Set(ownerItems.map(({ branchId }) => branchId))).toEqual(
      new Set([visible.branch.id, hidden.branch.id]),
    );
    const adminItems = await attention.listItems(adminSession.token);
    expect(new Set(adminItems.map(({ branchId }) => branchId))).toEqual(
      new Set([visible.branch.id]),
    );
    await expect(attention.listItems(coachSession.token)).rejects.toThrow(
      'Центр внимания доступен только руководителям.',
    );
    await expect(
      attention.listItems(adminSession.token, { branchId: hidden.branch.id }),
    ).rejects.toThrow();
  });

  it('shows centralized backup health only to OWNER after the initial grace period', async () => {
    await database.appSetting.createMany({
      data: [
        { key: 'backup.initializedAt', value: at(-10).toISOString() },
        { key: 'backup.lastSuccessfulAt', value: at(-8).toISOString() },
        { key: 'backup.consecutiveFailures', value: '2' },
        { key: 'backup.lastError', value: 'Внешний диск недоступен.' },
      ],
    });
    const ownerItems = await attention.listItems(ownerToken, { category: 'BACKUPS' });
    expect(ownerItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'backup:stale', severity: 'CRITICAL' }),
        expect.objectContaining({ id: 'backup:automatic-failures', severity: 'WARNING' }),
      ]),
    );

    const branch = await application.createBranch(ownerToken, { name: 'Филиал администратора' });
    const admin = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'admin-backup-attention@arava.local',
      fullName: 'Администратор резервных копий',
      password: 'Admin!BackupAttention2026',
      role: 'ADMIN',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!BackupAttention2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!BackupAttention2026',
      newPassword: 'Admin!BackupAttentionChanged2026',
    });
    expect(await attention.listItems(adminSession.token, { category: 'BACKUPS' })).toEqual([]);
  });
});
