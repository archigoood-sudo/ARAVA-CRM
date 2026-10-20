import type { ChatMessage, ChatSummary, VkAction } from '@arava/shared';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('VK chats use server delivery without CRM outbox mutations', () => {
  let database: DatabaseClient;
  let directory: string;
  let application: ApplicationService;
  let ownerToken: string;
  const chat: ChatSummary = {
    id: 'vk:123:456',
    channel: 'VK',
    leadId: null,
    branchId: 'branch-a',
    crmGroupId: null,
    title: 'ВК',
    subtitle: 'ВКонтакте',
    type: 'PRIVATE_ADMIN',
    linkedStudents: [],
    lastMessage: null,
    lastMessageAt: null,
    unreadCount: 1,
    updatedAt: '2026-10-20T12:00:00Z',
  };
  const message: ChatMessage = {
    id: 'vk-send-one',
    body: 'Здравствуйте',
    createdAt: '2026-10-20T12:00:00Z',
    attachments: [],
    senderAccountId: null,
    senderName: 'Владелец',
    senderRole: 'OWNER',
    senderType: 'admin',
    status: 'ERROR',
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-vk-chat-'));
    database = createDatabaseClient(toSqliteUrl(join(directory, 'test.db')));
    await initializeDatabase(database);
    application = new ApplicationService(database);
    ownerToken = (
      await application.login({ email: INITIAL_OWNER_EMAIL, password: INITIAL_OWNER_PASSWORD })
    ).token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!VkChats2026',
    });
  });
  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });
  function fixture() {
    const remote = {
      getRemoteChat: vi.fn().mockResolvedValue(chat),
      listRemoteChats: vi.fn().mockResolvedValue({
        conversations: [chat],
        totalUnread: 1,
        serverTimestamp: chat.updatedAt,
      }),
      getRemoteChatMessages: vi.fn().mockResolvedValue({
        conversation: chat,
        messages: [message],
        hasMore: false,
        nextCursor: null,
      }),
      sendRemoteVkChatMessage: vi.fn().mockResolvedValue(message),
      remoteVkAction: vi.fn().mockResolvedValue({ leadId: 'lead-vk-one' }),
      processPending: vi.fn(),
    };
    return {
      remote,
      service: new ChatService(database, application, remote as unknown as IntegrationService),
    };
  }
  it('preserves uncertain provider status and never enqueues or processes CRM sync', async () => {
    const { service, remote } = fixture();
    const before = await database.syncOutbox.count();
    expect(
      (await service.send(ownerToken, chat.id, { clientMessageId: message.id, text: message.body }))
        .status,
    ).toBe('ERROR');
    expect((await service.messages(ownerToken, chat.id)).messages[0]?.status).toBe('ERROR');
    expect(remote.processPending).not.toHaveBeenCalled();
    expect(await database.syncOutbox.count()).toBe(before);
    remote.sendRemoteVkChatMessage.mockRejectedValueOnce(new Error('offline'));
    await expect(
      service.send(ownerToken, chat.id, { clientMessageId: 'vk-send-two', text: 'Проверка' }),
    ).rejects.toThrow('offline');
    expect(await database.syncOutbox.count()).toBe(before);
  });
  it('passes explicit lead creation only through the authorized VK conversation', async () => {
    const { service, remote } = fixture();
    const input: VkAction = {
      action: 'CREATE_LEAD',
      conversationId: chat.id,
      name: 'Заявка',
      phone: '+79991234567',
    };
    expect(await service.vkAction(ownerToken, input)).toEqual({ leadId: 'lead-vk-one' });
    expect(remote.remoteVkAction).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'OWNER' }),
      input,
    );
    expect(await database.student.count()).toBe(0);
    remote.getRemoteChat.mockResolvedValueOnce({ ...chat, channel: undefined });
    await expect(service.vkAction(ownerToken, input)).rejects.toThrow('не диалог ВКонтакте');
  });
  it('allows ADMIN scoped inbox without a student link but not configuration or another branch', async () => {
    const branch = await application.createBranch(ownerToken, { name: 'ВК филиал' });
    const admin = await application.createUser(ownerToken, {
      email: 'admin-vk@test.local',
      fullName: 'Администратор ВК',
      password: 'Admin!VkChats2026',
      role: 'ADMIN',
      branchIds: [branch.id],
    });
    const token = (await application.login({ email: admin.email, password: 'Admin!VkChats2026' }))
      .token;
    await application.changePassword(token, {
      currentPassword: 'Admin!VkChats2026',
      newPassword: 'Admin!VkChanged2026',
    });
    const { service, remote } = fixture();
    remote.getRemoteChat.mockResolvedValueOnce({ ...chat, branchId: branch.id });
    expect((await service.get(token, chat.id)).id).toBe(chat.id);
    await expect(service.get(token, chat.id)).rejects.toThrow('Нет доступа');
    await expect(service.vkAction(token, { action: 'STATUS' })).rejects.toThrow('только владелец');
    expect(remote.remoteVkAction).not.toHaveBeenCalled();
  });
});
