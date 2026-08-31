import type { UserRole } from '@arava/shared';

export function canManagePaymentRefunds(role: UserRole | undefined): boolean {
  return role === 'OWNER';
}
