import { t, type AuthenticatedUser, type UserRole } from '@arava/shared';
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
  ADMIN: actions,
  BRANCH_MANAGER: [
    'attendance:manage',
    'contacts:manage',
    'finance:read',
    'groups:manage',
    'groups:read',
    'lessons:manage',
    'lessons:read',
    'schedules:manage',
    'payments:manage',
    'payments:read',
    'students:manage',
    'students:read',
    'subscriptions:manage',
    'subscriptions:read',
    'tariffs:manage',
    'tariffs:read',
  ],
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
    role,
  };
}

describe('permission matrix', () => {
  for (const role of ['OWNER', 'ADMIN', 'BRANCH_MANAGER', 'COACH'] as const) {
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
    expect(canAccessBranch(user('BRANCH_MANAGER'), 'branch-a')).toBe(true);
    expect(canAccessBranch(user('BRANCH_MANAGER'), 'branch-b')).toBe(false);
    expect(canAccessBranch(user('COACH'), 'branch-b')).toBe(false);
    expect(canAccessBranch(user('ADMIN'), 'branch-b')).toBe(true);
    expect(canAccessBranch(user('OWNER'), 'branch-b')).toBe(true);
  });
});
