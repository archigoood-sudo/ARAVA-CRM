import {
  hasPermission,
  t,
  type AuthenticatedUser,
  type PermissionKey,
  type UserRole,
} from '@arava/shared';

import { DomainError } from './security';

export type DomainAction =
  | 'branches:manage'
  | 'contacts:manage'
  | 'attendance:manage'
  | 'groups:manage'
  | 'groups:read'
  | 'lessons:manage'
  | 'lessons:read'
  | 'schedules:manage'
  | 'tariffs:manage'
  | 'tariffs:read'
  | 'subscriptions:manage'
  | 'subscriptions:read'
  | 'subscriptions:adjust'
  | 'payments:manage'
  | 'payments:read'
  | 'refunds:manage'
  | 'finance:read'
  | 'expense-categories:manage'
  | 'expenses:manage'
  | 'expenses:read'
  | 'cash:manage'
  | 'cash:read'
  | 'cash:correct'
  | 'payroll:manage'
  | 'payroll:calculate'
  | 'payroll:approve'
  | 'payroll:pay'
  | 'payroll:adjust'
  | 'payroll:read'
  | 'analytics:read'
  | 'reports:read'
  | 'students:manage'
  | 'students:read'
  | 'users:manage'
  | 'workspace:manage';

const allowedRoles: Record<DomainAction, readonly UserRole[]> = {
  'attendance:manage': ['OWNER', 'ADMIN', 'COACH'],
  'branches:manage': ['OWNER', 'ADMIN'],
  'contacts:manage': ['OWNER', 'ADMIN'],
  'groups:manage': ['OWNER', 'ADMIN'],
  'groups:read': ['OWNER', 'ADMIN', 'COACH'],
  'lessons:manage': ['OWNER', 'ADMIN'],
  'lessons:read': ['OWNER', 'ADMIN', 'COACH'],
  'schedules:manage': ['OWNER', 'ADMIN'],
  'tariffs:manage': ['OWNER', 'ADMIN'],
  'tariffs:read': ['OWNER', 'ADMIN', 'COACH'],
  'subscriptions:manage': ['OWNER', 'ADMIN'],
  'subscriptions:read': ['OWNER', 'ADMIN', 'COACH'],
  'subscriptions:adjust': ['OWNER'],
  'payments:manage': ['OWNER', 'ADMIN'],
  'payments:read': ['OWNER', 'ADMIN'],
  'refunds:manage': ['OWNER'],
  'finance:read': ['OWNER', 'ADMIN'],
  'expense-categories:manage': ['OWNER', 'ADMIN'],
  'expenses:manage': ['OWNER', 'ADMIN'],
  'expenses:read': ['OWNER', 'ADMIN'],
  'cash:manage': ['OWNER', 'ADMIN'],
  'cash:read': ['OWNER', 'ADMIN'],
  'cash:correct': ['OWNER', 'ADMIN'],
  'payroll:manage': ['OWNER', 'ADMIN'],
  'payroll:calculate': ['OWNER', 'ADMIN'],
  'payroll:approve': ['OWNER', 'ADMIN'],
  'payroll:pay': ['OWNER', 'ADMIN'],
  'payroll:adjust': ['OWNER', 'ADMIN'],
  'payroll:read': ['OWNER', 'ADMIN', 'COACH'],
  'analytics:read': ['OWNER', 'ADMIN'],
  'reports:read': ['OWNER', 'ADMIN'],
  'students:manage': ['OWNER', 'ADMIN'],
  'students:read': ['OWNER', 'ADMIN', 'COACH'],
  'users:manage': ['OWNER', 'ADMIN'],
  'workspace:manage': ['OWNER', 'ADMIN'],
};

export function assertPermission(user: AuthenticatedUser, action: DomainAction): void {
  if (!allowedRoles[action].includes(user.role)) {
    throw new DomainError('AUTHORIZATION', t('domain.authorization.permissionDenied'));
  }
}

export function assertCapability(user: AuthenticatedUser, permission: PermissionKey): void {
  if (!hasPermission(user.role, permission)) {
    throw new DomainError('AUTHORIZATION', t('domain.authorization.permissionDenied'));
  }
}

export function canAccessBranch(user: AuthenticatedUser, branchId: string): boolean {
  return (
    user.role === 'OWNER' ||
    (user.role === 'ADMIN' && user.branchIds.length === 0) ||
    user.branchIds.includes(branchId)
  );
}

export function assertBranchAccess(user: AuthenticatedUser, branchId: string): void {
  if (!canAccessBranch(user, branchId)) {
    throw new DomainError('AUTHORIZATION', t('domain.authorization.branchDenied'));
  }
}

export function accessibleBranchIds(user: AuthenticatedUser): string[] | undefined {
  return user.role === 'OWNER' || (user.role === 'ADMIN' && user.branchIds.length === 0)
    ? undefined
    : user.branchIds;
}
