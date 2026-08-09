import {
  hasPermission,
  permissionsForRole,
  t,
  type AuthenticatedUser,
  type UserRole,
} from '@arava/shared';
import { describe, expect, it } from 'vitest';

import { assertPermission, canAccessBranch, type DomainAction } from './permissions';

const actions: DomainAction[] = [
  'attendance:manage',
  'branches:manage',
  'contacts:manage',
  'finance:read',
  'groups:manage',
  'groups:read',
  'lessons:manage',
  'lessons:read',
  'schedules:manage',
  'payments:manage',
  'payments:read',
  'refunds:manage',
  'students:manage',
  'students:read',
  'subscriptions:adjust',
  'subscriptions:manage',
  'subscriptions:read',
  'tariffs:manage',
  'tariffs:read',
  'users:manage',
  'workspace:manage',
];
const expected: Record<UserRole, DomainAction[]> = {
  ADMIN: actions.filter(
    (action) => action !== 'refunds:manage' && action !== 'subscriptions:adjust',
  ),
  COACH: [
    'attendance:manage',
    'groups:read',
    'lessons:read',
    'students:read',
    'subscriptions:read',
    'tariffs:read',
  ],
  OWNER: actions,
};

function user(role: UserRole): AuthenticatedUser {
  return {
    branchIds: ['branch-a'],
    email: `${role.toLowerCase()}@arava.local`,
    fullName: role,
    id: role,
    mustChangePassword: false,
    permissions: permissionsForRole(role),
    role,
  };
}

describe('permission matrix', () => {
  for (const role of ['OWNER', 'ADMIN', 'COACH'] as const) {
    it(`enforces all actions for ${role}`, () => {
      for (const action of actions) {
        if (expected[role].includes(action))
          expect(() => assertPermission(user(role), action)).not.toThrow();
        else
          expect(() => assertPermission(user(role), action)).toThrow(
            t('domain.authorization.permissionDenied'),
          );
      }
    });
  }

  it('limits branch-scoped roles to their assignments', () => {
    expect(canAccessBranch(user('COACH'), 'branch-b')).toBe(false);
    expect(canAccessBranch(user('ADMIN'), 'branch-a')).toBe(true);
    expect(canAccessBranch(user('ADMIN'), 'branch-b')).toBe(false);
    expect(canAccessBranch({ ...user('ADMIN'), branchIds: [] }, 'branch-b')).toBe(true);
    expect(canAccessBranch(user('OWNER'), 'branch-b')).toBe(true);
  });

  it('exposes the centralized business capability matrix', () => {
    expect(hasPermission('OWNER', 'canManageOwners')).toBe(true);
    expect(hasPermission('ADMIN', 'canManageUsers')).toBe(true);
    expect(hasPermission('ADMIN', 'canManageOwners')).toBe(false);
    expect(hasPermission('ADMIN', 'canManageBackups')).toBe(false);
    expect(hasPermission('OWNER', 'canViewAuditLog')).toBe(true);
    expect(hasPermission('ADMIN', 'canViewAuditLog')).toBe(false);
    expect(hasPermission('COACH', 'canViewAuditLog')).toBe(false);
    expect(hasPermission('COACH', 'canManageAttendance')).toBe(true);
    expect(hasPermission('COACH', 'canViewPayroll')).toBe(true);
    expect(hasPermission('COACH', 'canViewPayments')).toBe(false);
    expect(hasPermission('COACH', 'canResetPasswords')).toBe(false);
  });
});
