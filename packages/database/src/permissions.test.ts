import type { AuthenticatedUser, UserRole } from '@arava/shared';
import { describe, expect, it } from 'vitest';

import { assertPermission, canAccessBranch, type DomainAction } from './permissions';

const actions: DomainAction[] = [
  'branches:manage',
  'contacts:manage',
  'students:manage',
  'students:read',
  'users:manage',
  'workspace:manage',
];
const expected: Record<UserRole, DomainAction[]> = {
  ADMIN: actions,
  BRANCH_MANAGER: ['contacts:manage', 'students:manage', 'students:read'],
  COACH: ['students:read'],
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
        else expect(() => assertPermission(user(role), action)).toThrow('permission');
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
