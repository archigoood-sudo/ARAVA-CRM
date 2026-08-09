import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApplicationService,
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  INITIAL_OWNER_EMAIL,
  INITIAL_OWNER_PASSWORD,
  toSqliteUrl,
  type DatabaseClient,
} from '@arava/database';
import {
  IPC_CHANNELS,
  t,
  type AuthSession,
  type BranchSummary,
  type GroupSummary,
  type RoomSummary,
  type ExpenseCategorySummary,
  type ExpenseSummary,
  type CashRegisterSummary,
  type SubscriptionDetail,
  type TariffSummary,
  type TemporaryPasswordResult,
} from '@arava/shared';

vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

import { createIpcHandlers } from './ipc';

describe('Electron IPC boundary', () => {
  let database: DatabaseClient;
  let directory: string;
  let service: ApplicationService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-ipc-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'ipc.db')));
    await initializeDatabase(database);
    service = new ApplicationService(database);
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  it('validates login payloads and returns a hash-free session', async () => {
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    expect(() => handlers[IPC_CHANNELS.authLogin]?.({ email: 'invalid', password: '' })).toThrow();
    const session = (await handlers[IPC_CHANNELS.authLogin]?.({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    })) as AuthSession;
    expect(session.user.role).toBe('OWNER');
    expect(session.user).not.toHaveProperty('passwordHash');
  });

  it('validates secure user, session, and owner recovery IPC operations', async () => {
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    const initial = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    const owner = (await handlers[IPC_CHANNELS.authCompletePasswordChange]?.(initial.token, {
      newPassword: 'Owner!Secure2041',
    })) as AuthSession;
    const branch = await service.createBranch(owner.token, {
      address: 'Улица Тестовая, 1',
      name: 'Тест',
      phone: '+79990000000',
    });
    expect(() =>
      handlers[IPC_CHANNELS.userCreate]?.(owner.token, {
        branchIds: [branch.id],
        email: 'not-an-email',
        fullName: 'Тренер',
        role: 'COACH',
      }),
    ).toThrow();
    const trainer = (await handlers[IPC_CHANNELS.userCreate]?.(owner.token, {
      branchIds: [branch.id],
      email: 'trainer-ipc@arava.local',
      fullName: 'Тренер IPC',
      role: 'COACH',
    })) as TemporaryPasswordResult;
    expect(trainer.temporaryPassword).toHaveLength(16);
    expect(trainer.user).not.toHaveProperty('passwordHash');
    const trainerSession = await service.login({
      email: trainer.user.email,
      password: trainer.temporaryPassword,
    });
    await handlers[IPC_CHANNELS.userRevokeSessions]?.(owner.token, trainer.user.id);
    await expect(handlers[IPC_CHANNELS.authRestore]?.(trainerSession.token)).rejects.toThrow(
      t('domain.authentication.sessionExpired'),
    );
    expect(() =>
      handlers[IPC_CHANNELS.authRecoverOwner]?.({
        email: INITIAL_OWNER_EMAIL,
        newPassword: 'short',
        recoveryCode: 'bad',
      }),
    ).toThrow();
  });

  it('applies service authorization to privileged IPC calls', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Secure2026',
    });
    const branch = await service.createBranch(owner.token, {
      address: 'Main street',
      name: 'Main',
      phone: '+79990000000',
    });
    await service.createUser(owner.token, {
      branchIds: [branch.id],
      email: 'coach@arava.local',
      fullName: 'Coach',
      password: 'Coach!Secure2026',
      role: 'COACH',
    });
    const coach = await service.login({ email: 'coach@arava.local', password: 'Coach!Secure2026' });
    await service.changePassword(coach.token, {
      currentPassword: 'Coach!Secure2026',
      newPassword: 'Coach!Changed2026',
    });
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    await expect(
      handlers[IPC_CHANNELS.branchCreate]?.(coach.token, {
        address: 'No access',
        name: 'Blocked',
        phone: '+79990000001',
      }),
    ).rejects.toThrow(t('domain.authorization.permissionDenied'));
    const visible = (await handlers[IPC_CHANNELS.branchList]?.(
      coach.token,
      false,
    )) as BranchSummary[];
    expect(visible.map(({ id }) => id)).toEqual([branch.id]);
  });

  it('validates Sprint 2 payloads and keeps group permissions in the service layer', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Secure2026',
    });
    const branch = await service.createBranch(owner.token, {
      address: 'Главная улица, 1',
      name: 'Центр',
      phone: '+79990000000',
    });
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    expect(() =>
      handlers[IPC_CHANNELS.groupCreate]?.(owner.token, {
        branchId: branch.id,
        capacity: 0,
        direction: '',
        name: '',
        status: 'ACTIVE',
      }),
    ).toThrow();
    const group = (await handlers[IPC_CHANNELS.groupCreate]?.(owner.token, {
      branchId: branch.id,
      capacity: 12,
      direction: 'Балет',
      name: 'Грация',
      status: 'ACTIVE',
    })) as GroupSummary;
    expect(group).toMatchObject({ branchId: branch.id, name: 'Грация', studentCount: 0 });
    expect(await handlers[IPC_CHANNELS.groupList]?.(owner.token, { search: 'Грац' })).toMatchObject(
      [{ id: group.id }],
    );
  });

  it('validates Sprint 3 payloads and exposes finance only through authorized services', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Secure2026',
    });
    const branch = await service.createBranch(owner.token, {
      address: 'ул. Платёжная, 1',
      name: 'Центр',
      phone: '+79990000000',
    });
    const student = await service.createStudent(owner.token, {
      branchId: branch.id,
      firstName: 'Мила',
      lastName: 'Петрова',
      status: 'ACTIVE',
    });
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    expect(() =>
      handlers[IPC_CHANNELS.tariffCreate]?.(owner.token, {
        branchId: branch.id,
        currency: 'RUB',
        isActive: true,
        name: 'Некорректный пакет',
        price: 10_000,
        type: 'LESSON_PACK',
      }),
    ).toThrow();
    const tariff = (await handlers[IPC_CHANNELS.tariffCreate]?.(owner.token, {
      branchId: branch.id,
      currency: 'RUB',
      isActive: true,
      lessonCount: 4,
      name: 'Четыре занятия',
      price: 40_000,
      type: 'LESSON_PACK',
      validityDays: 30,
    })) as TariffSummary;
    const subscription = (await handlers[IPC_CHANNELS.subscriptionCreate]?.(owner.token, {
      initialPayment: {
        amount: 20_000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CARD',
      },
      salePrice: 40_000,
      startsAt: new Date().toISOString().slice(0, 10),
      studentId: student.id,
      tariffId: tariff.id,
    })) as SubscriptionDetail;
    expect(subscription).toMatchObject({ debt: 20_000, lessonLimit: 4, paidAmount: 20_000 });
    expect(
      await handlers[IPC_CHANNELS.paymentList]?.(owner.token, {
        dateFrom: new Date(Date.now() - 86_400_000).toISOString(),
        dateTo: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).toHaveLength(1);
  });

  it('validates Sprint 4 payloads and posts confirmed expenses through service authorization', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Secure2026',
    });
    const branch = await service.createBranch(owner.token, {
      address: 'ул. Кассовая, 1',
      name: 'Центр',
      phone: '+79990000000',
    });
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    expect(() =>
      handlers[IPC_CHANNELS.expenseCreate]?.(owner.token, {
        amount: 0,
        branchId: branch.id,
        categoryId: '',
        description: '',
        paymentMethod: 'CASH',
        spentAt: 'invalid',
      }),
    ).toThrow();
    const category = (await handlers[IPC_CHANNELS.expenseCategoryCreate]?.(owner.token, {
      branchId: branch.id,
      isActive: true,
      name: 'Аренда',
    })) as ExpenseCategorySummary;
    const register = (await handlers[IPC_CHANNELS.cashRegisterCreate]?.(owner.token, {
      branchId: branch.id,
      isActive: true,
      name: 'Основная касса',
      openingBalance: 100_000,
      type: 'CASH',
    })) as CashRegisterSummary;
    const expense = (await handlers[IPC_CHANNELS.expenseCreate]?.(owner.token, {
      amount: 25_000,
      branchId: branch.id,
      categoryId: category.id,
      description: 'Аренда зала',
      paymentMethod: 'CASH',
      spentAt: new Date().toISOString(),
    })) as ExpenseSummary;
    const confirmed = (await handlers[IPC_CHANNELS.expenseConfirm]?.(
      owner.token,
      expense.id,
      register.id,
    )) as ExpenseSummary;
    expect(confirmed.status).toBe('CONFIRMED');
    expect(await database.cashTransaction.count({ where: { sourceId: expense.id } })).toBe(1);
  });

  it('validates room IPC and keeps the global audit OWNER-only', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Rooms2026',
    });
    const branch = await service.createBranch(owner.token, { name: 'Центр' });
    const admin = await service.createUser(owner.token, {
      branchIds: [branch.id],
      email: 'admin-rooms@arava.local',
      fullName: 'Администратор залов',
      password: 'Admin!Rooms2026',
      role: 'ADMIN',
    });
    const adminSession = await service.login({
      email: admin.email,
      password: 'Admin!Rooms2026',
    });
    await service.changePassword(adminSession.token, {
      currentPassword: 'Admin!Rooms2026',
      newPassword: 'Admin!ChangedRooms2026',
    });
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    expect(() =>
      handlers[IPC_CHANNELS.roomCreate]?.(owner.token, {
        branchId: branch.id,
        capacity: 0,
        isActive: true,
        name: '',
        sortOrder: 0,
      }),
    ).toThrow();
    const room = (await handlers[IPC_CHANNELS.roomCreate]?.(owner.token, {
      branchId: branch.id,
      capacity: 20,
      isActive: true,
      name: 'Большой зал',
      sortOrder: 1,
    })) as RoomSummary;
    expect(room).toMatchObject({ branchId: branch.id, name: 'Большой зал' });
    await expect(handlers[IPC_CHANNELS.auditList]?.(owner.token)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'ROOM_CREATED' })]),
    );
    await expect(handlers[IPC_CHANNELS.auditList]?.(adminSession.token)).rejects.toThrow(
      t('domain.authorization.permissionDenied'),
    );
  });
});
