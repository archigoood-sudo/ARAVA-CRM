export const USER_ROLES = ['OWNER', 'ADMIN', 'BRANCH_MANAGER', 'COACH'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const STUDENT_STATUSES = ['ACTIVE', 'TRIAL', 'FROZEN', 'LEFT', 'ARCHIVED'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const GENDERS = ['FEMALE', 'MALE', 'OTHER'] as const;
export type Gender = (typeof GENDERS)[number];

export const GROUP_STATUSES = ['ACTIVE', 'RECRUITING', 'PAUSED', 'ARCHIVED'] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];
export const ENROLLMENT_STATUSES = ['ACTIVE', 'TRIAL', 'FROZEN', 'LEFT'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const LESSON_STATUSES = ['PLANNED', 'COMPLETED', 'CANCELLED'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED', 'LATE', 'TRIAL'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

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
  groupArchive: 'group:archive',
  groupCreate: 'group:create',
  groupGet: 'group:get',
  groupList: 'group:list',
  groupUpdate: 'group:update',
  enrollmentAdd: 'enrollment:add',
  enrollmentRemove: 'enrollment:remove',
  scheduleCreate: 'schedule:create',
  scheduleDeactivate: 'schedule:deactivate',
  scheduleList: 'schedule:list',
  scheduleUpdate: 'schedule:update',
  lessonCancel: 'lesson:cancel',
  lessonCreate: 'lesson:create',
  lessonGenerate: 'lesson:generate',
  lessonGet: 'lesson:get',
  lessonList: 'lesson:list',
  lessonUpdate: 'lesson:update',
  attendanceGet: 'attendance:get',
  attendanceSave: 'attendance:save',
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
  userStaffOptions: 'user:staff-options',
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
  attendancePercentage: number;
  attendanceHistory: StudentAttendanceHistory[];
  contacts: StudentContactSummary[];
  groups: StudentGroupMembership[];
}

export interface StaffOption {
  fullName: string;
  id: string;
  role: UserRole;
}

export interface GroupInput {
  ageFrom?: number | undefined;
  ageTo?: number | undefined;
  assistantCoachId?: string | undefined;
  branchId: string;
  capacity: number;
  coachId?: string | undefined;
  color?: string | undefined;
  description?: string | undefined;
  direction: string;
  name: string;
  status: GroupStatus;
}

export interface GroupListQuery {
  branchId?: string | undefined;
  coachId?: string | undefined;
  direction?: string | undefined;
  search?: string | undefined;
  status?: GroupStatus | undefined;
}

export interface GroupSummary extends GroupInput {
  archivedAt?: string | undefined;
  assistantCoachName?: string | undefined;
  attendancePercentage: number;
  availablePlaces: number;
  branchName: string;
  coachName?: string | undefined;
  createdAt: string;
  id: string;
  studentCount: number;
  updatedAt: string;
}

export interface EnrollmentInput {
  joinedAt: string;
  notes?: string | undefined;
  overrideCapacity: boolean;
  status: EnrollmentStatus;
  studentId: string;
}

export interface EnrollmentSummary {
  id: string;
  joinedAt: string;
  leftAt?: string | undefined;
  notes?: string | undefined;
  status: EnrollmentStatus;
  studentId: string;
  studentName: string;
  studentPhone?: string | undefined;
}

export interface StudentGroupMembership {
  groupId: string;
  groupName: string;
  joinedAt: string;
  leftAt?: string | undefined;
  status: EnrollmentStatus;
}

export interface GroupDetail extends GroupSummary {
  participants: EnrollmentSummary[];
  schedules: WeeklyScheduleSummary[];
  upcomingLessons: LessonSummary[];
}

export interface WeeklyScheduleInput {
  branchId: string;
  coachId?: string | undefined;
  endTime: string;
  groupId: string;
  isActive: boolean;
  room?: string | undefined;
  startTime: string;
  validFrom: string;
  validTo?: string | undefined;
  weekday: number;
}

export interface WeeklyScheduleQuery {
  branchId?: string | undefined;
  coachId?: string | undefined;
  groupId?: string | undefined;
  includeInactive?: boolean | undefined;
}

export interface WeeklyScheduleSummary extends WeeklyScheduleInput {
  branchName: string;
  coachName?: string | undefined;
  createdAt: string;
  groupName: string;
  id: string;
  updatedAt: string;
}

export interface LessonInput {
  coachId?: string | undefined;
  endsAt: string;
  groupId: string;
  notes?: string | undefined;
  room?: string | undefined;
  startsAt: string;
}

export interface LessonListQuery {
  branchId?: string | undefined;
  coachId?: string | undefined;
  dateFrom: string;
  dateTo: string;
  groupId?: string | undefined;
}

export interface LessonSummary {
  attendanceExpected: number;
  attendanceMarked: number;
  branchId: string;
  branchName: string;
  cancellationReason?: string | undefined;
  coachId?: string | undefined;
  coachName?: string | undefined;
  endsAt: string;
  groupId: string;
  groupName: string;
  id: string;
  notes?: string | undefined;
  room?: string | undefined;
  startsAt: string;
  status: LessonStatus;
}

export interface LessonGenerateInput {
  dateFrom: string;
  dateTo: string;
}

export interface LessonGenerationResult {
  created: number;
  skipped: number;
}

export interface LessonCancelInput {
  cancellationReason: string;
}

export interface AttendanceEntryInput {
  comment?: string | undefined;
  status: AttendanceStatus;
  studentId: string;
}

export interface AttendanceParticipant {
  comment?: string | undefined;
  markedAt?: string | undefined;
  status?: AttendanceStatus | undefined;
  studentId: string;
  studentName: string;
}

export interface AttendanceLessonDetail {
  lesson: LessonSummary;
  participants: AttendanceParticipant[];
}

export interface StudentAttendanceHistory {
  groupName: string;
  lessonId: string;
  markedAt: string;
  startsAt: string;
  status: AttendanceStatus;
}

export interface DashboardStats {
  activeGroups: number;
  attendanceMarked: number;
  attendanceUnmarked: number;
  branches: number;
  expectedToday: number;
  groupsWithPlaces: number;
  lessonsToday: number;
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
  groups: {
    addEnrollment: (
      token: string,
      groupId: string,
      input: EnrollmentInput,
    ) => Promise<EnrollmentSummary>;
    archive: (token: string, id: string) => Promise<GroupSummary>;
    create: (token: string, input: GroupInput) => Promise<GroupSummary>;
    get: (token: string, id: string) => Promise<GroupDetail>;
    list: (token: string, query: GroupListQuery) => Promise<GroupSummary[]>;
    removeEnrollment: (token: string, groupId: string, enrollmentId: string) => Promise<void>;
    update: (token: string, id: string, input: GroupInput) => Promise<GroupSummary>;
  };
  schedules: {
    create: (token: string, input: WeeklyScheduleInput) => Promise<WeeklyScheduleSummary>;
    deactivate: (token: string, id: string) => Promise<WeeklyScheduleSummary>;
    list: (token: string, query: WeeklyScheduleQuery) => Promise<WeeklyScheduleSummary[]>;
    update: (
      token: string,
      id: string,
      input: WeeklyScheduleInput,
    ) => Promise<WeeklyScheduleSummary>;
  };
  lessons: {
    cancel: (token: string, id: string, input: LessonCancelInput) => Promise<LessonSummary>;
    create: (token: string, input: LessonInput) => Promise<LessonSummary>;
    generate: (token: string, input: LessonGenerateInput) => Promise<LessonGenerationResult>;
    get: (token: string, id: string) => Promise<LessonSummary>;
    list: (token: string, query: LessonListQuery) => Promise<LessonSummary[]>;
    update: (token: string, id: string, input: LessonInput) => Promise<LessonSummary>;
  };
  attendance: {
    get: (token: string, lessonId: string) => Promise<AttendanceLessonDetail>;
    save: (
      token: string,
      lessonId: string,
      entries: AttendanceEntryInput[],
    ) => Promise<AttendanceLessonDetail>;
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
    staffOptions: (token: string) => Promise<StaffOption[]>;
    update: (token: string, id: string, input: UserUpdateInput) => Promise<UserSummary>;
  };
}
