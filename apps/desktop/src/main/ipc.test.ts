import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApplicationService,
  BackupService,
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  INITIAL_OWNER_EMAIL,
  INITIAL_OWNER_PASSWORD,
  IntegrationService,
  StudioService,
  type IntegrationCredentialStore,
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
  type MembershipCardSummary,
  type CardScanResolution,
  type GlobalSearchResult,
  type StudentProfileOverview,
  type TrainerProfileOverview,
  type AttentionItem,
  type AttentionSummary,
  type AttendanceScanOptions,
  type AttendanceWorkspaceDay,
  type BackupEntry,
  type BackupRestoreSelection,
  type BackupStatus,
} from '@arava/shared';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => '/tmp/arava-test',
    getVersion: () => 'test',
  },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

import { createIpcHandlers } from './ipc';
import type { CustomerDisplayManager } from './customer-display-manager';
import type { IntegrationManager } from './integration-manager';

class IpcTestCredentials implements IntegrationCredentialStore {
  token: string | undefined;
  clearToken() {
    this.token = undefined;
    return Promise.resolve();
  }
  getDeviceId() {
    return Promise.resolve('6b1a6fe4-329b-428d-adfc-282325257ba4');
  }
  getToken() {
    return Promise.resolve(this.token);
  }
  saveToken(token: string) {
    this.token = token;
    return Promise.resolve();
  }
}

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

  it('keeps integration IPC OWNER-only and never returns device credentials', async () => {
    const initial = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(initial.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!IntegrationIpc2026',
    });
    const branch = await service.createBranch(initial.token, { name: 'IPC' });
    await service.createUser(initial.token, {
      branchIds: [branch.id],
      email: 'integration-admin@arava.local',
      fullName: 'Администратор',
      password: 'Admin!IntegrationIpc2026',
      role: 'ADMIN',
    });
    const admin = await service.login({
      email: 'integration-admin@arava.local',
      password: 'Admin!IntegrationIpc2026',
    });
    await service.changePassword(admin.token, {
      currentPassword: 'Admin!IntegrationIpc2026',
      newPassword: 'Admin!ChangedIpc2026',
    });
    const credentials = new IpcTestCredentials();
    credentials.token = 'never-return-this-secret';
    const integrationService = new IntegrationService(database, service, credentials);
    const integration = {
      schedule: vi.fn(),
      service: integrationService,
    } as unknown as IntegrationManager;
    const handlers = createIpcHandlers(database, service, '/test/arava.db', { integration });
    const ownerStatus = await handlers[IPC_CHANNELS.integrationGetStatus]?.(initial.token);
    expect(JSON.stringify(ownerStatus)).not.toContain(credentials.token);
    const ownerDiagnostics = await handlers[IPC_CHANNELS.integrationDiagnose]?.(initial.token);
    expect(JSON.stringify(ownerDiagnostics)).not.toContain(credentials.token);
    await expect(handlers[IPC_CHANNELS.integrationGetStatus]?.(admin.token)).rejects.toThrow(
      'только владелец',
    );
    await expect(handlers[IPC_CHANNELS.integrationDiagnose]?.(admin.token)).rejects.toThrow(
      'только владелец',
    );
    await expect(
      handlers[IPC_CHANNELS.integrationUpdateSettings]?.(initial.token, {
        baseUrl: 'file:///tmp/arava',
        enabled: true,
      }),
    ).rejects.toThrow('только HTTPS');

    await expect(
      handlers[IPC_CHANNELS.integrationRenameDevice]?.(admin.token, 'foreign-device', {
        displayName: 'Попытка переименовать',
      }),
    ).rejects.toThrow('только владелец');
  });

  it('renames integration devices through OWNER-only IPC handler', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!IntegrationRenameIpc2026',
    });
    const renameDevice = vi.fn().mockResolvedValue({
      connectionState: 'CONNECTED',
      connectionError: undefined,
      conflictCount: 0,
      devices: [],
      enabled: false,
      failedCount: 0,
      isPaired: false,
      lastSuccessfulSync: null,
      pendingCount: 0,
      deviceId: 'rename-origin',
      baseUrl: 'https://local.integration',
    });
    const integration = {
      service: {
        renameDevice,
      } as Pick<IntegrationService, 'renameDevice'>,
    } as unknown as IntegrationManager;
    const handlers = createIpcHandlers(database, service, '/test/arava.db', { integration });
    await expect(
      handlers[IPC_CHANNELS.integrationRenameDevice]?.(owner.token, 'rename-from-ipc', {
        deviceId: 'rename-from-ipc',
        displayName: 'Ресепшен',
      }),
    ).resolves.toBeDefined();
    expect(renameDevice).toHaveBeenCalledWith(
      owner.token,
      expect.objectContaining({
        deviceId: 'rename-from-ipc',
        displayName: 'Ресепшен',
      }),
    );
  });

  it('returns application version and build metadata from system information', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!VersionMeta2026',
    });
    const metadataFile = join(directory, 'app-metadata.json');
    await writeFile(
      metadataFile,
      `${JSON.stringify(
        {
          appVersion: '0.4.5',
          buildCommit: '7e42d97',
          buildDate: '2026-08-19',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const previousMetadataPath = process.env.ARAVA_BUILD_METADATA_PATH;
    process.env.ARAVA_BUILD_METADATA_PATH = metadataFile;

    try {
      const handlers = createIpcHandlers(database, service, '/test/arava.db');
      const system = (await handlers[IPC_CHANNELS.systemInformation]?.(owner.token)) as {
        appVersion: string;
        buildCommit: string;
        buildDate: string;
        databasePath: string;
      };
      expect(system).toMatchObject({
        appVersion: '0.4.5',
        buildCommit: '7e42d97',
        buildDate: '2026-08-19',
      });
    } finally {
      if (previousMetadataPath === undefined) delete process.env.ARAVA_BUILD_METADATA_PATH;
      else process.env.ARAVA_BUILD_METADATA_PATH = previousMetadataPath;
    }
  });

  it('exposes chats only through validated, session-aware IPC', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!ChatIpc2026',
    });
    const conversation = {
      branchId: null,
      crmGroupId: null,
      id: 'private-ipc',
      lastMessage: 'Здравствуйте',
      lastMessageAt: '2026-08-18T12:00:00.000Z',
      linkedStudents: [],
      subtitle: 'Личный чат',
      title: 'Клиент',
      type: 'PRIVATE_ADMIN' as const,
      unreadCount: 1,
      updatedAt: '2026-08-18T12:00:00.000Z',
    };
    const integrationService = {
      getRemoteChat: vi.fn(() => Promise.resolve(conversation)),
      getRemoteChatMessages: vi.fn(() =>
        Promise.resolve({
          conversation,
          hasMore: false,
          messages: [],
          nextCursor: null,
        }),
      ),
      listRemoteChats: vi.fn(() =>
        Promise.resolve({
          conversations: [conversation],
          serverTimestamp: '2026-08-18T12:00:00.000Z',
          totalUnread: 1,
        }),
      ),
      markRemoteChatRead: vi.fn(() => Promise.resolve()),
      processPending: vi.fn(() => Promise.resolve()),
    };
    const integration = {
      schedule: vi.fn(),
      service: integrationService,
    } as unknown as IntegrationManager;
    const handlers = createIpcHandlers(database, service, '/test/arava.db', { integration });

    await expect(handlers[IPC_CHANNELS.chatList]?.(owner.token, {})).resolves.toMatchObject({
      conversations: [{ id: conversation.id }],
    });
    expect(() =>
      handlers[IPC_CHANNELS.chatSend]?.(owner.token, conversation.id, {
        clientMessageId: '',
        text: '',
      }),
    ).toThrow();
    expect(integrationService.listRemoteChats).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'OWNER', userId: owner.user.id }),
      {},
    );
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

  it('validates trainer profile IPC and returns the permission-aware projection', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!TrainerIpc2026',
    });
    const branch = await service.createBranch(owner.token, { name: 'Профильный IPC' });
    const trainer = await service.createUser(owner.token, {
      branchIds: [branch.id],
      email: 'trainer-profile-ipc@arava.local',
      fullName: 'Тренер IPC Профиль',
      password: 'Trainer!Ipc2026',
      role: 'COACH',
    });
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    expect(() =>
      handlers[IPC_CHANNELS.trainerProfileGet]?.(owner.token, trainer.id, 'август'),
    ).toThrow();
    const month = new Date().toISOString().slice(0, 7);
    const profile = (await handlers[IPC_CHANNELS.trainerProfileGet]?.(
      owner.token,
      trainer.id,
      month,
    )) as TrainerProfileOverview;
    expect(profile.trainer).toMatchObject({ id: trainer.id, fullName: 'Тренер IPC Профиль' });
    expect(profile.permissions.canManageTrainer).toBe(true);
    const otherTrainer = await service.createUser(owner.token, {
      branchIds: [branch.id],
      email: 'other-trainer-profile-ipc@arava.local',
      fullName: 'Другой тренер IPC',
      password: 'OtherTrainer!Ipc2026',
      role: 'COACH',
    });
    const trainerSession = await service.login({
      email: trainer.email,
      password: 'Trainer!Ipc2026',
    });
    await service.changePassword(trainerSession.token, {
      currentPassword: 'Trainer!Ipc2026',
      newPassword: 'Trainer!IpcChanged2026',
    });
    await expect(
      handlers[IPC_CHANNELS.trainerProfileGet]?.(trainerSession.token, otherTrainer.id, month),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION' });
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

  it('validates and executes global search through the typed IPC boundary', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!SearchIpc2026',
    });
    const branch = await service.createBranch(owner.token, { name: 'Филиал поиска IPC' });
    const student = await service.createStudent(owner.token, {
      branchId: branch.id,
      firstName: 'Алексей',
      lastName: 'Поисковый',
      status: 'ACTIVE',
    });
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    expect(() => handlers[IPC_CHANNELS.globalSearch]?.(owner.token, ' ')).toThrow();
    const results = (await handlers[IPC_CHANNELS.globalSearch]?.(
      owner.token,
      'поисковый',
    )) as GlobalSearchResult[];
    expect(results).toEqual([
      expect.objectContaining({
        id: student.id,
        route: `/students/${student.id}`,
        type: 'STUDENT',
      }),
    ]);
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

  it('validates the consolidated student profile and note IPC boundary', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!ProfileIpc2026',
    });
    const branch = await service.createBranch(owner.token, { name: 'Профиль IPC' });
    const student = await service.createStudent(owner.token, {
      branchId: branch.id,
      firstName: 'Ирина',
      lastName: 'Профильная',
      status: 'ACTIVE',
    });
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    expect(() =>
      handlers[IPC_CHANNELS.studentNoteCreate]?.(owner.token, student.id, { text: '' }),
    ).toThrow();
    await handlers[IPC_CHANNELS.studentNoteCreate]?.(owner.token, student.id, {
      text: 'Заметка через IPC',
    });
    const overview = (await handlers[IPC_CHANNELS.studentProfileGet]?.(
      owner.token,
      student.id,
    )) as StudentProfileOverview;
    expect(overview).toMatchObject({
      access: 'ADMIN',
      notes: [expect.objectContaining({ text: 'Заметка через IPC' })],
      student: { id: student.id },
    });
  });

  it('validates attention filters and denies administrative alerts to trainers', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!AttentionIpc2026',
    });
    const branch = await service.createBranch(owner.token, { name: 'Внимание IPC' });
    const student = await service.createStudent(owner.token, {
      branchId: branch.id,
      firstName: 'Анна',
      lastName: 'Внимательная',
      status: 'ACTIVE',
    });
    const coach = await service.createUser(owner.token, {
      branchIds: [branch.id],
      email: 'coach-attention-ipc@arava.local',
      fullName: 'Тренер уведомлений',
      password: 'Coach!AttentionIpc2026',
      role: 'COACH',
    });
    const coachSession = await service.login({
      email: coach.email,
      password: 'Coach!AttentionIpc2026',
    });
    await service.changePassword(coachSession.token, {
      currentPassword: 'Coach!AttentionIpc2026',
      newPassword: 'Coach!AttentionIpcChanged2026',
    });
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    expect(() =>
      handlers[IPC_CHANNELS.attentionList]?.(owner.token, { category: 'LEADS' }),
    ).toThrow();
    const items = (await handlers[IPC_CHANNELS.attentionList]?.(owner.token, {
      category: 'STUDENTS',
    })) as AttentionItem[];
    expect(items).toEqual([
      expect.objectContaining({ entityId: student.id, id: `student:no-group:${student.id}` }),
    ]);
    const summary = (await handlers[IPC_CHANNELS.attentionSummary]?.(
      owner.token,
    )) as AttentionSummary;
    expect(summary.total).toBeGreaterThan(0);
    await expect(handlers[IPC_CHANNELS.attentionList]?.(coachSession.token, {})).rejects.toThrow(
      'Центр внимания доступен только руководителям.',
    );
  });

  it('validates card IPC and keeps card permissions in the service layer', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!CardsIpc2026',
    });
    const branch = await service.createBranch(owner.token, { name: 'Карточный филиал' });
    const student = await service.createStudent(owner.token, {
      branchId: branch.id,
      firstName: 'Ирина',
      lastName: 'Карточкина',
      status: 'ACTIVE',
    });
    const coach = await service.createUser(owner.token, {
      branchIds: [branch.id],
      email: 'coach-card-ipc@arava.local',
      fullName: 'Тренер карт IPC',
      password: 'Coach!CardsIpc2026',
      role: 'COACH',
    });
    const coachSession = await service.login({
      email: coach.email,
      password: 'Coach!CardsIpc2026',
    });
    await service.changePassword(coachSession.token, {
      currentPassword: 'Coach!CardsIpc2026',
      newPassword: 'Coach!ChangedCardsIpc2026',
    });
    const returnToPromo = vi.fn().mockResolvedValue(undefined);
    const showStudentForScan = vi.fn().mockResolvedValue(undefined);
    const customerDisplay = {
      returnToPromo,
      showStudentForScan,
    } as unknown as CustomerDisplayManager;
    const handlers = createIpcHandlers(database, service, '/test/arava.db', { customerDisplay });
    expect(() => handlers[IPC_CHANNELS.cardRegister]?.(owner.token, { barcode: '001' })).toThrow();
    const card = (await handlers[IPC_CHANNELS.cardRegister]?.(owner.token, {
      barcode: '0000005001',
    })) as MembershipCardSummary;
    expect(card).toMatchObject({ barcode: '0000005001', status: 'FREE' });
    const assigned = (await handlers[IPC_CHANNELS.cardAssign]?.(owner.token, {
      barcode: '0000005001',
      registerIfUnknown: false,
      studentId: student.id,
    })) as MembershipCardSummary;
    expect(assigned).toMatchObject({ status: 'ASSIGNED', studentId: student.id });
    const scan = (await handlers[IPC_CHANNELS.cardResolveScan]?.(
      owner.token,
      '0000005001',
    )) as CardScanResolution;
    expect(scan).toMatchObject({ result: 'OPENED', studentId: student.id });
    expect(showStudentForScan).toHaveBeenCalledWith(owner.token, student.id);
    expect(await database.attendance.count()).toBe(0);
    await handlers[IPC_CHANNELS.cardResolveScan]?.(owner.token, '9999999999');
    await handlers[IPC_CHANNELS.cardRegister]?.(owner.token, { barcode: '0000005002' });
    await handlers[IPC_CHANNELS.cardResolveScan]?.(owner.token, '0000005002');
    await handlers[IPC_CHANNELS.cardBlock]?.(owner.token, assigned.id, {});
    await handlers[IPC_CHANNELS.cardResolveScan]?.(owner.token, assigned.barcode);
    await handlers[IPC_CHANNELS.cardReactivate]?.(owner.token, assigned.id, {});
    await handlers[IPC_CHANNELS.cardMarkLost]?.(owner.token, assigned.id, {});
    await handlers[IPC_CHANNELS.cardResolveScan]?.(owner.token, assigned.barcode);
    await handlers[IPC_CHANNELS.cardArchive]?.(owner.token, assigned.id, {});
    await handlers[IPC_CHANNELS.cardResolveScan]?.(owner.token, assigned.barcode);
    expect(showStudentForScan).toHaveBeenCalledTimes(1);
    expect(await database.attendance.count()).toBe(0);
    await handlers[IPC_CHANNELS.authLogout]?.(owner.token);
    expect(returnToPromo).toHaveBeenCalledOnce();
    await expect(
      handlers[IPC_CHANNELS.cardRegister]?.(coachSession.token, { barcode: '0000005002' }),
    ).rejects.toThrow(t('domain.authorization.permissionDenied'));
  });

  it('exposes permission-aware attendance workspace and scan options without implicit writes', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!AttendanceIpc2026',
    });
    const studio = new StudioService(database, service);
    const branch = await service.createBranch(owner.token, { name: 'Посещения IPC' });
    const coach = await service.createUser(owner.token, {
      branchIds: [branch.id],
      email: 'coach-attendance-ipc@arava.local',
      fullName: 'Тренер посещений',
      password: 'Coach!AttendanceIpc2026',
      role: 'COACH',
    });
    const coachSession = await service.login({
      email: coach.email,
      password: 'Coach!AttendanceIpc2026',
    });
    await service.changePassword(coachSession.token, {
      currentPassword: 'Coach!AttendanceIpc2026',
      newPassword: 'Coach!AttendanceIpcChanged2026',
    });
    const student = await service.createStudent(owner.token, {
      branchId: branch.id,
      firstName: 'Ирина',
      lastName: 'Посещаемова',
      status: 'ACTIVE',
    });
    const group = await studio.createGroup(owner.token, {
      branchId: branch.id,
      capacity: 20,
      coachId: coach.id,
      direction: 'Хип-хоп',
      name: 'Посещения IPC',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(owner.token, group.id, {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });
    const lesson = await studio.createLesson(owner.token, {
      coachId: coach.id,
      endsAt: '2026-08-23T19:00:00',
      groupId: group.id,
      startsAt: '2026-08-23T18:00:00',
    });
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    expect(() => handlers[IPC_CHANNELS.attendanceToday]?.(owner.token, '23.08.2026')).toThrow();
    const day = (await handlers[IPC_CHANNELS.attendanceToday]?.(
      owner.token,
      '2026-08-23',
    )) as AttendanceWorkspaceDay;
    expect(day.lessons).toEqual([
      expect.objectContaining({ attendanceExpected: 1, id: lesson.id }),
    ]);
    const options = (await handlers[IPC_CHANNELS.attendanceScanOptions]?.(
      owner.token,
      student.id,
      '2026-08-23',
    )) as AttendanceScanOptions;
    expect(options.lessons).toEqual([expect.objectContaining({ lessonId: lesson.id })]);
    expect(await database.attendance.count()).toBe(0);
    await expect(
      handlers[IPC_CHANNELS.attendanceToday]?.(coachSession.token, '2026-08-23'),
    ).rejects.toThrow('Рабочее место «Посещения» доступно владельцу и администраторам.');
  });

  it('keeps payment operations permission-aware and trusted completion test-only', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!PaymentIpc2026',
    });
    const branch = await service.createBranch(owner.token, { name: 'Оплата IPC' });
    const student = await service.createStudent(owner.token, {
      branchId: branch.id,
      firstName: 'Ирина',
      lastName: 'Оплата',
      status: 'ACTIVE',
    });
    const coach = await service.createUser(owner.token, {
      branchIds: [branch.id],
      email: 'coach-payment-ipc@arava.local',
      fullName: 'Тренер оплаты IPC',
      password: 'Coach!PaymentIpc2026',
      role: 'COACH',
    });
    const coachSession = await service.login({
      email: coach.email,
      password: 'Coach!PaymentIpc2026',
    });
    await service.changePassword(coachSession.token, {
      currentPassword: 'Coach!PaymentIpc2026',
      newPassword: 'Coach!ChangedPaymentIpc2026',
    });
    const handlers = createIpcHandlers(database, service, '/test/arava.db');
    const operation = await handlers[IPC_CHANNELS.paymentOperationCreate]?.(owner.token, {
      amount: 10_000,
      branchId: branch.id,
      currency: 'RUB',
      idempotencyKey: 'payment-ipc-operation-1',
      providerType: 'SBP',
      purpose: 'Проверка IPC оплаты',
      studentId: student.id,
    });
    expect(operation).toMatchObject({ status: 'CREATED' });
    await expect(
      handlers[IPC_CHANNELS.paymentOperationListStudent]?.(coachSession.token, student.id),
    ).rejects.toThrow(t('domain.authorization.permissionDenied'));
    const sbpOperation = await handlers[IPC_CHANNELS.paymentOperationCreate]?.(owner.token, {
      amount: 12_000,
      branchId: branch.id,
      currency: 'RUB',
      idempotencyKey: 'payment-ipc-sbp-real-shaped',
      providerType: 'SBP',
      purpose: 'Проверка шлюза СБП',
      studentId: student.id,
    });
    const gatewayService = {
      cancelAqsiPayment: vi.fn(),
      refreshAqsiPayment: vi.fn(),
      sbpProviderHealth: vi.fn(() =>
        Promise.resolve({
          apiReachable: true,
          configured: true,
          deviceConfigured: true,
          provider: 'AQSI_SBP' as const,
        }),
      ),
      startAqsiPayment: vi.fn((_token: string, target: { id: string; providerType: string }) =>
        Promise.resolve({
          amountKopecks: 12_000,
          aravaOperationId: target.id,
          currency: 'RUB' as const,
          provider:
            target.providerType === 'ACQUIRING' ? ('AQSI_CARD' as const) : ('AQSI_SBP' as const),
          providerOperationId: `aqsi-${target.id}`,
          providerResultId: `slip-${target.id}`,
          status: 'SUCCEEDED' as const,
          updatedAt: new Date().toISOString(),
        }),
      ),
    };
    const sbpHandlers = createIpcHandlers(database, service, '/test/arava.db', {
      integration: { service: gatewayService as never } as never,
    });
    await expect(
      sbpHandlers[IPC_CHANNELS.paymentOperationSbpHealth]?.(coachSession.token),
    ).rejects.toThrow(t('domain.authorization.permissionDenied'));
    expect(await sbpHandlers[IPC_CHANNELS.paymentOperationSbpHealth]?.(owner.token)).toEqual({
      apiReachable: true,
      configured: true,
      deviceConfigured: true,
      provider: 'AQSI_SBP',
    });
    expect(
      await sbpHandlers[IPC_CHANNELS.paymentOperationStartSbp]?.(
        owner.token,
        (sbpOperation as { id: string }).id,
      ),
    ).toMatchObject({ status: 'SUCCEEDED' });
    expect(
      await handlers[IPC_CHANNELS.paymentOperationGet]?.(
        owner.token,
        (sbpOperation as { id: string }).id,
      ),
    ).toMatchObject({
      providerOperationId: `aqsi-${(sbpOperation as { id: string }).id}`,
      status: 'SUCCEEDED',
    });
    const cardOperation = await handlers[IPC_CHANNELS.paymentOperationCreate]?.(owner.token, {
      amount: 12_000,
      branchId: branch.id,
      currency: 'RUB',
      idempotencyKey: 'payment-ipc-card-real-shaped',
      providerType: 'ACQUIRING',
      purpose: 'Проверка шлюза оплаты картой',
      studentId: student.id,
    });
    expect(
      await sbpHandlers[IPC_CHANNELS.paymentOperationStartAqsi]?.(
        owner.token,
        (cardOperation as { id: string }).id,
      ),
    ).toMatchObject({ provider: 'AQSI_CARD', status: 'SUCCEEDED' });
    const cardPayment = await database.payment.findFirstOrThrow({
      where: { operation: { id: (cardOperation as { id: string }).id } },
    });
    expect(cardPayment.paymentMethod).toBe('ACQUIRING');
    await expect(
      handlers[IPC_CHANNELS.paymentOperationTestComplete]?.(
        owner.token,
        (operation as { id: string }).id,
        'SBP',
      ),
    ).rejects.toThrow('Тестовый платёжный провайдер отключён');
    process.env.ARAVA_E2E_PAYMENT_PROVIDER = 'memory';
    try {
      await expect(
        handlers[IPC_CHANNELS.paymentOperationSbpDevices]?.(coachSession.token),
      ).rejects.toThrow('только владелец');
      expect(await handlers[IPC_CHANNELS.paymentOperationSbpDevices]?.(owner.token)).toMatchObject({
        selectedDeviceId: 101,
      });
      const completed = await handlers[IPC_CHANNELS.paymentOperationTestComplete]?.(
        owner.token,
        (operation as { id: string }).id,
        'SBP',
      );
      expect(completed).toMatchObject({ status: 'SUCCEEDED' });
      expect(await database.payment.count()).toBe(3);
    } finally {
      delete process.env.ARAVA_E2E_PAYMENT_PROVIDER;
    }
  });

  it('keeps backup filesystem operations narrow and OWNER-only at the IPC boundary', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!BackupIpc2026',
    });
    const databasePath = join(directory, 'ipc.db');
    const backup = new BackupService(database, service, {
      databasePath,
      defaultBackupDirectory: join(directory, 'backups'),
      externalLogPath: join(directory, 'backup-restore.log'),
    });
    await backup.initializePreferences();
    const restorePicker = { path: undefined as string | undefined };
    const handlers = createIpcHandlers(database, service, databasePath, {
      backup,
      chooseBackupFile: () => Promise.resolve(restorePicker.path),
      chooseBackupFolder: () => Promise.resolve(join(directory, 'chosen-backups')),
      chooseExportPath: () => Promise.resolve(join(directory, 'exported.db')),
      openFolder: vi.fn().mockResolvedValue(undefined),
      relaunch: vi.fn(),
    });
    expect(() => handlers[IPC_CHANNELS.backupSetAutomatic]?.(owner.token, 'да')).toThrow();
    const created = (await handlers[IPC_CHANNELS.backupCreate]?.(owner.token)) as BackupEntry;
    expect(created).toMatchObject({ integrity: 'VALID', type: 'MANUAL' });
    restorePicker.path = created.location;
    const selected = (await handlers[IPC_CHANNELS.backupSelectRestoreFile]?.(
      owner.token,
    )) as BackupRestoreSelection;
    expect(selected).toMatchObject({ canRestore: true, integrity: 'VALID' });
    const exported = (await handlers[IPC_CHANNELS.backupExport]?.(owner.token)) as BackupEntry;
    expect(exported.fileName).toBe('exported.db');
    await expect(
      handlers[IPC_CHANNELS.backupValidate]?.(owner.token, '../arava.db'),
    ).rejects.toThrow();
    const changed = (await handlers[IPC_CHANNELS.backupSelectFolder]?.(
      owner.token,
    )) as BackupStatus;
    expect(changed.backupDirectory).toBe(join(directory, 'chosen-backups'));

    const branch = await service.createBranch(owner.token, { name: 'IPC резервирование' });
    const coach = await service.createUser(owner.token, {
      branchIds: [branch.id],
      email: 'coach-backup-ipc@arava.local',
      fullName: 'Тренер резервирования',
      password: 'Coach!BackupIpc2026',
      role: 'COACH',
    });
    const coachSession = await service.login({
      email: coach.email,
      password: 'Coach!BackupIpc2026',
    });
    await service.changePassword(coachSession.token, {
      currentPassword: 'Coach!BackupIpc2026',
      newPassword: 'Coach!BackupIpcChanged2026',
    });
    await expect(handlers[IPC_CHANNELS.backupStatus]?.(coachSession.token)).rejects.toThrow(
      'недостаточно прав',
    );
  });

  it('validates publication IPC and queues publication without renderer-controlled scope', async () => {
    const owner = await service.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    await service.changePassword(owner.token, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!PublicationIpc2026',
    });
    const handlers = createIpcHandlers(database, service, join(directory, 'ipc.db'));
    expect(() =>
      handlers[IPC_CHANNELS.publicationCreate]?.(owner.token, {
        audienceMode: 'ALL_CLIENTS',
        body: '',
        targetIds: [],
        title: '',
        type: 'NEWS',
      }),
    ).toThrow();
    const draft = (await handlers[IPC_CHANNELS.publicationCreate]?.(owner.token, {
      audienceMode: 'ALL_CLIENTS',
      body: 'Безопасный текст',
      targetIds: [],
      title: 'Новость',
      type: 'NEWS',
    })) as { id: string; status: string };
    expect(draft.status).toBe('DRAFT');
    await handlers[IPC_CHANNELS.publicationPublish]?.(owner.token, draft.id);
    expect(
      await database.syncOutbox.count({ where: { entityId: draft.id, entityType: 'PUBLICATION' } }),
    ).toBe(1);
  });
});
