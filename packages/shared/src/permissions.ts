import type { UserRole } from './channels';

export const PERMISSION_KEYS = [
  'canManageUsers',
  'canManageOwners',
  'canManageBranches',
  'canManageStudents',
  'canManageGroups',
  'canManageSchedule',
  'canManageAttendance',
  'canViewPayments',
  'canManagePayments',
  'canManageRefunds',
  'canManageExpenses',
  'canViewPayroll',
  'canManagePayroll',
  'canViewAnalytics',
  'canManageBackups',
  'canViewAuditLog',
  'canResetPasswords',
  'canManageSystemSettings',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionSet = Readonly<Record<PermissionKey, boolean>>;

const ownerPermissions = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, true])) as Record<
  PermissionKey,
  boolean
>;

const adminPermissions: PermissionSet = {
  canManageUsers: true,
  canManageOwners: false,
  canManageBranches: true,
  canManageStudents: true,
  canManageGroups: true,
  canManageSchedule: true,
  canManageAttendance: true,
  canViewPayments: true,
  canManagePayments: true,
  canManageRefunds: false,
  canManageExpenses: true,
  canViewPayroll: true,
  canManagePayroll: true,
  canViewAnalytics: true,
  canManageBackups: false,
  canViewAuditLog: false,
  canResetPasswords: true,
  canManageSystemSettings: false,
};

const coachPermissions: PermissionSet = {
  canManageUsers: false,
  canManageOwners: false,
  canManageBranches: false,
  canManageStudents: false,
  canManageGroups: false,
  canManageSchedule: false,
  canManageAttendance: true,
  canViewPayments: false,
  canManagePayments: false,
  canManageRefunds: false,
  canManageExpenses: false,
  canViewPayroll: true,
  canManagePayroll: false,
  canViewAnalytics: false,
  canManageBackups: false,
  canViewAuditLog: false,
  canResetPasswords: false,
  canManageSystemSettings: false,
};

export function permissionsForRole(role: UserRole): PermissionSet {
  if (role === 'OWNER') return ownerPermissions;
  if (role === 'ADMIN') return adminPermissions;
  return coachPermissions;
}

export function hasPermission(role: UserRole, permission: PermissionKey): boolean {
  return permissionsForRole(role)[permission];
}
