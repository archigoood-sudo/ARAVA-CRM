import type {
  AuthenticatedUser,
  ChatListQuery,
  ChatListResult,
  ChatMessage,
  ChatMessagePage,
  ChatSendInput,
  ChatSummary,
  CommunicationMessagePreview,
  CommunicationTemplate,
  CommunicationTemplateContext,
  CommunicationTemplateInput,
  StudentChatSummary,
} from '@arava/shared';
import { communicationTemplateVariables } from '@arava/shared';
import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from './index';
import type { CrmChatRequestContext, IntegrationService } from './integration-service';
import { canAccessBranch } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';
import { StudentProfileService } from './student-profile-service';

const CUSTOM_TEMPLATES_SETTING = 'communications.customTemplates';
const MAX_CUSTOM_TEMPLATES = 40;

export const SYSTEM_COMMUNICATION_TEMPLATES: CommunicationTemplate[] = [
  systemTemplate(
    'system:lesson-reminder',
    'Напоминание о занятии',
    'Здравствуйте! {{STUDENT_NAME}}, ждём вас на занятии группы «{{GROUP_NAME}}» {{LESSON_DATE}} в {{LESSON_TIME}}. До встречи!',
  ),
  systemTemplate(
    'system:payment-reminder',
    'Напоминание об оплате',
    'Здравствуйте, {{STUDENT_NAME}}! Напоминаем об оплате занятий. Если уже оплатили — спасибо!',
  ),
  systemTemplate(
    'system:after-trial',
    'После пробного',
    'Здравствуйте, {{STUDENT_NAME}}! Как прошло пробное занятие? Будем рады ответить на вопросы.',
  ),
  systemTemplate(
    'system:missed-lesson',
    'Пропустил занятие',
    'Здравствуйте, {{STUDENT_NAME}}! Заметили, что занятие было пропущено. Всё ли в порядке?',
  ),
  systemTemplate(
    'system:subscription-ending',
    'Заканчивается абонемент',
    'Здравствуйте, {{STUDENT_NAME}}! Абонемент скоро заканчивается. Помочь с продлением?',
  ),
  systemTemplate(
    'system:return-invitation',
    'Приглашение вернуться',
    'Здравствуйте, {{STUDENT_NAME}}! Будем рады снова видеть вас на занятиях. Подсказать актуальное расписание?',
  ),
];

function systemTemplate(id: string, name: string, text: string): CommunicationTemplate {
  return {
    id,
    name,
    requiredVariables: communicationTemplateVariables(text),
    source: 'SYSTEM',
    text,
  };
}

