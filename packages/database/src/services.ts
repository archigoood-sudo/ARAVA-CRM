import type {
  AuthSession,
  AuthenticatedUser,
  BranchInput,
  BranchSummary,
  ForcedPasswordChangeInput,
  LoginCredentials,
  OwnerRecoveryInput,
  OwnerRecoveryResult,
  PasswordChangeInput,
  RecoveryCodeResult,
  RecoveryCodeStatus,
  StudentContactInput,
  StudentContactSummary,
  StudentDetail,
  StudentInput,
  StudentListQuery,
  StudentListResult,
  StudentSummary,
  TemporaryPasswordResult,
  UserCreateInput,
  UserSummary,
  UserUpdateInput,
} from '@arava/shared';
import { permissionsForRole, t } from '@arava/shared';
import { Prisma, type Branch, type Student, type StudentContact, type User } from '@prisma/client';

import type { DatabaseClient } from './index';
import {
  accessibleBranchIds,
  assertBranchAccess,
  assertPermission,
  canAccessBranch,
} from './permissions';
import {
  createRecoveryCode as generateRecoveryCode,
  createSessionToken,
  createTemporaryPassword,
  DomainError,
  hashPassword,
  hashSessionToken,
  normalizePhone,
  SECURITY_CONFIG,
  verifyPassword,
} from './security';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

type UserWithBranches = User & { branchAssignments: { branchId: string }[] };
type StudentWithBranch = Student & { branch: Branch };

function optionalValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : null;
}

function userSessionView(user: UserWithBranches): AuthenticatedUser {
  return {
    branchIds: user.branchAssignments.map(({ branchId }) => branchId),
    email: user.email,
    fullName: user.fullName,
    id: user.id,
    mustChangePassword: user.mustChangePassword,
    permissions: permissionsForRole(user.role),
    role: user.role,
  };
}

function userSummary(user: UserWithBranches): UserSummary {
  return {
    ...userSessionView(user),
    createdAt: user.createdAt.toISOString(),
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString(),
    lockedUntil: user.lockedUntil?.toISOString(),
    phone: user.phone ?? undefined,
    updatedAt: user.updatedAt.toISOString(),
  };
}

function branchSummary(branch: Branch): BranchSummary {
  return {
    address: branch.address?.length ? branch.address : undefined,
    archivedAt: branch.archivedAt?.toISOString(),
    createdAt: branch.createdAt.toISOString(),
    description: branch.description ?? undefined,
    id: branch.id,
    isActive: branch.isActive,
    name: branch.name,
    phone: branch.phone?.length ? branch.phone : undefined,
    updatedAt: branch.updatedAt.toISOString(),
  };
}

function contactSummary(contact: StudentContact): StudentContactSummary {
  return {
    createdAt: contact.createdAt.toISOString(),
    email: contact.email ?? undefined,
    fullName: contact.fullName,
    id: contact.id,
    isPrimary: contact.isPrimary,
    notes: contact.notes ?? undefined,
    phone: contact.phone,
    relationship: contact.relationship,
    secondaryPhone: contact.secondaryPhone ?? undefined,
    studentId: contact.studentId,
    telegram: contact.telegram ?? undefined,
    updatedAt: contact.updatedAt.toISOString(),
    whatsapp: contact.whatsapp,
  };
}

function studentSummary(student: StudentWithBranch): StudentSummary {
  return {
    archivedAt: student.archivedAt?.toISOString(),
    birthDate: student.birthDate?.toISOString().slice(0, 10),
    branchId: student.branchId,
    branchName: student.branch.name,
    createdAt: student.createdAt.toISOString(),
    email: student.email ?? undefined,
    firstName: student.firstName,
    gender: student.gender ?? undefined,
    id: student.id,
    lastName: student.lastName,
    middleName: student.middleName ?? undefined,
    notes: student.notes ?? undefined,
    phone: student.phone ?? undefined,
    status: student.status,
    updatedAt: student.updatedAt.toISOString(),
  };
}

