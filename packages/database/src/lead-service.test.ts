import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  INITIAL_OWNER_EMAIL,
  INITIAL_OWNER_PASSWORD,
  toSqliteUrl,
  type DatabaseClient,
} from './index';
import {
  IntegrationApiClient,
  type IntegrationFetch,
  type IntegrationService,
} from './integration-service';
import { LeadService } from './lead-service';
import { ApplicationService } from './services';
import { StudioService } from './studio-service';

const lead = {
  branchCrmId: 'branch-a',
  childAge: 9,
  childName: 'Мария Иванова',
  crmGroupId: 'group-a',
  createdAt: '2026-08-23T10:00:00.000Z',
  direction: 'Хип-хоп',
  existingStudentCandidates: [],
  id: 'lead-a',
  note: 'Позвонить вечером',
  originalPhone: '+7 999 123-45-67',
  parentName: 'Анна Иванова',
  phone: '+79991234567',
  source: 'WEBSITE',
  status: 'NEW',
  statusHistory: [],
  updatedAt: '2026-08-23T10:00:00.000Z',
} as const;

describe('Lead Integration API', () => {
  it('uses authenticated canonical paths, filters, and returns only the approved DTO', async () => {
    const requests: {
      body?: string;
      headers: Record<string, string>;
      method: string;
      url: string;
    }[] = [];
    const fetchImplementation: IntegrationFetch = (url, init) => {
      requests.push({
        ...(init.body ? { body: init.body } : {}),
        headers: init.headers,
        method: init.method,
        url,
      });
      const payload =
        url.includes('/convert') || init.method === 'PATCH'
          ? {
              apiVersion: 'v1',
              lead: {
                ...lead,
                secret: 'never-return',
                status: init.method === 'PATCH' ? 'CONTACTED' : 'CONVERTED',
                convertedStudentCrmId: init.method === 'PATCH' ? null : 'student-a',
              },
            }
          : init.method === 'POST' || new URL(url).pathname.endsWith('/leads/lead-a')
            ? { apiVersion: 'v1', lead: { ...lead, secret: 'never-return' } }
            : {
                apiVersion: 'v1',
                leads: [{ ...lead, secret: 'never-return' }],
                newCount: 1,
                serverTimestamp: lead.updatedAt,
                summary: { NEW: 1 },
              };
      return Promise.resolve({ json: () => Promise.resolve(payload), ok: true, status: 200 });
    };
    const api = new IntegrationApiClient(fetchImplementation, 100);
    const context = {
      branchIds: ['branch-a'],
      name: 'Владелец',
      role: 'OWNER' as const,
      userId: 'owner-a',
    };

    const list = await api.listLeads('https://example.test', 'device-a', 'private-token', context, {
      direction: 'Хип-хоп',
      search: '+7999',
      source: 'WEBSITE',
      status: 'NEW',
    });
    const detail = await api.getLead(
      'https://example.test',
      'device-a',
      'private-token',
      context,
      lead.id,
    );
    const created = await api.createLead(
      'https://example.test',
      'device-a',
      'private-token',
      context,
      { phone: '+79991234567', studentName: 'Мария' },
    );
    const updated = await api.updateLeadStatus(
      'https://example.test',
      'device-a',
      'private-token',
      context,
      lead.id,
      'CONTACTED',
      'lead-status-key',
    );
    const assigned = await api.updateLeadGroup(
      'https://example.test',
      'device-a',
      'private-token',
      context,
      lead.id,
      'group-b',
      'lead-group-key',
    );
    const converted = await api.convertLead(
      'https://example.test',
      'device-a',
      'private-token',
      context,
      lead.id,
      'student-a',
      'lead-convert-key',
    );

    expect(requests.map(({ method, url }) => [method, new URL(url).pathname])).toEqual([
      ['GET', '/api/integration/v1/leads'],
      ['GET', '/api/integration/v1/leads/lead-a'],
      ['POST', '/api/integration/v1/leads'],
      ['PATCH', '/api/integration/v1/leads/lead-a'],
      ['PATCH', '/api/integration/v1/leads/lead-a'],
      ['POST', '/api/integration/v1/leads/lead-a/convert'],
    ]);
    expect(new URL(requests[0]?.url ?? '').searchParams.get('search')).toBe('+7999');
    expect(new URL(requests[0]?.url ?? '').searchParams.get('direction')).toBe('Хип-хоп');
    expect(new URL(requests[0]?.url ?? '').searchParams.get('source')).toBe('WEBSITE');
    expect(requests[0]?.headers.Authorization).toBe('Bearer private-token');
    expect(requests[0]?.headers['X-ARAVA-CRM-Context']).toBeTruthy();
    expect(list.leads[0]).not.toHaveProperty('secret');
    expect(detail).not.toHaveProperty('secret');
    expect(created).not.toHaveProperty('secret');
    expect(updated.status).toBe('CONTACTED');
    expect(assigned.crmGroupId).toBe('group-a');
    expect(converted.convertedStudentCrmId).toBe('student-a');
    expect(JSON.stringify({ created, detail, list, updated, converted })).not.toContain(
      'private-token',
    );
  });

  it('reports server errors and only times out for a genuinely stalled transport', async () => {
    const rejected = new IntegrationApiClient(
      () =>
        Promise.resolve({
          json: () => Promise.resolve({ message: 'Временно недоступно' }),
          ok: false,
          status: 503,
        }),
      20,
    );
    await expect(
      rejected.listLeads(
        'https://example.test',
        'device-a',
        'token',
        { branchIds: [], name: 'Owner', role: 'OWNER', userId: 'owner' },
        {},
      ),
    ).rejects.toThrow('Временно недоступно');
    const stalled = new IntegrationApiClient(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          ),
        ),
      5,
    );
    await expect(
      stalled.listLeads(
        'https://example.test',
        'device-a',
        'token',
        { branchIds: [], name: 'Owner', role: 'OWNER', userId: 'owner' },
        {},
      ),
    ).rejects.toThrow('Сервер не ответил вовремя');
  });
});

