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
});
