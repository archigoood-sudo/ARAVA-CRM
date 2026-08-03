import type { AuthenticatedUser, UserRole } from '@arava/shared';

import { DomainError } from './security';

export type DomainAction =
  | 'branches:manage'
  | 'contacts:manage'
  | 'students:manage'
  | 'students:read'
  | 'users:manage'
  | 'workspace:manage';

const allowedRoles: Record<DomainAction, readonly UserRole[]> = {
  'branches:manage': ['OWNER', 'ADMIN'],
  'contacts:manage': ['OWNER', 'ADMIN', 'BRANCH_MANAGER'],
  'students:manage': ['OWNER', 'ADMIN', 'BRANCH_MANAGER'],
  'students:read': ['OWNER', 'ADMIN', 'BRANCH_MANAGER', 'COACH'],
  'users:manage': ['OWNER', 'ADMIN'],
  'workspace:manage': ['OWNER', 'ADMIN'],
};

export function assertPermission(user: AuthenticatedUser, action: DomainAction): void {
  if (!allowedRoles[action].includes(user.role)) {
    throw new DomainError('AUTHORIZATION', 'You do not have permission to perform this action');
  }
}

export function canAccessBranch(user: AuthenticatedUser, branchId: string): boolean {
  return user.role === 'OWNER' || user.role === 'ADMIN' || user.branchIds.includes(branchId);
}

export function assertBranchAccess(user: AuthenticatedUser, branchId: string): void {
  if (!canAccessBranch(user, branchId)) {
    throw new DomainError('AUTHORIZATION', 'You do not have access to this branch');
  }
}

export function accessibleBranchIds(user: AuthenticatedUser): string[] | undefined {
  return user.role === 'OWNER' || user.role === 'ADMIN' ? undefined : user.branchIds;
}
