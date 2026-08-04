import { t, type AuthenticatedUser, type UserRole } from '@arava/shared';

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
  | 'students:manage'
  | 'students:read'
  | 'users:manage'
  | 'workspace:manage';

const allowedRoles: Record<DomainAction, readonly UserRole[]> = {
  'attendance:manage': ['OWNER', 'ADMIN', 'BRANCH_MANAGER', 'COACH'],
  'branches:manage': ['OWNER', 'ADMIN'],
  'contacts:manage': ['OWNER', 'ADMIN', 'BRANCH_MANAGER'],
  'groups:manage': ['OWNER', 'ADMIN', 'BRANCH_MANAGER'],
  'groups:read': ['OWNER', 'ADMIN', 'BRANCH_MANAGER', 'COACH'],
  'lessons:manage': ['OWNER', 'ADMIN', 'BRANCH_MANAGER'],
  'lessons:read': ['OWNER', 'ADMIN', 'BRANCH_MANAGER', 'COACH'],
  'schedules:manage': ['OWNER', 'ADMIN', 'BRANCH_MANAGER'],
  'students:manage': ['OWNER', 'ADMIN', 'BRANCH_MANAGER'],
  'students:read': ['OWNER', 'ADMIN', 'BRANCH_MANAGER', 'COACH'],
  'users:manage': ['OWNER', 'ADMIN'],
  'workspace:manage': ['OWNER', 'ADMIN'],
};

export function assertPermission(user: AuthenticatedUser, action: DomainAction): void {
  if (!allowedRoles[action].includes(user.role)) {
    throw new DomainError('AUTHORIZATION', t('domain.authorization.permissionDenied'));
  }
}

export function canAccessBranch(user: AuthenticatedUser, branchId: string): boolean {
  return user.role === 'OWNER' || user.role === 'ADMIN' || user.branchIds.includes(branchId);
}

export function assertBranchAccess(user: AuthenticatedUser, branchId: string): void {
  if (!canAccessBranch(user, branchId)) {
    throw new DomainError('AUTHORIZATION', t('domain.authorization.branchDenied'));
  }
}

export function accessibleBranchIds(user: AuthenticatedUser): string[] | undefined {
  return user.role === 'OWNER' || user.role === 'ADMIN' ? undefined : user.branchIds;
}
