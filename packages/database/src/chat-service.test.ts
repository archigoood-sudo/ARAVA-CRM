import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatListResult, ChatMessagePage, ChatSummary } from '@arava/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatService } from './chat-service';
import {
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  INITIAL_OWNER_EMAIL,
  INITIAL_OWNER_PASSWORD,
  toSqliteUrl,
  type DatabaseClient,
} from './index';
import type { IntegrationService } from './integration-service';
import { ApplicationService } from './services';
import { StudioService } from './studio-service';

describe('ChatService', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let ownerToken: string;
  let studio: StudioService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-chat-service-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'chat.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    studio = new StudioService(database, application);
    const owner = await application.login({
      email: INITIAL_OWNER_EMAIL,
      password: INITIAL_OWNER_PASSWORD,
    });
    ownerToken = owner.token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!ChatService2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  it('enforces OWNER, branch-restricted ADMIN, and assigned COACH access locally', async () => {
    const branchA = await application.createBranch(ownerToken, { name: 'Центр' });
    const branchB = await application.createBranch(ownerToken, { name: 'Север' });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branchA.id],
      email: 'chat-coach@arava.local',
      fullName: 'Тренер Чатов',
      password: 'Coach!ChatService2026',
      role: 'COACH',
    });
    const admin = await application.createUser(ownerToken, {
      branchIds: [branchA.id],
      email: 'chat-admin@arava.local',
      fullName: 'Администратор Чатов',
      password: 'Admin!ChatService2026',
      role: 'ADMIN',
    });
    const groupA = await studio.createGroup(ownerToken, {
      branchId: branchA.id,
      capacity: 20,
      coachId: coach.id,
      direction: 'Хип-хоп',
      name: 'Группа А',
      status: 'ACTIVE',
    });
    const groupB = await studio.createGroup(ownerToken, {
      branchId: branchB.id,
      capacity: 20,
      direction: 'Балет',
      name: 'Группа Б',
      status: 'ACTIVE',
    });
    const conversations = [
      summary('private-a', 'PRIVATE_ADMIN', null, branchA.id),
      summary('group-a', 'GROUP', groupA.id, branchA.id),
      summary('group-b', 'GROUP', groupB.id, branchB.id),
    ];
    const integration = mockIntegration(conversations);
    const service = new ChatService(database, application, integration);
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!ChatService2026',
    });
    const coachSession = await application.login({
      email: coach.email,
      password: 'Coach!ChatService2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!ChatService2026',
      newPassword: 'Admin!ChatServiceChanged2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!ChatService2026',
      newPassword: 'Coach!ChatServiceChanged2026',
    });

    expect((await service.list(ownerToken, {})).conversations).toHaveLength(3);
    expect((await service.list(adminSession.token, {})).conversations.map(({ id }) => id)).toEqual([
      'private-a',
      'group-a',
    ]);
    expect((await service.list(coachSession.token, {})).conversations.map(({ id }) => id)).toEqual([
      'group-a',
    ]);
    await expect(service.get(coachSession.token, 'private-a')).rejects.toThrow('Нет доступа');
    await expect(service.get(adminSession.token, 'group-b')).rejects.toThrow('Нет доступа');
  });

  it('queues one idempotent pending message and can send offline after an authorized chat was opened', async () => {
    const conversation = summary('private-a', 'PRIVATE_ADMIN', null, null);
    const integration = mockIntegration([conversation]);
    const service = new ChatService(database, application, integration);
    await service.get(ownerToken, conversation.id);
    const remoteChat = vi
      .spyOn(integration, 'getRemoteChat')
      .mockRejectedValue(new Error('offline'));

    const input = { clientMessageId: 'message-offline', text: 'Ответ без сети' };
    const first = await service.send(ownerToken, conversation.id, input);
    const second = await service.send(ownerToken, conversation.id, input);

    expect(first.status).toBe('PENDING');
    expect(second.status).toBe('PENDING');
    expect(await database.syncOutbox.count({ where: { entityType: 'CHAT_MESSAGE' } })).toBe(1);
    expect(remoteChat).not.toHaveBeenCalled();
    service.clearAuthorizationCache();
    await expect(
      service.send(ownerToken, conversation.id, {
        clientMessageId: 'message-after-logout',
        text: 'Не ставить в очередь без нового разрешения',
      }),
    ).rejects.toThrow('offline');
    expect(await database.syncOutbox.count({ where: { entityType: 'CHAT_MESSAGE' } })).toBe(1);
  });

  it('merges only the current sender pending rows into the newest message page', async () => {
    const conversation = summary('private-a', 'PRIVATE_ADMIN', null, null);
    const integration = mockIntegration([conversation]);
    const service = new ChatService(database, application, integration);
    await service.get(ownerToken, conversation.id);
    await service.send(ownerToken, conversation.id, {
      clientMessageId: 'pending-message',
      text: 'Ожидает отправки',
    });

    const page = await service.messages(ownerToken, conversation.id);
    expect(page.messages).toEqual([
      expect.objectContaining({ body: 'Ожидает отправки', status: 'PENDING' }),
    ]);
  });
});

function summary(
  id: string,
  type: ChatSummary['type'],
  crmGroupId: string | null,
  branchId: string | null,
): ChatSummary {
  return {
    branchId,
    crmGroupId,
    id,
    lastMessage: null,
    lastMessageAt: null,
    linkedStudents: branchId
      ? [{ branchId, firstName: 'Анна', lastName: 'Тестова', studentId: `student-${id}` }]
      : [],
    subtitle: '',
    title: id,
    type,
    unreadCount: 1,
    updatedAt: '2026-08-18T12:00:00.000Z',
  };
}

function mockIntegration(conversations: ChatSummary[]): IntegrationService {
  const list: ChatListResult = {
    conversations,
    serverTimestamp: '2026-08-18T12:00:00.000Z',
    totalUnread: conversations.length,
  };
  const page = (conversation: ChatSummary): ChatMessagePage => ({
    conversation,
    hasMore: false,
    messages: [],
    nextCursor: null,
  });
  return {
    getRemoteChat: vi.fn((_context, id: string) => {
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) throw new Error('not found');
      return Promise.resolve(conversation);
    }),
    getRemoteChatMessages: vi.fn((_context, id: string) => {
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) throw new Error('not found');
      return Promise.resolve(page(conversation));
    }),
    listRemoteChats: vi.fn(() => Promise.resolve(list)),
    markRemoteChatRead: vi.fn(() => Promise.resolve()),
    processPending: vi.fn(() => Promise.resolve()),
  } as unknown as IntegrationService;
}
