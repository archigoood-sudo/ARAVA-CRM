import { z } from 'zod';

export const APP_NAME = 'ARAVA CRM';
export const APP_ID = 'com.arava.crm';

export const applicationConfigSchema = z.object({
  environment: z.enum(['development', 'production', 'test']),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']),
});

export type ApplicationConfig = z.infer<typeof applicationConfigSchema>;

export function createApplicationConfig(
  values: Partial<ApplicationConfig> = {},
): ApplicationConfig {
  return applicationConfigSchema.parse({
    environment: values.environment ?? 'production',
    logLevel: values.logLevel ?? 'info',
  });
}
