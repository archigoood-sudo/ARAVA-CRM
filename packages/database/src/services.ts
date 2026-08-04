import type {
  AuthSession,
  AuthenticatedUser,
  BranchInput,
  BranchSummary,
  LoginCredentials,
  PasswordChangeInput,
  StudentContactInput,
  StudentContactSummary,
  StudentDetail,
  StudentInput,
  StudentListQuery,
  StudentListResult,
  StudentSummary,
  UserCreateInput,
  UserSummary,
  UserUpdateInput,
} from '@arava/shared';
import { t } from '@arava/shared';
import { Prisma, type Branch, type Student, type StudentContact, type User } from '@prisma/client';

import type { DatabaseClient } from './index';
import {
  accessibleBranchIds,
  assertBranchAccess,
  assertPermission,
  canAccessBranch,
} from './permissions';
import {
  createSessionToken,
  DomainError,
  hashPassword,
  hashSessionToken,
  normalizePhone,
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
    role: user.role,
  };
}

function userSummary(user: UserWithBranches): UserSummary {
  return {
    ...userSessionView(user),
    createdAt: user.createdAt.toISOString(),
    isActive: user.isActive,
    updatedAt: user.updatedAt.toISOString(),
  };
}

function branchSummary(branch: Branch): BranchSummary {
  return {
    address: branch.address,
    createdAt: branch.createdAt.toISOString(),
    description: branch.description ?? undefined,
    id: branch.id,
    isActive: branch.isActive,
    name: branch.name,
    phone: branch.phone,
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
    if (
      !user ||
      !user.isActive ||
      !(await verifyPassword(credentials.password, user.passwordHash))
    ) {
      throw new DomainError('AUTHENTICATION', t('domain.authentication.invalidCredentials'));
    }

    const token = createSessionToken();
    await this.database.session.create({
      data: {
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
        tokenHash: hashSessionToken(token),
        userId: user.id,
      },
    });
    return { token, user: userSessionView(user) };
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
    const updated = await this.database.user.update({
      data: { mustChangePassword: false, passwordHash },
      include: { branchAssignments: { select: { branchId: true } } },
      where: { id: actor.id },
    });
    return userSessionView(updated);
  }

  async authenticate(token: string, allowPasswordChange = false): Promise<AuthenticatedUser> {
    const session = await this.database.session.findUnique({
      include: {
        user: { include: { branchAssignments: { select: { branchId: true } } } },
      },
      where: { tokenHash: hashSessionToken(token) },
    });
    if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.isActive) {
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
    });
    return users.map(userSummary);
  }

  async createUser(token: string, input: UserCreateInput): Promise<UserSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'users:manage');
    if (actor.role === 'ADMIN' && input.role === 'OWNER') {
      throw new DomainError('AUTHORIZATION', t('domain.authorization.ownerCreate'));
    }
    await this.validateBranchAssignments(input.branchIds);
    try {
      const created = await this.database.user.create({
        data: {
          branchAssignments: { create: input.branchIds.map((branchId) => ({ branchId })) },
          email: input.email.trim().toLowerCase(),
          fullName: input.fullName.trim(),
          mustChangePassword: true,
          passwordHash: await hashPassword(input.password),
          role: input.role,
        },
        include: { branchAssignments: { select: { branchId: true } } },
      });
      return userSummary(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DomainError('CONFLICT', t('domain.conflict.userEmail'));
      }
      throw error;
    }
  }

  async updateUser(token: string, id: string, input: UserUpdateInput): Promise<UserSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'users:manage');
    const target = await this.database.user.findUnique({ where: { id } });
    if (!target) throw new DomainError('NOT_FOUND', t('domain.notFound.user'));
    if (actor.role === 'ADMIN' && (target.role === 'OWNER' || input.role === 'OWNER')) {
      throw new DomainError('AUTHORIZATION', t('domain.authorization.ownerManage'));
    }
    if (actor.id === id && (!input.isActive || input.role !== actor.role)) {
      throw new DomainError('VALIDATION', t('domain.validation.ownAccount'));
    }
    if (target.role === 'OWNER' && (input.role !== 'OWNER' || !input.isActive)) {
      const owners = await this.database.user.count({ where: { isActive: true, role: 'OWNER' } });
      if (owners <= 1) throw new DomainError('VALIDATION', t('domain.validation.lastOwner'));
    }
    await this.validateBranchAssignments(input.branchIds);
    const updated = await this.database.$transaction(async (transaction) => {
      await transaction.userBranch.deleteMany({ where: { userId: id } });
      await transaction.user.update({
        data: {
          branchAssignments: { create: input.branchIds.map((branchId) => ({ branchId })) },
          fullName: input.fullName.trim(),
          isActive: input.isActive,
          role: input.role,
          ...(input.isActive ? {} : { sessions: { deleteMany: {} } }),
        },
        where: { id },
      });
      return transaction.user.findUniqueOrThrow({
        include: { branchAssignments: { select: { branchId: true } } },
        where: { id },
      });
    });
    return userSummary(updated);
  }

  async listBranches(token: string, includeArchived = false): Promise<BranchSummary[]> {
    const actor = await this.authenticate(token);
    const ids = accessibleBranchIds(actor);
    const branches = await this.database.branch.findMany({
      orderBy: { name: 'asc' },
      where: {
        ...(includeArchived ? {} : { isActive: true }),
        ...(ids ? { id: { in: ids } } : {}),
      },
    });
    return branches.map(branchSummary);
  }

  async createBranch(token: string, input: BranchInput): Promise<BranchSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'branches:manage');
    const branch = await this.database.branch.create({
      data: {
        ...input,
        description: optionalValue(input.description),
        phone: normalizePhone(input.phone),
      },
    });
    return branchSummary(branch);
  }

  async updateBranch(token: string, id: string, input: BranchInput): Promise<BranchSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'branches:manage');
    await this.requireBranch(id);
    const branch = await this.database.branch.update({
      data: {
        ...input,
        description: optionalValue(input.description),
        phone: normalizePhone(input.phone),
      },
      where: { id },
    });
    return branchSummary(branch);
  }

  async archiveBranch(token: string, id: string): Promise<BranchSummary> {
    const actor = await this.authenticate(token);
    assertPermission(actor, 'branches:manage');
    await this.requireBranch(id);
    return branchSummary(
      await this.database.branch.update({ data: { isActive: false }, where: { id } }),
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
        branch: true,
        contacts: { orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }] },
      },
      where: { id },
    });
    if (!student) throw new DomainError('NOT_FOUND', t('domain.notFound.student'));
    assertBranchAccess(actor, student.branchId);
    return { ...studentSummary(student), contacts: student.contacts.map(contactSummary) };
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
