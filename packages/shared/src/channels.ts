export const USER_ROLES = ['OWNER', 'ADMIN', 'BRANCH_MANAGER', 'COACH'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const STUDENT_STATUSES = ['ACTIVE', 'TRIAL', 'FROZEN', 'LEFT', 'ARCHIVED'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const GENDERS = ['FEMALE', 'MALE', 'OTHER'] as const;
export type Gender = (typeof GENDERS)[number];

export const IPC_CHANNELS = {
  activityList: 'activity:list',
  authChangePassword: 'auth:change-password',
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authRestore: 'auth:restore',
  branchArchive: 'branch:archive',
  branchCreate: 'branch:create',
  branchList: 'branch:list',
  branchUpdate: 'branch:update',
  contactCreate: 'student-contact:create',
  contactRemove: 'student-contact:remove',
  contactUpdate: 'student-contact:update',
  dashboardStats: 'dashboard:stats',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  studentArchive: 'student:archive',
  studentCreate: 'student:create',
  studentGet: 'student:get',
  studentList: 'student:list',
  studentUpdate: 'student:update',
  systemInformation: 'system:information',
  userCreate: 'user:create',
  userList: 'user:list',
  userUpdate: 'user:update',
} as const;

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthenticatedUser {
  branchIds: string[];
  email: string;
  fullName: string;
  id: string;
  mustChangePassword: boolean;
  role: UserRole;
}

export interface AuthSession {
  token: string;
  user: AuthenticatedUser;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}

export interface UserSummary extends AuthenticatedUser {
  createdAt: string;
  isActive: boolean;
  updatedAt: string;
}

export interface UserCreateInput {
  branchIds: string[];
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
}

export interface UserUpdateInput {
  branchIds: string[];
  fullName: string;
  isActive: boolean;
  role: UserRole;
}

export interface BranchInput {
  address: string;
  description?: string | undefined;
  name: string;
  phone: string;
}

export interface BranchSummary extends BranchInput {
  createdAt: string;
  id: string;
  isActive: boolean;
  updatedAt: string;
}

export interface StudentInput {
  birthDate?: string | undefined;
  branchId: string;
  email?: string | undefined;
  firstName: string;
  gender?: Gender | undefined;
  lastName: string;
  middleName?: string | undefined;
  notes?: string | undefined;
  phone?: string | undefined;
  status: StudentStatus;
}

export type StudentSortField = 'name' | 'birthDate' | 'createdAt' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface StudentListQuery {
  branchId?: string | undefined;
  page: number;
  pageSize: number;
  search?: string | undefined;
  sortBy: StudentSortField;
  sortDirection: SortDirection;
  status?: StudentStatus | undefined;
}

export interface StudentSummary extends StudentInput {
  archivedAt?: string | undefined;
  branchName: string;
  createdAt: string;
  id: string;
  updatedAt: string;
}

export interface StudentListResult {
  items: StudentSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface StudentContactInput {
  email?: string | undefined;
  fullName: string;
  isPrimary: boolean;
  notes?: string | undefined;
  phone: string;
  relationship: string;
  secondaryPhone?: string | undefined;
  telegram?: string | undefined;
  whatsapp: boolean;
}

export interface StudentContactSummary extends StudentContactInput {
  createdAt: string;
  id: string;
  studentId: string;
  updatedAt: string;
}

export interface StudentDetail extends StudentSummary {
  contacts: StudentContactSummary[];
}

export interface DashboardStats {
  branches: number;
  students: number;
  trialStudents: number;
  users: number;
}

export interface ActivitySummary {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
}

export interface SystemInformation {
  appVersion: string;
  databasePath: string;
  platform: NodeJS.Platform;
}

export type SettingKey = 'appearance.theme' | 'general.workspaceName';

export interface SettingUpdate {
  key: SettingKey;
  value: string;
}

export interface AravaDesktopApi {
  activity: {
    list: (token: string) => Promise<ActivitySummary[]>;
  };
  auth: {
    changePassword: (token: string, input: PasswordChangeInput) => Promise<AuthenticatedUser>;
    login: (credentials: LoginCredentials) => Promise<AuthSession>;
    logout: (token: string) => Promise<void>;
    restore: (token: string) => Promise<AuthenticatedUser>;
  };
  branches: {
    archive: (token: string, id: string) => Promise<BranchSummary>;
    create: (token: string, input: BranchInput) => Promise<BranchSummary>;
    list: (token: string, includeArchived?: boolean) => Promise<BranchSummary[]>;
    update: (token: string, id: string, input: BranchInput) => Promise<BranchSummary>;
  };
  contacts: {
    create: (
      token: string,
      studentId: string,
      input: StudentContactInput,
    ) => Promise<StudentContactSummary>;
    remove: (token: string, id: string) => Promise<void>;
    update: (
      token: string,
      id: string,
      input: StudentContactInput,
    ) => Promise<StudentContactSummary>;
  };
  dashboard: {
    stats: (token: string) => Promise<DashboardStats>;
  };
  settings: {
    get: (token: string, key: SettingKey) => Promise<string | null>;
    set: (token: string, update: SettingUpdate) => Promise<void>;
  };
  students: {
    archive: (token: string, id: string) => Promise<StudentSummary>;
    create: (token: string, input: StudentInput) => Promise<StudentSummary>;
    get: (token: string, id: string) => Promise<StudentDetail>;
    list: (token: string, query: StudentListQuery) => Promise<StudentListResult>;
    update: (token: string, id: string, input: StudentInput) => Promise<StudentSummary>;
  };
  system: {
    information: (token: string) => Promise<SystemInformation>;
  };
  users: {
    create: (token: string, input: UserCreateInput) => Promise<UserSummary>;
    list: (token: string) => Promise<UserSummary[]>;
    update: (token: string, id: string, input: UserUpdateInput) => Promise<UserSummary>;
  };
}
