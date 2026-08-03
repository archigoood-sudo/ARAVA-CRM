import { z } from 'zod';

export const loginCredentialsSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must contain at least 8 characters'),
});

export type LoginCredentials = z.infer<typeof loginCredentialsSchema>;

export interface AuthenticatedUser {
  email: string;
  name: string;
}
