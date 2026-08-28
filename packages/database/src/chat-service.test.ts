import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatListResult, ChatMessagePage, ChatSummary } from '@arava/shared';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { ChatService, SYSTEM_COMMUNICATION_TEMPLATES } from './chat-service';
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
    await expect(service.image(ownerToken, 'private-a', 'image-one')).resolves.toEqual({
      attachmentId: 'image-one',
      dataUrl: 'data:image/png;base64,AQID',
    });
    await expect(service.image(coachSession.token, 'private-a', 'image-one')).rejects.toThrow(
      'Нет доступа',
    );
  });

  it('queues one idempotent pending message and can send offline after an authorized chat was opened', async () => {
    const conversation = summary('private-a', 'PRIVATE_ADMIN', null, null);
    const integration = mockIntegration([conversation]);
    const service = new ChatService(database, application, integration);
    await service.get(ownerToken, conversation.id);
    await expect(
      service.send(ownerToken, conversation.id, {
        clientMessageId: 'raw-template',
        text: 'Здравствуйте, {{STUDENT_NAME}}',
      }),
    ).rejects.toThrow('Заполните все переменные');
    expect(await database.syncOutbox.count({ where: { entityType: 'CHAT_MESSAGE' } })).toBe(0);
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

  it('returns one exact, safe student private-chat summary without N+1 requests', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Связь' });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Анна',
      lastName: 'Связная',
      status: 'ACTIVE',
    });
    const conversation = summary('private-student', 'PRIVATE_ADMIN', null, branch.id);
    conversation.linkedStudents = [
      {
        branchId: branch.id,
        firstName: student.firstName,
        lastName: student.lastName,
        studentId: student.id,
      },
    ];
    conversation.lastMessage = 'Старый preview';
    conversation.lastMessageAt = '2026-08-18T12:00:00.000Z';
    const integration = mockIntegration([conversation]);
    integration.getRemoteChatMessages.mockResolvedValue({
      conversation,
      hasMore: false,
      messages: [
        {
          attachments: [],
          body: '',
          createdAt: '2026-08-19T12:00:00.000Z',
          id: 'deleted-message',
          senderAccountId: 'client',
          senderName: 'Клиент',
          senderRole: 'CLIENT',
          senderType: 'client',
          status: 'SENT',
        },
        {
          attachments: [],
          body: '<b>Подскажите</b>   время занятия?',
          createdAt: '2026-08-18T13:00:00.000Z',
          id: 'visible-message',
          senderAccountId: 'client',
          senderName: 'Клиент',
          senderRole: 'CLIENT',
          senderType: 'client',
          status: 'SENT',
        },
        {
          attachments: [],
          body: 'Здравствуйте! Сейчас уточним.',
          createdAt: '2026-08-18T12:30:00.000Z',
          id: 'studio-message',
          senderAccountId: null,
          senderName: 'Администратор',
          senderRole: 'ADMIN',
          senderType: 'admin',
          status: 'SENT',
        },
      ],
      nextCursor: null,
    });
    const service = new ChatService(database, application, integration);

    await expect(service.studentSummary(ownerToken, student.id)).resolves.toEqual({
      canOpen: true,
      conversationId: conversation.id,
      latestInbound: {
        author: 'CLIENT',
        createdAt: '2026-08-18T13:00:00.000Z',
        text: 'Подскажите время занятия?',
      },
      latestOutbound: {
        author: 'ADMIN',
        createdAt: '2026-08-18T12:30:00.000Z',
        text: 'Здравствуйте! Сейчас уточним.',
      },
      lastMessageAt: '2026-08-18T13:00:00.000Z',
      lastMessageAuthor: 'CLIENT',
      lastMessagePreview: 'Подскажите время занятия?',
      state: 'AVAILABLE',
      suggestedTemplateIds: [],
      unreadCount: 1,
    });
    expect(integration.listRemoteChats.mock.calls).toHaveLength(1);
    expect(integration.getRemoteChatMessages.mock.calls).toHaveLength(1);
  });

  it('handles no chat, attachment preview, ambiguity, offline, and coach privacy safely', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'Контекст' });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Ирина',
      lastName: 'Контекстова',
      status: 'ACTIVE',
    });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'communication-coach@arava.local',
      fullName: 'Тренер Контекст',
      password: 'Coach!Communication2026',
      role: 'COACH',
    });
    const coachSession = await application.login({
      email: coach.email,
      password: 'Coach!Communication2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Communication2026',
      newPassword: 'Coach!CommunicationChanged2026',
    });
    const group = await studio.createGroup(ownerToken, {
      branchId: branch.id,
      capacity: 12,
      coachId: coach.id,
      direction: 'Хип-хоп',
      name: 'Группа контекста',
      status: 'ACTIVE',
    });
    await studio.addEnrollment(ownerToken, group.id, {
      joinedAt: '2026-08-01',
      overrideCapacity: false,
      status: 'ACTIVE',
      studentId: student.id,
    });

    const noChatIntegration = mockIntegration([]);
    const noChat = new ChatService(database, application, noChatIntegration);
    await expect(noChat.studentSummary(ownerToken, student.id)).resolves.toMatchObject({
      state: 'NO_CHAT',
    });
    await expect(noChat.studentSummary(coachSession.token, student.id)).resolves.toEqual({
      canOpen: false,
      state: 'INACCESSIBLE',
      suggestedTemplateIds: [],
      unreadCount: 0,
    });

    const first = summary('private-first', 'PRIVATE_ADMIN', null, branch.id);
    const second = summary('private-second', 'PRIVATE_ADMIN', null, branch.id);
    for (const conversation of [first, second]) {
      conversation.linkedStudents = [
        {
          branchId: branch.id,
          firstName: student.firstName,
          lastName: student.lastName,
          studentId: student.id,
        },
      ];
    }
    const ambiguous = new ChatService(database, application, mockIntegration([first, second]));
    await expect(ambiguous.studentSummary(ownerToken, student.id)).resolves.toMatchObject({
      state: 'AMBIGUOUS',
    });

    const attachmentIntegration = mockIntegration([first]);
    attachmentIntegration.getRemoteChatMessages.mockResolvedValue({
      conversation: first,
      hasMore: false,
      messages: [
        {
          attachments: [{ id: 'photo', mimeType: 'image/jpeg' }],
          body: '',
          createdAt: '2026-08-20T12:00:00.000Z',
          id: 'photo-message',
          senderAccountId: null,
          senderName: 'Администратор',
          senderRole: 'ADMIN',
          senderType: 'admin',
          status: 'SENT',
        },
      ],
      nextCursor: null,
    });
    await expect(
      new ChatService(database, application, attachmentIntegration).studentSummary(
        ownerToken,
        student.id,
      ),
    ).resolves.toMatchObject({ lastMessageAuthor: 'ADMIN', lastMessagePreview: 'Фото' });

    noChatIntegration.listRemoteChats.mockRejectedValue(new Error('offline'));
    await expect(noChat.studentSummary(ownerToken, student.id)).resolves.toEqual({
      canOpen: false,
      state: 'OFFLINE',
      suggestedTemplateIds: [],
      unreadCount: 0,
    });
  });

  it('supports six system templates and OWNER-only persistent custom template CRUD without sync rows', async () => {
    const integration = mockIntegration([]);
    const service = new ChatService(database, application, integration);
    expect(SYSTEM_COMMUNICATION_TEMPLATES.map(({ name }) => name)).toEqual([
      'Напоминание о занятии',
      'Напоминание об оплате',
      'После пробного',
      'Пропустил занятие',
      'Заканчивается абонемент',
      'Приглашение вернуться',
    ]);

    const branch = await application.createBranch(ownerToken, { name: 'Шаблоны' });
    const admin = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'template-admin@arava.local',
      fullName: 'Администратор Шаблонов',
      password: 'Admin!Templates2026',
      role: 'ADMIN',
    });
    const coach = await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'template-coach@arava.local',
      fullName: 'Тренер Шаблонов',
      password: 'Coach!Templates2026',
      role: 'COACH',
    });
    const adminSession = await application.login({
      email: admin.email,
      password: 'Admin!Templates2026',
    });
    const coachSession = await application.login({
      email: coach.email,
      password: 'Coach!Templates2026',
    });
    await application.changePassword(adminSession.token, {
      currentPassword: 'Admin!Templates2026',
      newPassword: 'Admin!TemplatesChanged2026',
    });
    await application.changePassword(coachSession.token, {
      currentPassword: 'Coach!Templates2026',
      newPassword: 'Coach!TemplatesChanged2026',
    });
    const outboxBeforeTemplates = await database.syncOutbox.count();
    const conflictsBeforeTemplates = await database.syncConflict.count();
    const created = await service.templateCreate(ownerToken, {
      name: 'Своя встреча',
      text: 'Здравствуйте, {{STUDENT_NAME}}!',
    });
    const updated = await service.templateUpdate(ownerToken, created.id, {
      name: 'Своя встреча — новая',
      text: 'Добрый день, {{STUDENT_NAME}}!',
    });
    expect(updated.id).toBe(created.id);
    expect(
      (await service.templateList(adminSession.token)).some(({ id }) => id === created.id),
    ).toBe(true);
    await expect(
      service.templateUpdate(adminSession.token, created.id, {
        name: 'Запрещено',
        text: 'Запрещено',
      }),
    ).rejects.toThrow('только владелец');
    await expect(service.templateList(coachSession.token)).rejects.toThrow('недоступны тренеру');

    await service.templateArchive(ownerToken, created.id);
    expect((await service.templateList(ownerToken)).some(({ id }) => id === created.id)).toBe(
      false,
    );
    expect(
      (await service.templateList(ownerToken, true)).find(({ id }) => id === created.id)
        ?.archivedAt,
    ).toBeTruthy();
    const restarted = new ChatService(database, application, integration);
    expect(
      (await restarted.templateList(ownerToken, true)).find(({ id }) => id === created.id)?.text,
    ).toBe('Добрый день, {{STUDENT_NAME}}!');
    await restarted.templateDelete(ownerToken, created.id);
    expect(
      (await restarted.templateList(ownerToken, true)).some(({ id }) => id === created.id),
    ).toBe(false);
    expect(await database.syncOutbox.count()).toBe(outboxBeforeTemplates);
    expect(await database.syncConflict.count()).toBe(conflictsBeforeTemplates);
  });

  it('keeps rapid local template edits outside sync and conflict processing', async () => {
    const service = new ChatService(database, application, mockIntegration([]));
    const template = await service.templateCreate(ownerToken, { name: 'Быстрый', text: 'Текст 0' });
    for (let index = 1; index <= 100; index += 1) {
      await service.templateUpdate(ownerToken, template.id, {
        name: 'Быстрый',
        text: `Текст ${String(index)}`,
      });
    }
    expect(
      (await service.templateList(ownerToken)).find(({ id }) => id === template.id)?.text,
    ).toBe('Текст 100');
    expect(await database.syncOutbox.count()).toBe(0);
    expect(await database.syncConflict.count()).toBe(0);
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

type MockChatIntegration = IntegrationService & {
  getRemoteChatMessages: Mock;
  listRemoteChats: Mock;
};

function mockIntegration(conversations: ChatSummary[]): MockChatIntegration {
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
    getRemoteChatImage: vi.fn((_context, _conversationId: string, attachmentId: string) =>
      Promise.resolve({ attachmentId, dataUrl: 'data:image/png;base64,AQID' }),
    ),
    listRemoteChats: vi.fn(() => Promise.resolve(list)),
    markRemoteChatRead: vi.fn(() => Promise.resolve()),
    processPending: vi.fn(() => Promise.resolve()),
  } as unknown as MockChatIntegration;
}