function studentData(input: StudentInput) {
  return {
    birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null,
    branchId: input.branchId,
    email: optionalValue(input.email)?.toLowerCase() ?? null,
    firstName: input.firstName.trim(),
    gender: input.gender ?? null,
    lastName: input.lastName.trim(),
    middleName: optionalValue(input.middleName),
    notes: optionalValue(input.notes),
    phone: input.phone ? normalizePhone(input.phone) : null,
    status: input.status,
  } satisfies Prisma.StudentUncheckedCreateInput;
}

function contactData(input: StudentContactInput) {
  return {
    email: optionalValue(input.email)?.toLowerCase() ?? null,
    fullName: input.fullName.trim(),
    isPrimary: input.isPrimary,
    notes: optionalValue(input.notes),
    phone: normalizePhone(input.phone),
    relationship: input.relationship.trim(),
    secondaryPhone: input.secondaryPhone ? normalizePhone(input.secondaryPhone) : null,
    telegram: optionalValue(input.telegram),
    whatsapp: input.whatsapp,
  };
}

export class ApplicationService {
  constructor(private readonly database: DatabaseClient) {}

  async login(credentials: LoginCredentials): Promise<AuthSession> {
    const user = await this.database.user.findUnique({
      include: { branchAssignments: { select: { branchId: true } } },
      where: { email: credentials.email.trim().toLowerCase() },
    });
    if (!user) {
      throw new DomainError('AUTHENTICATION', t('domain.authentication.invalidCredentials'));
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.audit(user.id, 'AUTH_LOGIN_BLOCKED', 'User', user.id);
      throw new DomainError('AUTHENTICATION', t('domain.authentication.accountLocked'));
    }

    if (!user.isActive || !(await verifyPassword(credentials.password, user.passwordHash))) {
      const attempts = user.failedLoginAttempts + 1;
      const lockedUntil =
        user.isActive && attempts >= SECURITY_CONFIG.maxLoginAttempts
          ? new Date(Date.now() + SECURITY_CONFIG.loginLockMinutes * 60_000)
          : null;
      await this.database.$transaction(async (transaction) => {
        await transaction.user.update({
          data: { failedLoginAttempts: attempts, lockedUntil },
          where: { id: user.id },
        });
        await transaction.auditLog.create({
          data: {
            action: lockedUntil ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_LOGIN_FAILED',
            actorUserId: user.id,
            detail: JSON.stringify({ attempts }),
            entityId: user.id,
            entityType: 'User',
          },
        });
      });
      if (lockedUntil)
        throw new DomainError('AUTHENTICATION', t('domain.authentication.accountLocked'));
      throw new DomainError('AUTHENTICATION', t('domain.authentication.invalidCredentials'));
    }

    const token = createSessionToken();
    const authenticated = await this.database.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        data: { failedLoginAttempts: 0, lastLoginAt: new Date(), lockedUntil: null },
        include: { branchAssignments: { select: { branchId: true } } },
        where: { id: user.id },
      });
      await transaction.session.create({
        data: {
          expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
          securityVersion: updated.securityVersion,
          tokenHash: hashSessionToken(token),
          userId: updated.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'AUTH_LOGIN_SUCCEEDED',
          actorUserId: updated.id,
          entityId: updated.id,
          entityType: 'User',
        },
      });
      return updated;
    });
    return { token, user: userSessionView(authenticated) };
  }

  async restoreSession(token: string): Promise<AuthenticatedUser> {
    return this.authenticate(token, true);
  }

  async logout(token: string): Promise<void> {
    await this.database.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }

  async changePassword(token: string, input: PasswordChangeInput): Promise<AuthenticatedUser> {
    const actor = await this.authenticate(token, true);
    const user = await this.database.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new DomainError('AUTHENTICATION', t('domain.authentication.passwordIncorrect'));
    }
    const passwordHash = await hashPassword(input.newPassword);
    const tokenHash = hashSessionToken(token);
    const updated = await this.database.$transaction(async (transaction) => {
      const changed = await transaction.user.update({
        data: {
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          passwordHash,
          securityVersion: { increment: 1 },
        },
        include: { branchAssignments: { select: { branchId: true } } },
        where: { id: actor.id },
      });
      await transaction.session.deleteMany({
        where: { tokenHash: { not: tokenHash }, userId: actor.id },
      });
      await transaction.session.update({
        data: { securityVersion: changed.securityVersion },
        where: { tokenHash },
      });
      await transaction.auditLog.create({
        data: {
          action: 'AUTH_PASSWORD_CHANGED',
          actorUserId: actor.id,
          entityId: actor.id,
          entityType: 'User',
        },
      });
      return changed;
    });
    return userSessionView(updated);
  }

  async completePasswordChange(
    token: string,
    input: ForcedPasswordChangeInput,
  ): Promise<AuthSession> {
    const actor = await this.authenticate(token, true);
    if (!actor.mustChangePassword)
      throw new DomainError('VALIDATION', t('domain.validation.passwordChangeNotRequired'));
    const passwordHash = await hashPassword(input.newPassword);
    const newToken = createSessionToken();
    const updated = await this.database.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        data: {
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          passwordHash,
          securityVersion: { increment: 1 },
        },
        include: { branchAssignments: { select: { branchId: true } } },
        where: { id: actor.id },
      });
      await transaction.session.deleteMany({ where: { userId: actor.id } });
      await transaction.session.create({
        data: {
          expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
          securityVersion: user.securityVersion,
          tokenHash: hashSessionToken(newToken),
          userId: user.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'AUTH_FORCED_PASSWORD_CHANGED',
          actorUserId: user.id,
          entityId: user.id,
          entityType: 'User',
        },
      });
      return user;
    });
    return { token: newToken, user: userSessionView(updated) };
  }

  async authenticate(token: string, allowPasswordChange = false): Promise<AuthenticatedUser> {
    const session = await this.database.session.findUnique({
      include: {
        user: { include: { branchAssignments: { select: { branchId: true } } } },
      },
      where: { tokenHash: hashSessionToken(token) },
    });
    if (
      !session ||
      session.expiresAt.getTime() <= Date.now() ||
      !session.user.isActive ||
      session.securityVersion !== session.user.securityVersion
    ) {
      if (session) await this.database.session.delete({ where: { id: session.id } });
      throw new DomainError('AUTHENTICATION', t('domain.authentication.sessionExpired'));
    }

    if (session.user.mustChangePassword && !allowPasswordChange) {
      throw new DomainError('AUTHORIZATION', t('domain.authorization.passwordChange'));
    }
    if (Date.now() - session.lastUsedAt.getTime() > 5 * 60 * 1000) {
      await this.database.session.update({
        data: { lastUsedAt: new Date() },
        where: { id: session.id },
      });
    }
    return userSessionView(session.user);
  }

  async listUsers(token: string): Promise<UserSummary[]> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'users:manage');
    const users = await this.database.user.findMany({
      include: { branchAssignments: { select: { branchId: true } } },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      where:
        actor.role === 'ADMIN'
          ? {
              role: 'COACH',
              ...(actor.branchIds.length
                ? { branchAssignments: { some: { branchId: { in: actor.branchIds } } } }
                : {}),
            }
          : {},
    });
    return users.map(userSummary);
  }

  async createUser(token: string, input: UserCreateInput): Promise<UserSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'users:manage');
    if (actor.role === 'ADMIN' && input.role !== 'COACH')
      throw new DomainError('AUTHORIZATION', t('domain.authorization.userRoleManage'));
    await this.validateBranchAssignments(input.branchIds);
    for (const branchId of input.branchIds) assertBranchAccess(actor, branchId);
    try {
      const password = input.password ?? createTemporaryPassword();
      const created = await this.database.user.create({
        data: {
          branchAssignments: { create: input.branchIds.map((branchId) => ({ branchId })) },
          email: input.email.trim().toLowerCase(),
          fullName: input.fullName.trim(),
          mustChangePassword: true,
          passwordHash: await hashPassword(password),
          phone: input.phone ? normalizePhone(input.phone) : null,
          role: input.role,
        },
        include: { branchAssignments: { select: { branchId: true } } },
      });
      await this.audit(actor.id, 'USER_CREATED', 'User', created.id, { role: created.role });
      return userSummary(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DomainError('CONFLICT', t('domain.conflict.userEmail'));
      }
      throw error;
    }
  }

  async createUserWithTemporaryPassword(
    token: string,
    input: UserCreateInput,
  ): Promise<TemporaryPasswordResult> {
    const temporaryPassword = createTemporaryPassword();
    const user = await this.createUser(token, { ...input, password: temporaryPassword });
    return { temporaryPassword, user };
  }

  async updateUser(token: string, id: string, input: UserUpdateInput): Promise<UserSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'users:manage');
    const target = await this.database.user.findUnique({
      include: { branchAssignments: { select: { branchId: true } } },
      where: { id },
    });
    if (!target) throw new DomainError('NOT_FOUND', t('domain.notFound.user'));
    if (actor.role === 'ADMIN' && (target.role !== 'COACH' || input.role !== 'COACH'))
      throw new DomainError('AUTHORIZATION', t('domain.authorization.userRoleManage'));
    if (actor.id === id && (!input.isActive || input.role !== actor.role)) {
      throw new DomainError('VALIDATION', t('domain.validation.ownAccount'));
    }
    if (target.role === 'OWNER' && (input.role !== 'OWNER' || !input.isActive)) {
      const owners = await this.database.user.count({ where: { isActive: true, role: 'OWNER' } });
      if (owners <= 1) throw new DomainError('VALIDATION', t('domain.validation.lastOwner'));
    }
    await this.validateBranchAssignments(input.branchIds);
    for (const branchId of input.branchIds) assertBranchAccess(actor, branchId);
    const updated = await this.database.$transaction(async (transaction) => {
      await transaction.userBranch.deleteMany({ where: { userId: id } });
      await transaction.user.update({
        data: {
          branchAssignments: { create: input.branchIds.map((branchId) => ({ branchId })) },
          fullName: input.fullName.trim(),
          isActive: input.isActive,
          phone: input.phone ? normalizePhone(input.phone) : null,
          role: input.role,
          securityVersion: { increment: 1 },
          sessions: { deleteMany: {} },
        },
        where: { id },
      });
      return transaction.user.findUniqueOrThrow({
        include: { branchAssignments: { select: { branchId: true } } },
        where: { id },
      });
    });
    await this.audit(actor.id, 'USER_UPDATED', 'User', id, {
      active: updated.isActive,
      role: updated.role,
    });
    if (target.isActive !== updated.isActive)
      await this.audit(
        actor.id,
        updated.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        'User',
        id,
      );
    if (target.role !== updated.role)
      await this.audit(actor.id, 'USER_ROLE_CHANGED', 'User', id, {
        from: target.role,
        to: updated.role,
      });
    const previousBranches = target.branchAssignments.map(({ branchId }) => branchId).sort();
    const nextBranches = [...input.branchIds].sort();
    if (JSON.stringify(previousBranches) !== JSON.stringify(nextBranches))
      await this.audit(actor.id, 'USER_BRANCH_ACCESS_CHANGED', 'User', id, {
        branchCount: nextBranches.length,
      });
    return userSummary(updated);
  }

  async resetUserPassword(token: string, id: string): Promise<TemporaryPasswordResult> {
    const actor = await this.authenticate(token);
    const target = await this.requireManageableUser(actor, id);
    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const updated = await this.database.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          mustChangePassword: true,
          passwordHash,
          securityVersion: { increment: 1 },
        },
        include: { branchAssignments: { select: { branchId: true } } },
        where: { id: target.id },
      });
      await transaction.session.deleteMany({ where: { userId: target.id } });
      await transaction.auditLog.create({
        data: {
          action: 'USER_PASSWORD_RESET',
          actorUserId: actor.id,
          entityId: target.id,
          entityType: 'User',
        },
      });
      return user;
    });
    return { temporaryPassword, user: userSummary(updated) };
  }

  async revokeUserSessions(token: string, id: string): Promise<void> {
    const actor = await this.authenticate(token);
    const target = await this.requireManageableUser(actor, id);
    await this.database.$transaction(async (transaction) => {
      await transaction.user.update({
        data: { securityVersion: { increment: 1 } },
        where: { id: target.id },
      });
      await transaction.session.deleteMany({ where: { userId: target.id } });
      await transaction.auditLog.create({
        data: {
          action: 'USER_SESSIONS_REVOKED',
          actorUserId: actor.id,
          entityId: target.id,
          entityType: 'User',
        },
      });
    });
  }

  async recoveryCodeStatus(token: string): Promise<RecoveryCodeStatus> {
    const actor = await this.authenticate(token);
    if (actor.role !== 'OWNER')
      throw new DomainError('AUTHORIZATION', t('domain.authorization.ownerSecurity'));
    const user = await this.database.user.findUniqueOrThrow({ where: { id: actor.id } });
    return {
      configured: Boolean(user.recoveryCodeHash),
      createdAt: user.recoveryCodeCreatedAt?.toISOString(),
    };
  }

  async createRecoveryCode(token: string): Promise<RecoveryCodeResult> {
    const actor = await this.authenticate(token);
    if (actor.role !== 'OWNER')
      throw new DomainError('AUTHORIZATION', t('domain.authorization.ownerSecurity'));
    const current = await this.database.user.findUniqueOrThrow({ where: { id: actor.id } });
    const recoveryCode = generateRecoveryCode();
    const createdAt = new Date();
    await this.database.$transaction(async (transaction) => {
      await transaction.user.update({
        data: {
          recoveryCodeCreatedAt: createdAt,
          recoveryCodeHash: await hashPassword(recoveryCode),
          recoveryFailedAttempts: 0,
          recoveryLockedUntil: null,
        },
        where: { id: actor.id },
      });
      await transaction.auditLog.create({
        data: {
          action: current.recoveryCodeHash
            ? 'OWNER_RECOVERY_CODE_REPLACED'
            : 'OWNER_RECOVERY_CODE_CREATED',
          actorUserId: actor.id,
          entityId: actor.id,
          entityType: 'User',
        },
      });
    });
    return { configured: true, createdAt: createdAt.toISOString(), recoveryCode };
  }

  async recoverOwner(input: OwnerRecoveryInput): Promise<OwnerRecoveryResult> {
    const user = await this.database.user.findFirst({
      where: { email: input.email.trim().toLowerCase(), isActive: true, role: 'OWNER' },
    });
    const invalid = () =>
      new DomainError('AUTHENTICATION', t('domain.authentication.recoveryInvalid'));
    if (!user?.recoveryCodeHash) throw invalid();
    if (user.recoveryLockedUntil && user.recoveryLockedUntil.getTime() > Date.now())
      throw new DomainError('AUTHENTICATION', t('domain.authentication.recoveryLocked'));
    if (!(await verifyPassword(input.recoveryCode.trim().toUpperCase(), user.recoveryCodeHash))) {
      const attempts = user.recoveryFailedAttempts + 1;
      const lockedUntil =
        attempts >= SECURITY_CONFIG.maxRecoveryAttempts
          ? new Date(Date.now() + SECURITY_CONFIG.recoveryLockMinutes * 60_000)
          : null;
      await this.database.$transaction(async (transaction) => {
        await transaction.user.update({
          data: { recoveryFailedAttempts: attempts, recoveryLockedUntil: lockedUntil },
          where: { id: user.id },
        });
        await transaction.auditLog.create({
          data: {
            action: lockedUntil ? 'OWNER_RECOVERY_LOCKED' : 'OWNER_RECOVERY_FAILED',
            actorUserId: user.id,
            detail: JSON.stringify({ attempts }),
            entityId: user.id,
            entityType: 'User',
          },
        });
      });
      if (lockedUntil)
        throw new DomainError('AUTHENTICATION', t('domain.authentication.recoveryLocked'));
      throw invalid();
    }
    const recoveryCode = generateRecoveryCode();
    const passwordHash = await hashPassword(input.newPassword);
    const recoveryCodeHash = await hashPassword(recoveryCode);
    await this.database.$transaction(async (transaction) => {
      await transaction.user.update({
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          passwordHash,
          recoveryCodeCreatedAt: new Date(),
          recoveryCodeHash,
          recoveryFailedAttempts: 0,
          recoveryLockedUntil: null,
          securityVersion: { increment: 1 },
        },
        where: { id: user.id },
      });
      await transaction.session.deleteMany({ where: { userId: user.id } });
      await transaction.auditLog.create({
        data: {
          action: 'OWNER_RECOVERY_SUCCEEDED',
          actorUserId: user.id,
          entityId: user.id,
          entityType: 'User',
        },
      });
    });
    return { recoveryCode };
  }

  async listBranches(token: string, includeArchived = false): Promise<BranchSummary[]> {
    const actor = await this.authenticate(token);
    const ids = accessibleBranchIds(actor);
    const branches = await this.database.branch.findMany({
      orderBy: { name: 'asc' },
      where: {
        ...(includeArchived ? {} : { archivedAt: null, isActive: true }),
        ...(ids ? { id: { in: ids } } : {}),
      },
    });
    return branches.map(branchSummary);
  }

  async createBranch(token: string, input: BranchInput): Promise<BranchSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'branches:manage');
    const branch = await this.database.$transaction(async (transaction) => {
      const created = await transaction.branch.create({
        data: {
          address: input.address?.trim() ?? '',
          description: optionalValue(input.description),
          name: input.name.trim(),
          phone: input.phone ? normalizePhone(input.phone) : '',
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'BRANCH_CREATED',
          actorUserId: actor.id,
          entityId: created.id,
          entityType: 'Branch',
        },
      });
      return created;
    });
    return branchSummary(branch);
  }

  async updateBranch(token: string, id: string, input: BranchInput): Promise<BranchSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'branches:manage');
    await this.requireBranch(id);
    assertBranchAccess(actor, id);
    const branch = await this.database.$transaction(async (transaction) => {
      const updated = await transaction.branch.update({
        data: {
          address: input.address?.trim() ?? '',
          description: optionalValue(input.description),
          name: input.name.trim(),
          phone: input.phone ? normalizePhone(input.phone) : '',
        },
        where: { id },
      });
      await transaction.auditLog.create({
        data: {
          action: 'BRANCH_UPDATED',
          actorUserId: actor.id,
          entityId: id,
          entityType: 'Branch',
        },
      });
      return updated;
    });
    return branchSummary(branch);
  }

  async archiveBranch(token: string, id: string): Promise<BranchSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'branches:manage');
    await this.requireBranch(id);
    assertBranchAccess(actor, id);
    return branchSummary(
      await this.database.$transaction(async (transaction) => {
        const archived = await transaction.branch.update({
          data: { archivedAt: new Date(), isActive: false },
          where: { id },
        });
        await transaction.auditLog.create({
          data: {
            action: 'BRANCH_ARCHIVED',
            actorUserId: actor.id,
            entityId: id,
            entityType: 'Branch',
          },
        });
        return archived;
      }),
    );
  }

  async listStudents(token: string, query: StudentListQuery): Promise<StudentListResult> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'students:read');
    const branchIds = accessibleBranchIds(actor);
    if (query.branchId) assertBranchAccess(actor, query.branchId);

    const tokens = query.search?.split(/\s+/u).filter(Boolean) ?? [];
    const where: Prisma.StudentWhereInput = {
      AND: tokens.map((search) => ({
        OR: [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { middleName: { contains: search } },
          { phone: { contains: search } },
        ],
      })),
      ...(query.branchId
        ? { branchId: query.branchId }
        : branchIds
          ? { branchId: { in: branchIds } }
          : {}),
      ...(query.status ? { status: query.status } : { archivedAt: null }),
      ...(actor.role === 'COACH'
        ? {
            enrollments: {
              some: {
                group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] },
                leftAt: null,
                status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] },
              },
            },
          }
        : {}),
    };
    const orderBy: Prisma.StudentOrderByWithRelationInput[] =
      query.sortBy === 'name'
        ? [{ lastName: query.sortDirection }, { firstName: query.sortDirection }]
        : [{ [query.sortBy]: query.sortDirection }];
    const [total, students] = await this.database.$transaction([
      this.database.student.count({ where }),
      this.database.student.findMany({
        include: { branch: true },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        where,
      }),
    ]);
    return {
      items: students.map(studentSummary),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async getStudent(token: string, id: string): Promise<StudentDetail> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'students:read');
    const student = await this.database.student.findUnique({
      include: {
        attendance: {
          include: { lesson: { include: { group: { select: { name: true } } } } },
          orderBy: { markedAt: 'desc' },
          take: 30,
        },
        branch: true,
        contacts: { orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }] },
        enrollments: {
          include: {
            group: { select: { assistantCoachId: true, coachId: true, name: true } },
          },
          orderBy: { joinedAt: 'desc' },
        },
      },
      where: { id },
    });
    if (!student) throw new DomainError('NOT_FOUND', t('domain.notFound.student'));
    assertBranchAccess(actor, student.branchId);
    if (
      actor.role === 'COACH' &&
      !student.enrollments.some(
        ({ group, leftAt, status }) =>
          !leftAt &&
          status !== 'LEFT' &&
          (group.coachId === actor.id || group.assistantCoachId === actor.id),
      )
    )
      throw new DomainError('AUTHORIZATION', t('domain.authorization.groupCoach'));
    const activeGroupIds = student.enrollments
      .filter(({ leftAt, status }) => !leftAt && status !== 'LEFT')
      .map(({ groupId }) => groupId);
    const nextLesson = activeGroupIds.length
      ? await this.database.lesson.findFirst({
          include: { group: { select: { name: true } } },
          orderBy: { startsAt: 'asc' },
          where: {
            groupId: { in: activeGroupIds },
            startsAt: { gte: new Date() },
            status: 'PLANNED',
          },
        })
      : null;
    return {
      ...studentSummary(student),
      attendancePercentage: student.attendance.length
        ? Math.round(
            (student.attendance.filter(({ status }) => status === 'PRESENT' || status === 'LATE')
              .length /
              student.attendance.length) *
              100,
          )
        : 0,
      attendanceHistory: student.attendance.map(({ lesson, markedAt, status }) => ({
        groupName: lesson.group.name,
        lessonId: lesson.id,
        markedAt: markedAt.toISOString(),
        startsAt: lesson.startsAt.toISOString(),
        status,
      })),
      contacts: student.contacts.map(contactSummary),
      groups: student.enrollments.map(({ group, groupId, joinedAt, leftAt, status }) => ({
        groupId,
        groupName: group.name,
        joinedAt: joinedAt.toISOString().slice(0, 10),
        leftAt: leftAt?.toISOString().slice(0, 10),
        status,
      })),
      nextLesson: nextLesson
        ? {
            groupName: nextLesson.group.name,
            id: nextLesson.id,
            startsAt: nextLesson.startsAt.toISOString(),
          }
        : undefined,
    };
  }

  async createStudent(token: string, input: StudentInput): Promise<StudentSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'students:manage');
    assertBranchAccess(actor, input.branchId);
    await this.requireActiveBranch(input.branchId);
    const student = await this.database.student.create({
      data: studentData(input),
      include: { branch: true },
    });
    return studentSummary(student);
  }

  async updateStudent(token: string, id: string, input: StudentInput): Promise<StudentSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'students:manage');
    const current = await this.requireStudent(id);
    assertBranchAccess(actor, current.branchId);
    assertBranchAccess(actor, input.branchId);
    await this.requireActiveBranch(input.branchId);
    const data = studentData(input);
    const student = await this.database.student.update({
      data,
      include: { branch: true },
      where: { id },
    });
    return studentSummary(student);
  }

  async archiveStudent(token: string, id: string): Promise<StudentSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'students:manage');
    const current = await this.requireStudent(id);
    assertBranchAccess(actor, current.branchId);
    return studentSummary(
      await this.database.student.update({
        data: { archivedAt: new Date(), status: 'ARCHIVED' },
        include: { branch: true },
        where: { id },
      }),
    );
  }

  async createContact(
    token: string,
    studentId: string,
    input: StudentContactInput,
  ): Promise<StudentContactSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'contacts:manage');
    const student = await this.requireStudent(studentId);
    assertBranchAccess(actor, student.branchId);
    const contact = await this.database.$transaction(async (transaction) => {
      if (input.isPrimary) {
        await transaction.studentContact.updateMany({
          data: { isPrimary: false },
          where: { studentId },
        });
      }
      return transaction.studentContact.create({ data: { ...contactData(input), studentId } });
    });
    return contactSummary(contact);
  }

  async updateContact(
    token: string,
    id: string,
    input: StudentContactInput,
  ): Promise<StudentContactSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'contacts:manage');
    const current = await this.database.studentContact.findUnique({
      include: { student: { select: { branchId: true } } },
      where: { id },
    });
    if (!current) throw new DomainError('NOT_FOUND', t('domain.notFound.contact'));
    assertBranchAccess(actor, current.student.branchId);
    const contact = await this.database.$transaction(async (transaction) => {
      if (input.isPrimary) {
        await transaction.studentContact.updateMany({
          data: { isPrimary: false },
          where: { id: { not: id }, studentId: current.studentId },
        });
      }
      return transaction.studentContact.update({ data: contactData(input), where: { id } });
    });
    return contactSummary(contact);
  }

  async removeContact(token: string, id: string): Promise<void> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'contacts:manage');
    const contact = await this.database.studentContact.findUnique({
      include: { student: { select: { branchId: true } } },
      where: { id },
    });
    if (!contact) throw new DomainError('NOT_FOUND', t('domain.notFound.contact'));
    assertBranchAccess(actor, contact.student.branchId);
    await this.database.studentContact.delete({ where: { id } });
  }

  private async validateBranchAssignments(branchIds: string[]): Promise<void> {
    if (new Set(branchIds).size !== branchIds.length) {
      throw new DomainError('VALIDATION', t('domain.validation.assignmentsUnique'));
    }
    const count = await this.database.branch.count({
      where: { id: { in: branchIds }, isActive: true },
    });
    if (count !== branchIds.length) {
      throw new DomainError('VALIDATION', t('domain.validation.assignmentsInvalid'));
    }
  }

  private async requireManageableUser(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<UserWithBranches> {
    assertPermission(actor, 'users:manage');
    const target = await this.database.user.findUnique({
      include: { branchAssignments: { select: { branchId: true } } },
      where: { id },
    });
    if (!target) throw new DomainError('NOT_FOUND', t('domain.notFound.user'));
    if (actor.role === 'ADMIN') {
      if (target.role !== 'COACH')
        throw new DomainError('AUTHORIZATION', t('domain.authorization.userRoleManage'));
      for (const assignment of target.branchAssignments)
        assertBranchAccess(actor, assignment.branchId);
    }
    return target;
  }

  private async audit(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.database.auditLog.create({
      data: {
        action,
        actorUserId,
        detail: detail ? JSON.stringify(detail) : null,
        entityId,
        entityType,
      },
    });
  }

  private async requireBranch(id: string): Promise<Branch> {
    const branch = await this.database.branch.findUnique({ where: { id } });
    if (!branch) throw new DomainError('NOT_FOUND', t('domain.notFound.branch'));
    return branch;
  }

  private async requireActiveBranch(id: string): Promise<Branch> {
    const branch = await this.requireBranch(id);
    if (!branch.isActive)
      throw new DomainError('VALIDATION', t('domain.validation.branchArchived'));
    return branch;
  }

  private async requireStudent(id: string): Promise<Student> {
    const student = await this.database.student.findUnique({ where: { id } });
    if (!student) throw new DomainError('NOT_FOUND', t('domain.notFound.student'));
    return student;
  }
}

export function isBranchVisibleToUser(user: AuthenticatedUser, branchId: string): boolean {
  return canAccessBranch(user, branchId);
}
