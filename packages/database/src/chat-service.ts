import type {
  AuthenticatedUser,
  ChatListQuery,
  ChatListResult,
  ChatMessage,
  ChatMessagePage,
  ChatSendInput,
  ChatSummary,
} from '@arava/shared';

import type { DatabaseClient } from './index';
import type { CrmChatRequestContext, IntegrationService } from './integration-service';
import { canAccessBranch } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';

export class ChatService {
  private readonly authorizedConversations = new Map<string, Map<string, ChatSummary>>();

  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
    private readonly integration: IntegrationService,
  ) {}

  clearAuthorizationCache(): void {
    this.authorizedConversations.clear();
  }

  async list(token: string, query: ChatListQuery): Promise<ChatListResult> {
    const actor = await this.application.authenticate(token);
    const result = await this.integration.listRemoteChats(this.context(actor), query);
    const conversations: ChatSummary[] = [];
    for (const conversation of result.conversations) {
      if (await this.canAccess(actor, conversation)) {
        conversations.push(conversation);
        this.remember(actor, conversation);
      }
    }
    return {
      ...result,
      conversations,
      totalUnread: conversations.reduce((sum, item) => sum + item.unreadCount, 0),
    };
  }

  async get(token: string, conversationId: string): Promise<ChatSummary> {
    const actor = await this.application.authenticate(token);
    const conversation = await this.integration.getRemoteChat(this.context(actor), conversationId);
    await this.assertAccess(actor, conversation);
    this.remember(actor, conversation);
    return conversation;
  }

  async image(token: string, conversationId: string, attachmentId: string) {
    const actor = await this.application.authenticate(token);
    const conversation = await this.integration.getRemoteChat(this.context(actor), conversationId);
    await this.assertAccess(actor, conversation);
    this.remember(actor, conversation);
    return this.integration.getRemoteChatImage(this.context(actor), conversationId, attachmentId);
  }

  async messages(token: string, conversationId: string, before?: string): Promise<ChatMessagePage> {
    const actor = await this.application.authenticate(token);
    const page = await this.integration.getRemoteChatMessages(
      this.context(actor),
      conversationId,
      before,
    );
    await this.assertAccess(actor, page.conversation);
    this.remember(actor, page.conversation);
    const messages: ChatMessage[] = page.messages.map((message) => ({
      ...message,
      status: 'SENT' as const,
    }));
    if (!before) messages.push(...(await this.pendingMessages(actor, conversationId)));
    return { ...page, messages };
  }

  async markRead(token: string, conversationId: string): Promise<void> {
    const actor = await this.application.authenticate(token);
    const conversation = await this.integration.getRemoteChat(this.context(actor), conversationId);
    await this.assertAccess(actor, conversation);
    this.remember(actor, conversation);
    await this.integration.markRemoteChatRead(this.context(actor), conversationId);
  }

  async send(token: string, conversationId: string, input: ChatSendInput): Promise<ChatMessage> {
    const actor = await this.application.authenticate(token);
    const conversation =
      this.authorizedConversations.get(this.actorCacheKey(actor))?.get(conversationId) ??
      (await this.integration.getRemoteChat(this.context(actor), conversationId));
    await this.assertAccess(actor, conversation);
    this.remember(actor, conversation);
    const context = this.context(actor);
    const now = new Date();
    const idempotencyKey = `chat:${input.clientMessageId}`;
    await this.database.syncOutbox.upsert({
      create: {
        entityId: conversationId,
        entityType: 'CHAT_MESSAGE',
        idempotencyKey,
        nextAttemptAt: now,
        operation: 'UPSERT',
        payloadJson: JSON.stringify({ ...input, context }),
      },
      update: {},
      where: { idempotencyKey },
    });
    await this.integration.processPending();
    const queued = await this.database.syncOutbox.findUniqueOrThrow({
      where: { idempotencyKey },
    });
    return {
      attachments: [],
      body: input.text,
      createdAt: queued.createdAt.toISOString(),
      id: input.clientMessageId,
      senderAccountId: null,
      senderName: actor.fullName,
      senderRole: actor.role,
      senderType: actor.role === 'COACH' ? 'trainer' : 'admin',
      status:
        queued.status === 'SYNCED' ? 'SENT' : queued.status === 'FAILED' ? 'ERROR' : 'PENDING',
    };
  }

  private context(actor: AuthenticatedUser): CrmChatRequestContext {
    return {
      branchIds: actor.branchIds,
      name: actor.fullName,
      role: actor.role,
      userId: actor.id,
    };
  }

  private actorCacheKey(actor: AuthenticatedUser): string {
    return `${actor.id}:${actor.role}:${[...actor.branchIds].sort().join(',')}`;
  }

  private remember(actor: AuthenticatedUser, conversation: ChatSummary): void {
    const key = this.actorCacheKey(actor);
    const conversations = this.authorizedConversations.get(key) ?? new Map<string, ChatSummary>();
    conversations.set(conversation.id, conversation);
    this.authorizedConversations.set(key, conversations);
  }

  private async canAccess(actor: AuthenticatedUser, conversation: ChatSummary): Promise<boolean> {
    if (actor.role === 'OWNER') return true;
    if (conversation.type === 'PRIVATE_ADMIN') {
      if (actor.role === 'COACH') return false;
      if (actor.branchIds.length === 0) return true;
      return conversation.linkedStudents.some(({ branchId }) => canAccessBranch(actor, branchId));
    }
    if (!conversation.crmGroupId) return false;
    const group = await this.database.danceGroup.findUnique({
      select: { assistantCoachId: true, branchId: true, coachId: true },
      where: { id: conversation.crmGroupId },
    });
    if (!group || !canAccessBranch(actor, group.branchId)) return false;
    return (
      actor.role !== 'COACH' || group.coachId === actor.id || group.assistantCoachId === actor.id
    );
  }

  private async assertAccess(actor: AuthenticatedUser, conversation: ChatSummary): Promise<void> {
    if (!(await this.canAccess(actor, conversation))) {
      throw new DomainError('AUTHORIZATION', 'Нет доступа к этому чату.');
    }
  }

  private async pendingMessages(
    actor: AuthenticatedUser,
    conversationId: string,
  ): Promise<ChatMessage[]> {
    const rows = await this.database.syncOutbox.findMany({
      orderBy: { createdAt: 'asc' },
      where: {
        entityId: conversationId,
        entityType: 'CHAT_MESSAGE',
        status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
      },
    });
    return rows.flatMap((row) => {
      try {
        const payload = JSON.parse(row.payloadJson) as {
          clientMessageId?: string;
          context?: { userId?: string };
          text?: string;
        };
        if (!payload.text || !payload.clientMessageId || payload.context?.userId !== actor.id)
          return [];
        return [
          {
            attachments: [],
            body: payload.text,
            createdAt: row.createdAt.toISOString(),
            id: payload.clientMessageId,
            senderAccountId: null,
            senderName: actor.fullName,
            senderRole: actor.role,
            senderType: actor.role === 'COACH' ? 'trainer' : 'admin',
            status: row.status === 'FAILED' ? ('ERROR' as const) : ('PENDING' as const),
          },
        ];
      } catch {
        return [];
      }
    });
  }
}
