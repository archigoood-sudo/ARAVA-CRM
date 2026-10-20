import { z } from 'zod';

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9:_-]+$/u);
export const vkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('STATUS') }).strict(),
  z.object({ action: z.literal('DISABLE') }).strict(),
  z
    .object({
      action: z.literal('CONFIGURE'),
      groupId: z.number().int().positive(),
      token: z.string().trim().min(16).max(2048),
      callbackSecret: z.string().min(32).max(256),
      confirmation: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u),
      branchId: identifier.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('CREATE_LEAD'),
      conversationId: identifier,
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().min(5).max(32),
    })
    .strict(),
  z
    .object({
      action: z.literal('LINK_STUDENT'),
      conversationId: identifier,
      studentId: identifier,
    })
    .strict(),
]);
export const vkSettingsSchema = z
  .object({
    configured: z.boolean(),
    enabled: z.boolean(),
    groupId: z.number().int().positive().nullable(),
    groupName: z.string().nullable(),
    branchId: z.string().nullable(),
    callbackPath: z.literal('/api/integrations/vk/community'),
    lastCallbackAt: z.string().nullable(),
    lastSendAt: z.string().nullable(),
    lastError: z.string().nullable(),
    uncertainMessages: z.number().int().nonnegative(),
    rejectedMessages: z.number().int().nonnegative(),
    rejectedEvents: z.number().int().nonnegative(),
  })
  .strict();
export const vkResultSchema = z
  .object({
    settings: vkSettingsSchema.optional(),
    studentId: identifier.optional(),
    leadId: identifier.optional(),
  })
  .strict();
export type VkAction = z.infer<typeof vkActionSchema>;
export type VkResult = z.infer<typeof vkResultSchema>;
