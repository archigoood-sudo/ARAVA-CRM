import { describe, expect, it } from 'vitest';
import { vkActionSchema, vkResultSchema } from './vk';

describe('VK IPC contract', () => {
  it('rejects secrets outside configuration and unknown actions', () => {
    expect(vkActionSchema.safeParse({ action: 'STATUS', token: 'secret' }).success).toBe(false);
    expect(vkActionSchema.safeParse({ action: 'SEND_ANY_API_METHOD' }).success).toBe(false);
    expect(vkResultSchema.safeParse({ token: 'secret' }).success).toBe(false);
    expect(
      vkActionSchema.parse({
        action: 'CREATE_LEAD',
        conversationId: 'vk:123:456',
        name: 'Анна',
        phone: '+79991234567',
      }).action,
    ).toBe('CREATE_LEAD');
  });
  it('requires explicit group identity, strong callback secret and confirmation', () => {
    const input = {
      action: 'CONFIGURE',
      groupId: 123,
      token: 'local-community-token-only',
      callbackSecret: 'callback-secret-longer-than-thirty-two-characters',
      confirmation: 'confirmation',
      branchId: null,
    };
    expect(vkActionSchema.safeParse(input).success).toBe(true);
    expect(vkActionSchema.safeParse({ ...input, callbackSecret: 'weak' }).success).toBe(false);
    expect(vkActionSchema.safeParse({ ...input, groupId: -123 }).success).toBe(false);
  });
});