interface StoredCommunicationTemplate {
  archivedAt?: string | undefined;
  createdAt: string;
  id: string;
  name: string;
  text: string;
  updatedAt: string;
}

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
    if (/\{\{[^{}]+\}\}/u.test(input.text))
      throw new DomainError('VALIDATION', 'Заполните все переменные шаблона перед отправкой.');
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

  async studentSummary(token: string, studentId: string): Promise<StudentChatSummary> {
    const actor = await this.application.authenticate(token);
    await this.application.getStudent(token, studentId);
    if (actor.role === 'COACH') return emptyStudentSummary('INACCESSIBLE');

    let conversations: ChatSummary[];
    try {
      const remote = await this.integration.listRemoteChats(this.context(actor), {
        filter: 'PRIVATE_ADMIN',
      });
      conversations = [];
      for (const conversation of remote.conversations) {
        if (
          conversation.type === 'PRIVATE_ADMIN' &&
          conversation.linkedStudents.some((student) => student.studentId === studentId) &&
          (await this.canAccess(actor, conversation))
        ) {
          conversations.push(conversation);
          this.remember(actor, conversation);
        }
      }
    } catch {
      return emptyStudentSummary('OFFLINE');
    }

    if (conversations.length === 0) return emptyStudentSummary('NO_CHAT');
    if (conversations.length > 1) return emptyStudentSummary('AMBIGUOUS');

    const conversation = conversations[0];
    if (!conversation) return emptyStudentSummary('NO_CHAT');
    let latest: ChatMessage | undefined;
    let latestInbound: ChatMessage | undefined;
    let latestOutbound: ChatMessage | undefined;
    try {
      const page = await this.integration.getRemoteChatMessages(
        this.context(actor),
        conversation.id,
      );
      await this.assertAccess(actor, page.conversation);
      const visible = page.messages
        .filter((message) => message.body.trim() || message.attachments.length)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      latest = visible[0];
      latestInbound = visible.find((message) => message.senderType === 'client');
      latestOutbound = visible.find(
        (message) => message.senderType === 'admin' || message.senderType === 'trainer',
      );
    } catch {
      // The list summary remains useful if only message history is temporarily unavailable.
    }

    const fallbackPreview = safeMessagePreview(conversation.lastMessage ?? '');
    const profile = await new StudentProfileService(this.database, this.application).getOverview(
      token,
      studentId,
    );
    return {
      canOpen: true,
      conversationId: conversation.id,
      ...(latestInbound ? { latestInbound: communicationPreview(latestInbound) } : {}),
      ...(latestOutbound ? { latestOutbound: communicationPreview(latestOutbound) } : {}),
      ...(latest?.createdAt || conversation.lastMessageAt
        ? { lastMessageAt: latest?.createdAt ?? conversation.lastMessageAt ?? undefined }
        : {}),
      ...(latest ? { lastMessageAuthor: messageAuthor(latest.senderType) } : {}),
      ...(latest
        ? { lastMessagePreview: messagePreview(latest) }
        : fallbackPreview
          ? { lastMessagePreview: fallbackPreview }
          : {}),
      state: 'AVAILABLE',
      suggestedTemplateIds: suggestedTemplateIds({
        ...profile,
        status: profile.student.status,
      }),
      unreadCount: conversation.unreadCount,
    };
  }

  async templateContext(
    token: string,
    conversationId: string,
    requestedStudentId?: string,
  ): Promise<CommunicationTemplateContext> {
    const actor = await this.communicationsActor(token);
    const conversation = await this.integration.getRemoteChat(this.context(actor), conversationId);
    await this.assertAccess(actor, conversation);
    const linkedStudent = requestedStudentId
      ? conversation.linkedStudents.find(({ studentId }) => studentId === requestedStudentId)
      : conversation.linkedStudents.length === 1
        ? conversation.linkedStudents[0]
        : undefined;
    if (requestedStudentId && !linkedStudent)
      throw new DomainError('AUTHORIZATION', 'Ученик не связан с этим чатом.');
    if (!linkedStudent)
      return conversation.type === 'GROUP' ? { groupName: conversation.title } : {};
    const profile = await new StudentProfileService(this.database, this.application).getOverview(
      token,
      linkedStudent.studentId,
    );
    const nextLesson = profile.upcomingLessons[0];
    return {
      ...(nextLesson?.groupName ? { groupName: nextLesson.groupName } : {}),
      ...(nextLesson
        ? {
            lessonDate: formatMoscow(nextLesson.startsAt, {
              day: 'numeric',
              month: 'long',
            }),
            lessonTime: formatMoscow(nextLesson.startsAt, {
              hour: '2-digit',
              minute: '2-digit',
            }),
          }
        : {}),
      studentId: linkedStudent.studentId,
      studentName: profile.student.firstName,
    };
  }

  async templateList(token: string, includeArchived = false): Promise<CommunicationTemplate[]> {
    const actor = await this.communicationsActor(token);
    const custom = (await this.readCustomTemplates()).filter(
      ({ archivedAt }) => !archivedAt || (includeArchived && actor.role === 'OWNER'),
    );
    return [
      ...SYSTEM_COMMUNICATION_TEMPLATES,
      ...custom.map((template) => this.customTemplate(template)),
    ];
  }

  async templateCreate(
    token: string,
    input: CommunicationTemplateInput,
  ): Promise<CommunicationTemplate> {
    await this.owner(token);
    const templates = await this.readCustomTemplates();
    if (templates.length >= MAX_CUSTOM_TEMPLATES)
      throw new DomainError('VALIDATION', 'Можно сохранить не более 40 шаблонов.');
    const now = new Date().toISOString();
    const template: StoredCommunicationTemplate = {
      createdAt: now,
      id: `custom:${randomUUID()}`,
      name: input.name,
      text: input.text,
      updatedAt: now,
    };
    templates.push(template);
    await this.writeCustomTemplates(templates);
    return this.customTemplate(template);
  }

  async templateUpdate(
    token: string,
    id: string,
    input: CommunicationTemplateInput,
  ): Promise<CommunicationTemplate> {
    await this.owner(token);
    const templates = await this.readCustomTemplates();
    const index = templates.findIndex((template) => template.id === id);
    const current = templates[index];
    if (!current) throw new DomainError('NOT_FOUND', 'Шаблон не найден.');
    const updated = { ...current, ...input, updatedAt: new Date().toISOString() };
    templates[index] = updated;
    await this.writeCustomTemplates(templates);
    return this.customTemplate(updated);
  }

  async templateArchive(token: string, id: string): Promise<CommunicationTemplate> {
    await this.owner(token);
    const templates = await this.readCustomTemplates();
    const index = templates.findIndex((template) => template.id === id);
    const current = templates[index];
    if (!current) throw new DomainError('NOT_FOUND', 'Шаблон не найден.');
    const now = new Date().toISOString();
    const archived = { ...current, archivedAt: now, updatedAt: now };
    templates[index] = archived;
    await this.writeCustomTemplates(templates);
    return this.customTemplate(archived);
  }

  async templateDelete(token: string, id: string): Promise<void> {
    await this.owner(token);
    const templates = await this.readCustomTemplates();
    if (!templates.some((template) => template.id === id))
      throw new DomainError('NOT_FOUND', 'Шаблон не найден.');
    await this.writeCustomTemplates(templates.filter((template) => template.id !== id));
  }

  private context(actor: AuthenticatedUser): CrmChatRequestContext {
    return {
      branchIds: actor.branchIds,
      name: actor.fullName,
      role: actor.role,
      userId: actor.id,
    };
  }

  private async communicationsActor(token: string): Promise<AuthenticatedUser> {
    const actor = await this.application.authenticate(token);
    if (actor.role === 'COACH')
      throw new DomainError('AUTHORIZATION', 'Чаты клиентов недоступны тренеру.');
    return actor;
  }

  private async owner(token: string): Promise<AuthenticatedUser> {
    const actor = await this.communicationsActor(token);
    if (actor.role !== 'OWNER')
      throw new DomainError('AUTHORIZATION', 'Управлять шаблонами может только владелец.');
    return actor;
  }

  private async readCustomTemplates(): Promise<StoredCommunicationTemplate[]> {
    const row = await this.database.appSetting.findUnique({
      where: { key: CUSTOM_TEMPLATES_SETTING },
    });
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isStoredTemplate).slice(0, MAX_CUSTOM_TEMPLATES);
    } catch {
      return [];
    }
  }

  private async writeCustomTemplates(templates: StoredCommunicationTemplate[]): Promise<void> {
    await this.database.appSetting.upsert({
      create: { key: CUSTOM_TEMPLATES_SETTING, value: JSON.stringify(templates) },
      update: { value: JSON.stringify(templates) },
      where: { key: CUSTOM_TEMPLATES_SETTING },
    });
  }

  private customTemplate(template: StoredCommunicationTemplate): CommunicationTemplate {
    return {
      ...template,
      requiredVariables: communicationTemplateVariables(template.text),
      source: 'CUSTOM',
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

function emptyStudentSummary(state: StudentChatSummary['state']): StudentChatSummary {
  return { canOpen: false, state, suggestedTemplateIds: [], unreadCount: 0 };
}

function communicationPreview(message: ChatMessage): CommunicationMessagePreview {
  return {
    author: messageAuthor(message.senderType),
    createdAt: message.createdAt,
    text: messagePreview(message),
  };
}

function suggestedTemplateIds(profile: {
  attentionItems: { id: string }[];
  status?: string;
  totalDebt?: number | undefined;
  upcomingLessons: unknown[];
}): string[] {
  const ids: string[] = [];
  const attention = profile.attentionItems.map(({ id }) => id);
  if (profile.totalDebt && profile.totalDebt > 0) ids.push('system:payment-reminder');
  if (profile.upcomingLessons.length > 0) ids.push('system:lesson-reminder');
  if (attention.some((id) => id.startsWith('trial:thinking:'))) ids.push('system:after-trial');
  if (
    attention.some((id) => id.startsWith('trial:missed:') || id.startsWith('attendance:retention:'))
  )
    ids.push('system:missed-lesson');
  if (
    attention.some(
      (id) =>
        id.startsWith('subscription:expiring:') ||
        id.startsWith('subscription:low:') ||
        id.startsWith('subscription:ended:'),
    )
  )
    ids.push('system:subscription-ending');
  if (profile.status === 'LEFT') ids.push('system:return-invitation');
  return [...new Set(ids)].slice(0, 3);
}

function isStoredTemplate(value: unknown): value is StoredCommunicationTemplate {
  if (!value || typeof value !== 'object') return false;
  const template = value as Record<string, unknown>;
  return (
    typeof template.id === 'string' &&
    template.id.startsWith('custom:') &&
    typeof template.name === 'string' &&
    typeof template.text === 'string' &&
    typeof template.createdAt === 'string' &&
    typeof template.updatedAt === 'string' &&
    (template.archivedAt === undefined || typeof template.archivedAt === 'string')
  );
}

function formatMoscow(value: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('ru-RU', {
    ...options,
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

function messageAuthor(senderType: string): NonNullable<StudentChatSummary['lastMessageAuthor']> {
  if (senderType === 'client') return 'CLIENT';
  if (senderType === 'admin') return 'ADMIN';
  if (senderType === 'trainer') return 'TRAINER';
  return 'UNKNOWN';
}

function messagePreview(message: ChatMessage): string {
  const text = safeMessagePreview(message.body);
  if (text) return text;
  if (message.attachments.length === 1) return 'Фото';
  if (message.attachments.length > 1) return 'Вложения';
  return '';
}

function safeMessagePreview(value: string): string {
  const plain = value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return plain.length > 140 ? `${plain.slice(0, 137).trimEnd()}…` : plain;
}