describe('LeadService permissions', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-leads-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'leads.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Leads2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  it('allows OWNER and ADMIN but denies COACH before remote access', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Центр' });
    const admin = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'lead-admin@arava.local',
      fullName: 'Администратор',
      password: 'Admin!Leads2026',
      role: 'ADMIN',
    });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'lead-coach@arava.local',
      fullName: 'Тренер',
      password: 'Coach!Leads2026',
      role: 'COACH',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Leads2026',
    });
    const coachSession = await application.login({
      email: coach.email,
      password: 'Coach!Leads2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Leads2026',
      newPassword: 'Admin!LeadsChanged2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Leads2026',
      newPassword: 'Coach!LeadsChanged2026',
    });
    const listRemoteLeads = vi.fn().mockResolvedValue({
      leads: [lead],
      newCount: 1,
      serverTimestamp: lead.updatedAt,
      summary: { NEW: 1 },
    });
    const integration = { listRemoteLeads } as unknown as IntegrationService;
    const service = new LeadService(
      database,
      application,
      integration,
      new StudioService(database, application),
    );

    await expect(service.list(ownerToken, {})).resolves.toMatchObject({ newCount: 1 });
    await expect(service.list(adminSession.token, {})).resolves.toMatchObject({ newCount: 1 });
    await expect(service.list(coachSession.token, {})).rejects.toThrow('Тренеру недоступен');
    expect(listRemoteLeads).toHaveBeenCalledTimes(2);
    expect(listRemoteLeads.mock.calls[1]?.[0]).toMatchObject({
      branchIds: [branch.id],
      role: 'ADMIN',
    });
  });
});

describe('LeadService safe conversion', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-lead-conversion-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'leads.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!LeadConversion2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  it('creates one traced student and optional membership, then reuses them on retry', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Центр' });
    const studio = new StudioService(database, application);
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 20,
      direction: 'Хип-хоп',
      name: 'Импульс',
      status: 'RECRUITING',
    });
    let convertedStudentCrmId: string | undefined;
    const remoteLead = () => ({
      ...lead,
      branchCrmId: branch.id,
      crmGroupId: group.id,
      ...(convertedStudentCrmId ? { convertedStudentCrmId, status: 'CONVERTED' as const } : {}),
    });
    const integration = {
      convertRemoteLead: vi.fn((_context, _id, studentId: string) => {
        convertedStudentCrmId = studentId;
        return Promise.resolve(remoteLead());
      }),
      getRemoteLead: vi.fn(() => Promise.resolve(remoteLead())),
    } as unknown as IntegrationService;
    const service = new LeadService(database, application, integration, studio);
    const input = {
      addToGroup: true,
      allowDuplicate: false,
      groupId: group.id,
      student: {
        branchId: branch.id,
        firstName: 'Мария',
        lastName: 'Иванова',
        phone: '+7 999 123-45-67',
        status: 'TRIAL' as const,
      },
    };

    const first = await service.createStudent(ownerToken, lead.id, input);
    const second = await service.createStudent(ownerToken, lead.id, input);

    expect(first.membershipCreated).toBe(true);
    expect(second.student.id).toBe(first.student.id);
    expect(await database.student.count()).toBe(1);
    expect(await database.enrollment.count()).toBe(1);
    expect(
      await database.auditLog.findFirst({
        where: { action: 'WEB_LEAD_STUDENT_CREATED', entityId: lead.id },
      }),
    ).toBeTruthy();
    expect(
      await database.syncOutbox.count({ where: { entityType: 'STUDENT_IDENTITY' } }),
    ).toBeGreaterThan(0);
    expect(
      await database.syncOutbox.count({ where: { entityType: 'GROUP_MEMBERSHIP' } }),
    ).toBeGreaterThan(0);
  });

  it('warns about a local phone match and rejects an inaccessible target group', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Центр' });
    const other = await application.createBranch(ownerToken, { name: 'Север' });
    await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Мария',
      lastName: 'Существующая',
      phone: '+79991234567',
      status: 'ACTIVE',
    });
    const admin = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'scoped-lead-admin@arava.local',
      fullName: 'Администратор',
      password: 'Admin!ScopedLead2026',
      role: 'ADMIN',
    });
    const session = await application.login({
      email: admin.email,
      password: 'Admin!ScopedLead2026',
    });
    await application.changePassword(session.token, {
      currentPassword: 'Admin!ScopedLead2026',
      newPassword: 'Admin!ScopedLeadChanged2026',
    });
    const studio = new StudioService(database, application);
    const hiddenGroup = await studio.createGroup(ownerToken, {
      branchId: other.id,
      capacity: 10,
      direction: 'Балет',
      name: 'Скрытая',
      status: 'ACTIVE',
    });
    const updateRemoteLeadGroup = vi.fn();
    const integration = {
      getRemoteLead: vi.fn(() => Promise.resolve({ ...lead, branchCrmId: branch.id })),
      updateRemoteLeadGroup,
    } as unknown as IntegrationService;
    const service = new LeadService(database, application, integration, studio);

    await expect(service.get(session.token, lead.id)).resolves.toMatchObject({
      existingStudentCandidates: [expect.objectContaining({ displayName: 'Существующая Мария' })],
    });
    await expect(
      service.assignGroup(session.token, lead.id, { crmGroupId: hiddenGroup.id }),
    ).rejects.toThrow();
    expect(updateRemoteLeadGroup).not.toHaveBeenCalled();
  });
});
