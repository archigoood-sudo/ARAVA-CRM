import type { AttentionItem } from '@arava/shared';
import { describe, expect, it } from 'vitest';

import {
  isCommunicationAttention,
  isMessageToday,
  safeChatReturn,
  studentChatLink,
} from './student-communication-model';

function attention(id: string): AttentionItem {
  return {
    actionLabel: 'Открыть',
    actionRoute: '/students/student-a',
    branchId: 'branch-a',
    branchName: 'Центр',
    category: 'STUDENTS',
    description: 'Причина',
    entityId: 'student-a',
    entityType: 'Student',
    id,
    severity: 'WARNING',
    title: 'Требует внимания',
  };
}

describe('student communication context', () => {
  it.each([
    'trial:thinking:trial-a',
    'trial:missed:trial-a',
    'attendance:retention:student-a',
    'subscription:ended:student-a',
    'student:debt:student-a',
  ])('offers communication for %s without replacing the canonical action', (id) => {
    const item = attention(id);
    expect(isCommunicationAttention(item)).toBe(true);
    expect(item.actionLabel).toBe('Открыть');
    expect(item.actionRoute).toBe('/students/student-a');
  });

  it('does not turn source-of-truth operational problems into communication tasks', () => {
    expect(isCommunicationAttention(attention('payment-operation:failed:operation-a'))).toBe(false);
    expect(isCommunicationAttention(attention('lesson:attendance:lesson-a'))).toBe(false);
  });

  it('builds an exact chat deep-link and accepts only a local student return route', () => {
    expect(studentChatLink('student-a', 'chat-a')).toBe(
      '/chats?conversationId=chat-a&returnTo=%2Fstudents%2Fstudent-a&studentId=student-a',
    );
    expect(studentChatLink('student-a', 'chat-a', 'system:payment-reminder')).toContain(
      'templateId=system%3Apayment-reminder',
    );
    expect(safeChatReturn('/students/student-a')).toBe('/students/student-a');
    expect(safeChatReturn('https://example.test/students/student-a')).toBeUndefined();
    expect(safeChatReturn('/settings')).toBeUndefined();
    expect(safeChatReturn('/students/student-a/../../settings')).toBeUndefined();
  });

  it('recognizes a last message from the current local calendar day', () => {
    const now = new Date('2026-08-27T18:00:00+03:00');
    expect(isMessageToday('2026-08-27T08:00:00+03:00', now)).toBe(true);
    expect(isMessageToday('2026-08-26T23:59:00+03:00', now)).toBe(false);
  });
});
