import { z } from 'zod';

import type { SettingUpdate } from './channels';

export const settingKeySchema = z.enum(['appearance.theme', 'general.workspaceName']);

export const settingUpdateSchema: z.ZodType<SettingUpdate> = z.object({
  key: settingKeySchema,
  value: z.string().max(200),
});
