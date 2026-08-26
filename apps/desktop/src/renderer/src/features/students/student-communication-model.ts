import type { AttentionItem } from '@arava/shared';

export function isCommunicationAttention(item: AttentionItem): boolean {
  return (
    item.id.startsWith('trial:thinking:') ||
    item.id.startsWith('trial:missed:') ||
    item.id.startsWith('attendance:retention:') ||
    item.id.startsWith('subscription:ended:') ||
    item.id.startsWith('student:debt:')
  );
}

export function studentChatLink(studentId: string, conversationId: string): string {
  const returnTo = `/students/${studentId}`;
  return `/chats?conversationId=${encodeURIComponent(conversationId)}&returnTo=${encodeURIComponent(returnTo)}`;
}

export function safeChatReturn(value: string | null): string | undefined {
  return value && /^\/students\/[A-Za-z0-9_.:-]+$/u.test(value) ? value : undefined;
}

export function isMessageToday(value: string, now = new Date()): boolean {
  const message = new Date(value);
  return (
    !Number.isNaN(message.getTime()) &&
    message.getFullYear() === now.getFullYear() &&
    message.getMonth() === now.getMonth() &&
    message.getDate() === now.getDate()
  );
}
