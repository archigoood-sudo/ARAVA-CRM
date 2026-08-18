import type { PermissionSet } from './permissions';

export const USER_ROLES = ['OWNER', 'ADMIN', 'COACH'] as const;
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
export const TARIFF_TYPES = ['LESSON_PACK', 'UNLIMITED', 'SINGLE_LESSON', 'TRIAL'] as const;
export type TariffType = (typeof TARIFF_TYPES)[number];
export const SUBSCRIPTION_STATUSES = [
  'ACTIVE',
  'PENDING',
  'EXPIRED',
  'FROZEN',
  'CANCELLED',
  'USED_UP',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_STATUSES = [
  'COMPLETED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CANCELLED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const LEDGER_OPERATION_TYPES = [
  'PURCHASE',
  'LESSON_WRITE_OFF',
  'REVERSAL',
  'MANUAL_ADJUSTMENT',
  'FREEZE',
  'UNFREEZE',
] as const;
export type LedgerOperationType = (typeof LEDGER_OPERATION_TYPES)[number];
export const EXPENSE_PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'OTHER'] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];
export const EXPENSE_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const CASH_REGISTER_TYPES = ['CASH', 'BANK', 'ONLINE'] as const;
export type CashRegisterType = (typeof CASH_REGISTER_TYPES)[number];
export const CASH_TRANSACTION_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER', 'CORRECTION'] as const;
export type CashTransactionType = (typeof CASH_TRANSACTION_TYPES)[number];
export const CASH_TRANSACTION_SOURCES = [
  'PAYMENT',
  'REFUND',
  'EXPENSE',
  'PAYROLL',
  'MANUAL',
] as const;
export type CashTransactionSource = (typeof CASH_TRANSACTION_SOURCES)[number];
export const PAYROLL_TYPES = [
  'FIXED_PER_LESSON',
  'PER_ATTENDEE',
  'PERCENT_OF_REVENUE',
  'FIXED_MONTHLY',
  'COMBINED',
] as const;
export type PayrollType = (typeof PAYROLL_TYPES)[number];
export const PAYROLL_PERIOD_STATUSES = [
  'DRAFT',
  'CALCULATED',
  'APPROVED',
  'PAID',
  'CANCELLED',
] as const;
export type PayrollPeriodStatus = (typeof PAYROLL_PERIOD_STATUSES)[number];
export const ROOM_RENTAL_STATUSES = ['ACTIVE', 'CANCELLED', 'ARCHIVED'] as const;
export type RoomRentalStatus = (typeof ROOM_RENTAL_STATUSES)[number];
export const CALENDAR_EXCEPTION_TYPES = ['DAY_OFF', 'HOLIDAY', 'VACATION', 'CUSTOM'] as const;
export type CalendarExceptionType = (typeof CALENDAR_EXCEPTION_TYPES)[number];
export const MEMBERSHIP_CARD_STATUSES = [
  'FREE',
  'ASSIGNED',
  'BLOCKED',
  'LOST',
  'ARCHIVED',
] as const;
export type MembershipCardStatus = (typeof MEMBERSHIP_CARD_STATUSES)[number];
export const CARD_EVENT_TYPES = [
  'REGISTERED',
  'ASSIGNED',
  'UNASSIGNED',
  'BLOCKED',
  'MARKED_LOST',
  'REACTIVATED',
  'REPLACED',
  'ARCHIVED',
  'SCANNED',
] as const;
export type CardEventType = (typeof CARD_EVENT_TYPES)[number];
export const CARD_SCAN_RESULTS = [
  'OPENED',
  'FREE',
  'UNKNOWN',
  'BLOCKED',
  'LOST',
  'ARCHIVED',
  'ACCESS_DENIED',
] as const;
export type CardScanResult = (typeof CARD_SCAN_RESULTS)[number];
export const REPORT_KINDS = [
  'CASH_FLOW',
  'INCOME_EXPENSES',
  'PROFIT_BY_BRANCH',
  'PAYROLL_BY_COACH',
  'ATTENDANCE_BY_GROUP',
  'SUBSCRIPTIONS_DEBTS',
  'GROUP_OCCUPANCY',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const GLOBAL_SEARCH_TYPES = [
  'STUDENT',
  'GROUP',
  'TRAINER',
  'BRANCH',
  'ROOM',
  'CARD',
] as const;
export type GlobalSearchType = (typeof GLOBAL_SEARCH_TYPES)[number];

export const IPC_CHANNELS = {
  activityList: 'activity:list',
  auditList: 'audit:list',
  authChangePassword: 'auth:change-password',
  authCompletePasswordChange: 'auth:complete-password-change',
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authRecoverOwner: 'auth:recover-owner',
  authRestore: 'auth:restore',
  branchArchive: 'branch:archive',
  branchCreate: 'branch:create',
  branchList: 'branch:list',
  branchUpdate: 'branch:update',
  roomArchive: 'room:archive',
  roomCreate: 'room:create',
  roomList: 'room:list',
  roomUpdate: 'room:update',
  roomAvailability: 'room:availability',
  roomUtilization: 'room:utilization',
  rentalCancel: 'rental:cancel',
  rentalCreate: 'rental:create',
  rentalList: 'rental:list',
  rentalUpdate: 'rental:update',
  closureCreate: 'closure:create',
  closureList: 'closure:list',
  closurePreview: 'closure:preview',
  calendarExceptionCreate: 'calendar-exception:create',
  calendarExceptionList: 'calendar-exception:list',
  cardArchive: 'card:archive',
  cardAssign: 'card:assign',
  cardBlock: 'card:block',
  cardFind: 'card:find',
  cardHistory: 'card:history',
  cardList: 'card:list',
  cardMarkLost: 'card:mark-lost',
  cardReactivate: 'card:reactivate',
  cardRegister: 'card:register',
  cardReplace: 'card:replace',
  cardResolveScan: 'card:resolve-scan',
  cardScanHistory: 'card:scan-history',
  cardStudentCurrent: 'card:student-current',
  cardUnassign: 'card:unassign',
  customerDisplayClose: 'customer-display:close',
  customerDisplayDeleteSlide: 'customer-display:delete-slide',
  customerDisplayGetState: 'customer-display:get-state',
  customerDisplayGetStatus: 'customer-display:get-status',
  customerDisplayMoveSlide: 'customer-display:move-slide',
  customerDisplayOpen: 'customer-display:open',
  customerDisplayPreview: 'customer-display:preview',
  customerDisplayReturnToPromo: 'customer-display:return-to-promo',
  customerDisplaySaveSlide: 'customer-display:save-slide',
  customerDisplaySelectImage: 'customer-display:select-image',
  customerDisplayStateChanged: 'customer-display:state-changed',
  customerDisplayUpdateSettings: 'customer-display:update-settings',
  lessonCopyDay: 'lesson:copy-day',
  substitutionAssign: 'substitution:assign',
  contactCreate: 'student-contact:create',
  contactRemove: 'student-contact:remove',
  contactUpdate: 'student-contact:update',
  dashboardStats: 'dashboard:stats',
  attentionList: 'attention:list',
  attentionSummary: 'attention:summary',
  backupCreate: 'backup:create',
  backupExport: 'backup:export',
  backupList: 'backup:list',
  backupOpenFolder: 'backup:open-folder',
  backupSelectFolder: 'backup:select-folder',
  backupSelectManaged: 'backup:select-managed',
  backupSelectRestoreFile: 'backup:select-restore-file',
  backupSetAutomatic: 'backup:set-automatic',
  backupStatus: 'backup:status',
  backupRestore: 'backup:restore',
  backupValidate: 'backup:validate',
  groupArchive: 'group:archive',
  groupCreate: 'group:create',
  groupGet: 'group:get',
  groupList: 'group:list',
  groupUpdate: 'group:update',
  globalSearch: 'global-search:query',
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
  tariffArchive: 'tariff:archive',
  tariffCreate: 'tariff:create',
  tariffGet: 'tariff:get',
  tariffList: 'tariff:list',
  tariffUpdate: 'tariff:update',
  subscriptionAdjust: 'subscription:adjust',
  subscriptionCancel: 'subscription:cancel',
  subscriptionCreate: 'subscription:create',
  subscriptionFreeze: 'subscription:freeze',
  subscriptionGet: 'subscription:get',
  subscriptionListStudent: 'subscription:list-student',
  subscriptionUnfreeze: 'subscription:unfreeze',
  paymentCancel: 'payment:cancel',
  paymentCreate: 'payment:create',
  paymentGet: 'payment:get',
  paymentList: 'payment:list',
  refundCreate: 'refund:create',
  financeEmployees: 'finance:employees',
  financeStats: 'finance:stats',
  expenseCategoryArchive: 'expense-category:archive',
  expenseCategoryCreate: 'expense-category:create',
  expenseCategoryList: 'expense-category:list',
  expenseCategoryUpdate: 'expense-category:update',
  expenseCancel: 'expense:cancel',
  expenseConfirm: 'expense:confirm',
  expenseCreate: 'expense:create',
  expenseList: 'expense:list',
  expenseUpdate: 'expense:update',
  cashRegisterCreate: 'cash-register:create',
  cashRegisterList: 'cash-register:list',
  cashRegisterUpdate: 'cash-register:update',
  cashTransactionList: 'cash-transaction:list',
  cashCorrectionCreate: 'cash-transaction:correction',
  cashTransferCreate: 'cash-transaction:transfer',
  payrollRuleCreate: 'payroll-rule:create',
  payrollRuleList: 'payroll-rule:list',
  payrollRuleUpdate: 'payroll-rule:update',
  payrollPeriodApprove: 'payroll-period:approve',
  payrollPeriodCalculate: 'payroll-period:calculate',
  payrollPeriodCreate: 'payroll-period:create',
  payrollPeriodGet: 'payroll-period:get',
  payrollPeriodList: 'payroll-period:list',
  payrollPeriodPay: 'payroll-period:pay',
  payrollAccrualAdjust: 'payroll-accrual:adjust',
  payrollCoachView: 'payroll:coach-view',
  analyticsGet: 'analytics:get',
  reportGet: 'report:get',
  reportExportCsv: 'report:export-csv',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  studentArchive: 'student:archive',
  studentCreate: 'student:create',
  studentGet: 'student:get',
  studentProfileGet: 'student-profile:get',
  studentNoteCreate: 'student-note:create',
  studentNoteUpdate: 'student-note:update',
  studentNoteArchive: 'student-note:archive',
  studentList: 'student:list',
  studentUpdate: 'student:update',
  systemInformation: 'system:information',
  userCreate: 'user:create',
  userList: 'user:list',
  userRecoveryCodeCreate: 'user:recovery-code-create',
  userRecoveryCodeStatus: 'user:recovery-code-status',
  userResetPassword: 'user:reset-password',
  userRevokeSessions: 'user:revoke-sessions',
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
  permissions: PermissionSet;
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

export interface ForcedPasswordChangeInput {
  newPassword: string;
}

export interface OwnerRecoveryInput {
  email: string;
  recoveryCode: string;
  newPassword: string;
}

export interface OwnerRecoveryResult {
  recoveryCode: string;
}

export interface UserSummary extends AuthenticatedUser {
  createdAt: string;
  isActive: boolean;
  lastLoginAt?: string | undefined;
  lockedUntil?: string | undefined;
  phone?: string | undefined;
  updatedAt: string;
}

export interface UserCreateInput {
  branchIds: string[];
  email: string;
  fullName: string;
  /** Used only by trusted test/bootstrap callers. Desktop IPC always generates this value. */
  password?: string | undefined;
  phone?: string | undefined;
  role: UserRole;
}

export interface UserUpdateInput {
  branchIds: string[];
  fullName: string;
  isActive: boolean;
  phone?: string | undefined;
  role: UserRole;
}

export interface TemporaryPasswordResult {
  temporaryPassword: string;
  user: UserSummary;
}

export interface RecoveryCodeStatus {
  configured: boolean;
  createdAt?: string | undefined;
}

export interface RecoveryCodeResult extends RecoveryCodeStatus {
  recoveryCode: string;
}

export interface BranchInput {
  address?: string | undefined;
  description?: string | undefined;
  name: string;
  phone?: string | undefined;
}

export interface BranchSummary extends BranchInput {
  archivedAt?: string | undefined;
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
  nextLesson?:
    | {
        groupName: string;
        id: string;
        startsAt: string;
      }
    | undefined;
}

export interface StudentNoteInput {
  text: string;
}

export interface StudentProfileNote {
  archivedAt?: string | undefined;
  authorName: string;
  authorUserId: string;
  createdAt: string;
  id: string;
  text: string;
  updatedAt: string;
}

export interface StudentProfileGroup {
  branchName: string;
  coachName?: string | undefined;
  direction: string;
  enrollmentId: string;
  groupId: string;
  groupName: string;
  joinedAt: string;
  membershipStatus: EnrollmentStatus;
  roomName?: string | undefined;
  scheduleSummary: string[];
}

export interface StudentProfileLesson {
  branchName: string;
  coachName?: string | undefined;
  endsAt: string;
  groupName: string;
  id: string;
  roomName?: string | undefined;
  startsAt: string;
}

export interface StudentProfileSubscription {
  debt: number;
  expiresAt?: string | undefined;
  frozen: boolean;
  id: string;
  lessonLimit?: number | undefined;
  lessonsUsed: number;
  purchasedAt: string;
  remainingLessons?: number | undefined;
  startsAt: string;
  status: SubscriptionStatus;
  tariffName: string;
}

export interface StudentProfilePayment {
  amount: number;
  id: string;
  method: PaymentMethod;
  paidAt: string;
  refundedAmount: number;
  status: PaymentStatus;
}

export interface StudentProfileCard {
  barcode: string;
  id: string;
  issuedAt?: string | undefined;
  lastScannedAt?: string | undefined;
  status: MembershipCardStatus;
}

export interface StudentProfileActivity {
  action: string;
  actorName: string;
  createdAt: string;
  id: string;
  title: string;
}

export interface StudentProfileWarning {
  code: 'CARD_PROBLEM' | 'DEBT' | 'EXPIRING' | 'LOW_BALANCE' | 'NO_GROUP' | 'NO_SUBSCRIPTION';
  message: string;
  tone: 'danger' | 'warning';
}

export interface StudentProfileOverview {
  access: 'ADMIN' | 'TRAINER';
  attendance: {
    attended: number;
    missed: number;
    percentage: number;
    recent: StudentAttendanceHistory[];
  };
  card?: StudentProfileCard | undefined;
  contacts: StudentContactSummary[];
  currentSubscription?: StudentProfileSubscription | undefined;
  groups: StudentProfileGroup[];
  history: StudentProfileActivity[];
  notes: StudentProfileNote[];
  recentPayments: StudentProfilePayment[];
  student: StudentDetail;
  totalDebt?: number | undefined;
  upcomingLessons: StudentProfileLesson[];
  warnings: StudentProfileWarning[];
}

export type CardSortField = 'barcode' | 'createdAt' | 'lastScan';

export interface CardListQuery {
  branchId?: string | undefined;
  page: number;
  pageSize: number;
  search?: string | undefined;
  sortBy: CardSortField;
  sortDirection: SortDirection;
  status?: MembershipCardStatus | undefined;
}

export interface CardRegisterInput {
  barcode: string;
  notes?: string | undefined;
}

export interface CardAssignInput {
  barcode: string;
  notes?: string | undefined;
  registerIfUnknown: boolean;
  studentId: string;
}

export interface CardReplaceInput {
  comment?: string | undefined;
  newBarcode: string;
  oldCardId: string;
  oldCardStatus: 'BLOCKED' | 'LOST';
  registerIfUnknown: boolean;
  studentId: string;
}

export interface CardActionInput {
  comment?: string | undefined;
}

export interface MembershipCardSummary {
  archivedAt?: string | undefined;
  barcode: string;
  blockedAt?: string | undefined;
  branchId?: string | undefined;
  branchName?: string | undefined;
  createdAt: string;
  id: string;
  issuedAt?: string | undefined;
  lastScanAt?: string | undefined;
  notes?: string | undefined;
  status: MembershipCardStatus;
  studentId?: string | undefined;
  studentName?: string | undefined;
  unassignedAt?: string | undefined;
  updatedAt: string;
}

export interface CardListResult {
  items: MembershipCardSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CardHistorySummary {
  comment?: string | undefined;
  eventType: CardEventType;
  id: string;
  occurredAt: string;
  performedByName?: string | undefined;
  relatedCardId?: string | undefined;
  relatedCardBarcode?: string | undefined;
  studentId?: string | undefined;
  studentName?: string | undefined;
}

export interface CardScanHistorySummary {
  barcode: string;
  cardId?: string | undefined;
  id: string;
  occurredAt: string;
  performedByName?: string | undefined;
  result: CardScanResult;
  studentId?: string | undefined;
}

export interface CardScanResolution {
  barcode: string;
  card?: MembershipCardSummary | undefined;
  result: CardScanResult;
  studentId?: string | undefined;
  studentName?: string | undefined;
}

export interface TariffInput {
  branchId?: string | undefined;
  currency: string;
  description?: string | undefined;
  freezeDays?: number | undefined;
  isActive: boolean;
  lessonCount?: number | undefined;
  name: string;
  price: number;
  type: TariffType;
  validityDays?: number | undefined;
}

export interface TariffListQuery {
  branchId?: string | undefined;
  includeArchived?: boolean | undefined;
  search?: string | undefined;
  type?: TariffType | undefined;
}

export interface TariffSummary extends TariffInput {
  archivedAt?: string | undefined;
  branchName?: string | undefined;
  createdAt: string;
  id: string;
  updatedAt: string;
}

export interface InitialPaymentInput {
  amount: number;
  comment?: string | undefined;
  paidAt: string;
  paymentMethod: PaymentMethod;
}

export interface SubscriptionCreateInput {
  initialPayment?: InitialPaymentInput | undefined;
  notes?: string | undefined;
  salePrice: number;
  startsAt: string;
  studentId: string;
  tariffId: string;
}

export interface SubscriptionFreezeInput {
  days: number;
}

export interface SubscriptionAdjustmentInput {
  comment: string;
  lessonDelta: number;
}

export interface SubscriptionSummary {
  branchId: string;
  branchName: string;
  createdAt: string;
  currency: string;
  debt: number;
  expiresAt?: string | undefined;
  freezeEndsAt?: string | undefined;
  freezeStartedAt?: string | undefined;
  frozenDaysUsed: number;
  id: string;
  lessonLimit?: number | undefined;
  lessonsUsed: number;
  lowBalance: boolean;
  notes?: string | undefined;
  paidAmount: number;
  purchasedAt: string;
  remainingLessons?: number | undefined;
  salePrice: number;
  startsAt: string;
  status: SubscriptionStatus;
  studentId: string;
  studentName: string;
  tariffId: string;
  tariffName: string;
  tariffType: TariffType;
  updatedAt: string;
  expiringSoon: boolean;
}

export interface LedgerEntrySummary {
  amountDelta?: number | undefined;
  attendanceId?: string | undefined;
  comment?: string | undefined;
  createdAt: string;
  createdByName?: string | undefined;
  id: string;
  lessonDelta: number;
  lessonId?: string | undefined;
  reversesLedgerId?: string | undefined;
  type: LedgerOperationType;
}

export interface SubscriptionDetail extends SubscriptionSummary {
  ledger: LedgerEntrySummary[];
  payments: PaymentSummary[];
}

export interface StudentFinanceSummary {
  activeSubscriptions: number;
  expiringSoon: number;
  lowBalance: number;
  subscriptions: SubscriptionSummary[];
  totalDebt: number;
}

export interface PaymentInput {
  amount: number;
  branchId: string;
  comment?: string | undefined;
  externalReference?: string | undefined;
  paidAt: string;
  paymentMethod: PaymentMethod;
  studentId: string;
  subscriptionId?: string | undefined;
}

export interface PaymentListQuery {
  branchId?: string | undefined;
  createdByUserId?: string | undefined;
  dateFrom: string;
  dateTo: string;
  paymentMethod?: PaymentMethod | undefined;
  search?: string | undefined;
  status?: PaymentStatus | undefined;
}

export interface RefundInput {
  amount: number;
  reason: string;
  refundedAt: string;
}

export interface RefundSummary extends RefundInput {
  createdAt: string;
  createdByName: string;
  id: string;
  paymentId: string;
}

export interface PaymentSummary extends PaymentInput {
  branchName: string;
  createdAt: string;
  createdByName: string;
  id: string;
  netAmount: number;
  refundedAmount: number;
  status: PaymentStatus;
  studentName: string;
  studentPhone?: string | undefined;
  subscriptionName?: string | undefined;
  updatedAt: string;
}

export interface PaymentDetail extends PaymentSummary {
  refunds: RefundSummary[];
}

export interface FinanceStats {
  methodBreakdown: { amount: number; method: PaymentMethod }[];
  outstandingDebt: number;
  revenueThisMonth: number;
  revenueToday: number;
}

export interface ExpenseCategoryInput {
  branchId?: string | undefined;
  description?: string | undefined;
  isActive: boolean;
  name: string;
}

export interface ExpenseCategorySummary extends ExpenseCategoryInput {
  archivedAt?: string | undefined;
  branchName?: string | undefined;
  createdAt: string;
  id: string;
  updatedAt: string;
}

export interface ExpenseInput {
  amount: number;
  attachmentPath?: string | undefined;
  branchId: string;
  cashRegisterId?: string | undefined;
  categoryId: string;
  description: string;
  documentNumber?: string | undefined;
  paymentMethod: ExpensePaymentMethod;
  spentAt: string;
  vendor?: string | undefined;
}

export interface ExpenseListQuery {
  branchId?: string | undefined;
  categoryId?: string | undefined;
  createdByUserId?: string | undefined;
  dateFrom: string;
  dateTo: string;
  paymentMethod?: ExpensePaymentMethod | undefined;
  search?: string | undefined;
  status?: ExpenseStatus | undefined;
}

export interface ExpenseSummary extends Omit<ExpenseInput, 'cashRegisterId'> {
  branchName: string;
  categoryName: string;
  confirmedByName?: string | undefined;
  createdAt: string;
  createdByName: string;
  id: string;
  status: ExpenseStatus;
  updatedAt: string;
}

export interface CashRegisterInput {
  branchId: string;
  isActive: boolean;
  name: string;
  openingBalance: number;
  type: CashRegisterType;
}

export interface CashRegisterSummary extends CashRegisterInput {
  balance: number;
  branchName: string;
  createdAt: string;
  id: string;
  updatedAt: string;
}

export interface CashTransactionQuery {
  branchId?: string | undefined;
  cashRegisterId?: string | undefined;
  dateFrom: string;
  dateTo: string;
}

export interface CashTransactionSummary {
  amount: number;
  branchId: string;
  cashRegisterId: string;
  cashRegisterName: string;
  comment?: string | undefined;
  createdAt: string;
  createdByName: string;
  id: string;
  occurredAt: string;
  sourceId?: string | undefined;
  sourceType: CashTransactionSource;
  type: CashTransactionType;
}

export interface CashCorrectionInput {
  amount: number;
  cashRegisterId: string;
  occurredAt: string;
  reason: string;
}

export interface CashTransferInput {
  amount: number;
  fromCashRegisterId: string;
  occurredAt: string;
  reason: string;
  toCashRegisterId: string;
}

export interface PayrollRuleInput {
  amountPerAttendee?: number | undefined;
  branchId: string;
  coachId: string;
  fixedAmount?: number | undefined;
  groupId?: string | undefined;
  isActive: boolean;
  monthlyAmount?: number | undefined;
  percent?: number | undefined;
  type: PayrollType;
  validFrom: string;
  validTo?: string | undefined;
}

export interface PayrollRuleSummary extends PayrollRuleInput {
  branchName: string;
  coachName: string;
  createdAt: string;
  groupName?: string | undefined;
  id: string;
  updatedAt: string;
}

export interface PayrollPeriodInput {
  branchId?: string | undefined;
  dateFrom: string;
  dateTo: string;
}

export interface PayrollAdjustmentInput {
  amount: number;
  reason: string;
}

export interface PayrollPaymentInput {
  cashRegisterId: string;
  occurredAt: string;
}

export interface PayrollAccrualSummary {
  attendeeCount?: number | undefined;
  baseAmount: number;
  branchId: string;
  branchName: string;
  calculatedAmount: number;
  coachId: string;
  coachName: string;
  comment?: string | undefined;
  finalAmount: number;
  groupId?: string | undefined;
  groupName?: string | undefined;
  id: string;
  lessonId?: string | undefined;
  lessonStartsAt?: string | undefined;
  manualAdjustment: number;
  revenueBase?: number | undefined;
  type: PayrollType;
}

export interface PayrollPendingLessonSummary {
  branchId: string;
  branchName: string;
  coachId: string;
  coachName: string;
  groupId: string;
  groupName: string;
  lessonId: string;
  startsAt: string;
}

export interface PayrollPeriodSummary extends PayrollPeriodInput {
  approvedByName?: string | undefined;
  createdAt: string;
  createdByName: string;
  id: string;
  status: PayrollPeriodStatus;
  totalAmount: number;
  updatedAt: string;
}

export interface PayrollPeriodDetail extends PayrollPeriodSummary {
  accruals: PayrollAccrualSummary[];
  pendingAttendance: PayrollPendingLessonSummary[];
}

export interface GlobalSearchResult {
  id: string;
  metadata?: Record<string, string> | undefined;
  route: string;
  subtitle?: string | undefined;
  title: string;
  type: GlobalSearchType;
}

export interface AnalyticsQuery {
  branchId?: string | undefined;
  coachId?: string | undefined;
  dateFrom: string;
  dateTo: string;
  direction?: string | undefined;
  groupId?: string | undefined;
}

export interface AnalyticsMetric {
  changePercent?: number | undefined;
  current: number;
  previous: number;
}

export interface AnalyticsBreakdownRow {
  attendancePercentage: number;
  coachWorkload: number;
  expenses: number;
  groupOccupancy: number;
  id: string;
  label: string;
  netProfit: number;
  revenue: number;
}

export interface ManagementAnalytics {
  activeStudents: AnalyticsMetric;
  attendancePercentage: AnalyticsMetric;
  averagePayment: AnalyticsMetric;
  breakdown: AnalyticsBreakdownRow[];
  churnedStudents: AnalyticsMetric;
  coachWorkload: AnalyticsMetric;
  expenses: AnalyticsMetric;
  groupOccupancy: AnalyticsMetric;
  netProfit: AnalyticsMetric;
  newStudents: AnalyticsMetric;
  outstandingDebt: AnalyticsMetric;
  payrollAccrued: AnalyticsMetric;
  profitBeforePayroll: AnalyticsMetric;
  revenue: AnalyticsMetric;
}

export interface ReportQuery extends AnalyticsQuery {
  kind: ReportKind;
}

export interface ReportData {
  headers: string[];
  kind: ReportKind;
  rows: (string | number)[][];
  title: string;
}

export interface CsvExport {
  content: string;
  filename: string;
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
  roomId?: string | undefined;
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
  roomId?: string | undefined;
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
  roomId?: string | undefined;
  startsAt: string;
}

export interface LessonListQuery {
  branchId?: string | undefined;
  coachId?: string | undefined;
  dateFrom: string;
  dateTo: string;
  groupId?: string | undefined;
  roomId?: string | undefined;
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
  roomId?: string | undefined;
  roomName?: string | undefined;
  originalCoachId?: string | undefined;
  originalCoachName?: string | undefined;
  substituteCoachId?: string | undefined;
  substituteCoachName?: string | undefined;
  startsAt: string;
  status: LessonStatus;
}

export interface RoomInput {
  areaSquareMeters?: number | undefined;
  branchId: string;
  capacity?: number | undefined;
  colorKey?: string | undefined;
  description?: string | undefined;
  floor?: string | undefined;
  isActive: boolean;
  name: string;
  sortOrder: number;
}

export interface RoomSummary extends RoomInput {
  archivedAt?: string | undefined;
  branchName: string;
  createdAt: string;
  id: string;
  nextEvent?: string | undefined;
  updatedAt: string;
}

export interface CalendarRangeQuery {
  branchId?: string | undefined;
  dateFrom: string;
  dateTo: string;
  roomId?: string | undefined;
}

export interface RoomRentalInput {
  amount?: number | undefined;
  branchId: string;
  clientName?: string | undefined;
  comment?: string | undefined;
  endAt: string;
  phone?: string | undefined;
  roomId: string;
  startAt: string;
}

export interface RoomRentalSummary extends RoomRentalInput {
  branchName: string;
  createdAt: string;
  id: string;
  roomName: string;
  status: RoomRentalStatus;
  updatedAt: string;
}

export interface RoomClosureInput {
  comment?: string | undefined;
  endAt: string;
  reason: string;
  roomId: string;
  startAt: string;
}

export interface AffectedCalendarEvent {
  endAt: string;
  id: string;
  startAt: string;
  title: string;
  type: 'LESSON' | 'RENTAL';
}

export interface RoomClosurePreview {
  affected: AffectedCalendarEvent[];
  roomName: string;
}

export interface RoomClosureSummary extends RoomClosureInput {
  branchId: string;
  createdAt: string;
  id: string;
  roomName: string;
}

export interface CalendarExceptionInput {
  branchId?: string | undefined;
  comment?: string | undefined;
  endAt: string;
  startAt: string;
  title: string;
  type: CalendarExceptionType;
}

export interface CalendarExceptionSummary extends CalendarExceptionInput {
  branchName?: string | undefined;
  createdAt: string;
  id: string;
  updatedAt: string;
}

export interface TrainerSubstitutionInput {
  reason?: string | undefined;
  substituteTrainerId: string;
}

export interface TrainerSubstitutionSummary extends TrainerSubstitutionInput {
  createdAt: string;
  id: string;
  lessonId: string;
  originalTrainerId?: string | undefined;
  originalTrainerName?: string | undefined;
  substituteTrainerName: string;
}

export interface RoomAvailabilityInterval {
  endAt: string;
  kind: 'FREE' | 'LESSON' | 'RENTAL' | 'CLOSURE';
  startAt: string;
  title: string;
}

export interface RoomUtilization {
  lessonHours: number;
  lessons: number;
  rentalHours: number;
  rentals: number;
  totalOccupiedHours: number;
}

export interface CopyDayInput {
  sourceDate: string;
  targetDate: string;
}

export interface CopyDayResult {
  conflicts: number;
  copied: number;
  errors: string[];
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
  attendanceCompletedAt?: string | undefined;
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
  expensesToday: number;
  groupsWithPlaces: number;
  groupsLowOccupancy: number;
  lessonsToday: number;
  lowLessonBalance: number;
  outstandingDebt: number;
  netCashFlow: number;
  payrollPendingApproval: number;
  revenueThisMonth: number;
  revenueToday: number;
  students: number;
  trialStudents: number;
  users: number;
  subscriptionsExpiringSoon: number;
}

export type AttentionCategory =
  | 'STUDENTS'
  | 'SUBSCRIPTIONS'
  | 'PAYMENTS'
  | 'ATTENDANCE'
  | 'PAYROLL'
  | 'CARDS'
  | 'SCHEDULE'
  | 'ROOMS'
  | 'SUBSTITUTIONS'
  | 'BACKUPS';

export type AttentionSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AttentionFilters {
  branchId?: string | undefined;
  category?: AttentionCategory | undefined;
  relevance?: 'ALL' | 'TODAY' | 'UPCOMING' | undefined;
  severity?: AttentionSeverity | undefined;
}

export interface AttentionItem {
  actionLabel: string;
  actionRoute: string;
  branchId?: string | undefined;
  branchName?: string | undefined;
  category: AttentionCategory;
  description: string;
  dueAt?: string | undefined;
  entityId: string;
  entityType: string;
  id: string;
  occurredAt?: string | undefined;
  severity: AttentionSeverity;
  title: string;
}

export interface AttentionCategoryCount {
  category: AttentionCategory;
  count: number;
}

export interface AttentionSummary {
  categories: AttentionCategoryCount[];
  criticalCount: number;
  items: AttentionItem[];
  total: number;
}

export interface ActivitySummary {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
}

export interface AuditLogSummary {
  action: string;
  actorName: string;
  createdAt: string;
  detail?: string | undefined;
  entityId: string;
  entityType: string;
  id: string;
}

export interface SystemInformation {
  appVersion: string;
  databasePath: string;
  platform: NodeJS.Platform;
}

export type BackupType = 'AUTOMATIC' | 'MANUAL' | 'RESTORE_SAFETY';
export type BackupIntegrityStatus = 'VALID' | 'INVALID' | 'UNCHECKED';

export interface BackupEntry {
  createdAt: string;
  fileName: string;
  id: string;
  integrity: BackupIntegrityStatus;
  location: string;
  size: number;
  type: BackupType;
}

export interface BackupStatus {
  automaticEnabled: boolean;
  backupDirectory: string;
  consecutiveFailures: number;
  count: number;
  lastAttemptAt?: string | undefined;
  lastError?: string | undefined;
  lastSuccessfulAt?: string | undefined;
  retentionCount: number;
  totalSize: number;
  usingLocalFallback: boolean;
}

export interface BackupValidationResult {
  backup?: BackupEntry | undefined;
  canRestore: boolean;
  integrity: BackupIntegrityStatus;
  message: string;
  migrationLevel?: string | undefined;
}

export interface CustomerDisplaySettings {
  customerSeconds: number;
  displayId?: string | undefined;
  enabled: boolean;
  fullscreen: boolean;
  showLastName: boolean;
  slideSeconds: number;
}

export interface CustomerDisplayMonitor {
  height: number;
  id: string;
  isPrimary: boolean;
  label: string;
  scaleFactor: number;
  width: number;
}

export interface CustomerDisplaySlide {
  displaySeconds?: number | undefined;
  id: string;
  imageUrl?: string | undefined;
  isActive: boolean;
  mediaId?: string | undefined;
  sortOrder: number;
  text?: string | undefined;
  title: string;
}

export interface CustomerDisplaySlideInput {
  displaySeconds?: number | undefined;
  id?: string | undefined;
  isActive: boolean;
  mediaId?: string | undefined;
  text?: string | undefined;
  title: string;
}

export interface CustomerDisplayStudent {
  firstName: string;
  groups: string[];
  lastNameInitial?: string | undefined;
  nextLesson?: { groupName: string; roomName?: string | undefined; startsAt: string } | undefined;
  remainingLessons?: number | undefined;
  subscriptionExpiresAt?: string | undefined;
  subscriptionStatus: 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'NONE';
}

export interface CustomerDisplayState {
  mode: 'PROMO' | 'STUDENT';
  settings: Pick<CustomerDisplaySettings, 'showLastName' | 'slideSeconds'>;
  slides: CustomerDisplaySlide[];
  student?: CustomerDisplayStudent | undefined;
}

export interface CustomerDisplayStatus {
  displays: CustomerDisplayMonitor[];
  preview: boolean;
  secondDisplayAvailable: boolean;
  selectedDisplayPresent: boolean;
  settings: CustomerDisplaySettings;
  slides: CustomerDisplaySlide[];
  windowOpen: boolean;
}

export interface CustomerDisplayViewApi {
  getState: () => Promise<CustomerDisplayState>;
  subscribe: (listener: (state: CustomerDisplayState) => void) => () => void;
}

export interface BackupRestoreSelection extends BackupValidationResult {
  displayPath: string;
  selectionId: string;
}

export interface BackupRestoreResult {
  safetyBackup: BackupEntry;
  success: true;
}

export type SettingKey = 'appearance.theme' | 'general.workspaceName';

export interface SettingUpdate {
  key: SettingKey;
  value: string;
}

export interface AravaDesktopApi {
  audit: {
    list: (token: string) => Promise<AuditLogSummary[]>;
  };
  activity: {
    list: (token: string) => Promise<ActivitySummary[]>;
  };
  auth: {
    changePassword: (token: string, input: PasswordChangeInput) => Promise<AuthenticatedUser>;
    completePasswordChange: (
      token: string,
      input: ForcedPasswordChangeInput,
    ) => Promise<AuthSession>;
    login: (credentials: LoginCredentials) => Promise<AuthSession>;
    logout: (token: string) => Promise<void>;
    recoverOwner: (input: OwnerRecoveryInput) => Promise<OwnerRecoveryResult>;
    restore: (token: string) => Promise<AuthenticatedUser>;
  };
  globalSearch: {
    query: (token: string, query: string) => Promise<GlobalSearchResult[]>;
  };
  branches: {
    archive: (token: string, id: string) => Promise<BranchSummary>;
    create: (token: string, input: BranchInput) => Promise<BranchSummary>;
    list: (token: string, includeArchived?: boolean) => Promise<BranchSummary[]>;
    update: (token: string, id: string, input: BranchInput) => Promise<BranchSummary>;
  };
  cards: {
    archive: (token: string, id: string, input: CardActionInput) => Promise<MembershipCardSummary>;
    assign: (token: string, input: CardAssignInput) => Promise<MembershipCardSummary>;
    block: (token: string, id: string, input: CardActionInput) => Promise<MembershipCardSummary>;
    find: (token: string, barcode: string) => Promise<MembershipCardSummary | undefined>;
    history: (token: string, cardId: string) => Promise<CardHistorySummary[]>;
    list: (token: string, query: CardListQuery) => Promise<CardListResult>;
    markLost: (token: string, id: string, input: CardActionInput) => Promise<MembershipCardSummary>;
    reactivate: (
      token: string,
      id: string,
      input: CardActionInput,
    ) => Promise<MembershipCardSummary>;
    register: (token: string, input: CardRegisterInput) => Promise<MembershipCardSummary>;
    replace: (token: string, input: CardReplaceInput) => Promise<MembershipCardSummary>;
    resolveScan: (token: string, barcode: string) => Promise<CardScanResolution>;
    scanHistory: (token: string, cardId?: string) => Promise<CardScanHistorySummary[]>;
    studentCurrent: (
      token: string,
      studentId: string,
    ) => Promise<MembershipCardSummary | undefined>;
    unassign: (token: string, id: string, input: CardActionInput) => Promise<MembershipCardSummary>;
  };
  customerDisplay: {
    close: (token: string) => Promise<CustomerDisplayStatus>;
    deleteSlide: (token: string, id: string) => Promise<CustomerDisplayStatus>;
    getStatus: (token: string) => Promise<CustomerDisplayStatus>;
    moveSlide: (
      token: string,
      id: string,
      direction: 'UP' | 'DOWN',
    ) => Promise<CustomerDisplayStatus>;
    open: (token: string) => Promise<CustomerDisplayStatus>;
    preview: (token: string) => Promise<CustomerDisplayStatus>;
    returnToPromo: (token: string) => Promise<CustomerDisplayStatus>;
    saveSlide: (token: string, input: CustomerDisplaySlideInput) => Promise<CustomerDisplayStatus>;
    selectImage: (token: string) => Promise<{ mediaId: string } | undefined>;
    updateSettings: (
      token: string,
      settings: CustomerDisplaySettings,
    ) => Promise<CustomerDisplayStatus>;
  };
  rooms: {
    archive: (token: string, id: string) => Promise<RoomSummary>;
    availability: (
      token: string,
      roomId: string,
      date: string,
    ) => Promise<RoomAvailabilityInterval[]>;
    create: (token: string, input: RoomInput) => Promise<RoomSummary>;
    list: (token: string, branchId?: string, includeArchived?: boolean) => Promise<RoomSummary[]>;
    update: (token: string, id: string, input: RoomInput) => Promise<RoomSummary>;
    utilization: (
      token: string,
      roomId: string,
      dateFrom: string,
      dateTo: string,
    ) => Promise<RoomUtilization>;
  };
  rentals: {
    cancel: (token: string, id: string) => Promise<RoomRentalSummary>;
    create: (token: string, input: RoomRentalInput) => Promise<RoomRentalSummary>;
    list: (token: string, query: CalendarRangeQuery) => Promise<RoomRentalSummary[]>;
    update: (token: string, id: string, input: RoomRentalInput) => Promise<RoomRentalSummary>;
  };
  closures: {
    create: (token: string, input: RoomClosureInput) => Promise<RoomClosureSummary>;
    list: (token: string, query: CalendarRangeQuery) => Promise<RoomClosureSummary[]>;
    preview: (token: string, input: RoomClosureInput) => Promise<RoomClosurePreview>;
  };
  calendarExceptions: {
    create: (token: string, input: CalendarExceptionInput) => Promise<CalendarExceptionSummary>;
    list: (token: string, query: CalendarRangeQuery) => Promise<CalendarExceptionSummary[]>;
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
  attention: {
    list: (token: string, filters: AttentionFilters) => Promise<AttentionItem[]>;
    summary: (token: string) => Promise<AttentionSummary>;
  };
  backups: {
    create: (token: string) => Promise<BackupEntry>;
    export: (token: string) => Promise<BackupEntry | undefined>;
    list: (token: string) => Promise<BackupEntry[]>;
    openFolder: (token: string) => Promise<void>;
    restore: (
      token: string,
      selectionId: string,
      confirmation: string,
    ) => Promise<BackupRestoreResult>;
    selectFolder: (token: string) => Promise<BackupStatus | undefined>;
    selectManaged: (token: string, backupId: string) => Promise<BackupRestoreSelection>;
    selectRestoreFile: (token: string) => Promise<BackupRestoreSelection | undefined>;
    setAutomatic: (token: string, enabled: boolean) => Promise<BackupStatus>;
    status: (token: string) => Promise<BackupStatus>;
    validate: (token: string, backupId: string) => Promise<BackupValidationResult>;
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
    copyDay: (token: string, input: CopyDayInput) => Promise<CopyDayResult>;
    assignSubstitution: (
      token: string,
      id: string,
      input: TrainerSubstitutionInput,
    ) => Promise<TrainerSubstitutionSummary>;
  };
  attendance: {
    get: (token: string, lessonId: string) => Promise<AttendanceLessonDetail>;
    save: (
      token: string,
      lessonId: string,
      entries: AttendanceEntryInput[],
    ) => Promise<AttendanceLessonDetail>;
  };
  tariffs: {
    archive: (token: string, id: string) => Promise<TariffSummary>;
    create: (token: string, input: TariffInput) => Promise<TariffSummary>;
    get: (token: string, id: string) => Promise<TariffSummary>;
    list: (token: string, query: TariffListQuery) => Promise<TariffSummary[]>;
    update: (token: string, id: string, input: TariffInput) => Promise<TariffSummary>;
  };
  subscriptions: {
    adjust: (
      token: string,
      id: string,
      input: SubscriptionAdjustmentInput,
    ) => Promise<SubscriptionDetail>;
    cancel: (token: string, id: string) => Promise<SubscriptionDetail>;
    create: (token: string, input: SubscriptionCreateInput) => Promise<SubscriptionDetail>;
    freeze: (
      token: string,
      id: string,
      input: SubscriptionFreezeInput,
    ) => Promise<SubscriptionDetail>;
    get: (token: string, id: string) => Promise<SubscriptionDetail>;
    listStudent: (token: string, studentId: string) => Promise<StudentFinanceSummary>;
    unfreeze: (token: string, id: string) => Promise<SubscriptionDetail>;
  };
  payments: {
    cancel: (token: string, id: string) => Promise<PaymentDetail>;
    create: (token: string, input: PaymentInput) => Promise<PaymentDetail>;
    get: (token: string, id: string) => Promise<PaymentDetail>;
    list: (token: string, query: PaymentListQuery) => Promise<PaymentSummary[]>;
  };
  refunds: {
    create: (token: string, paymentId: string, input: RefundInput) => Promise<PaymentDetail>;
  };
  finance: {
    employees: (token: string) => Promise<StaffOption[]>;
    stats: (token: string, branchId?: string) => Promise<FinanceStats>;
  };
  expenseCategories: {
    archive: (token: string, id: string) => Promise<ExpenseCategorySummary>;
    create: (token: string, input: ExpenseCategoryInput) => Promise<ExpenseCategorySummary>;
    list: (token: string, includeArchived?: boolean) => Promise<ExpenseCategorySummary[]>;
    update: (
      token: string,
      id: string,
      input: ExpenseCategoryInput,
    ) => Promise<ExpenseCategorySummary>;
  };
  expenses: {
    cancel: (token: string, id: string) => Promise<ExpenseSummary>;
    confirm: (token: string, id: string, cashRegisterId: string) => Promise<ExpenseSummary>;
    create: (token: string, input: ExpenseInput) => Promise<ExpenseSummary>;
    list: (token: string, query: ExpenseListQuery) => Promise<ExpenseSummary[]>;
    update: (token: string, id: string, input: ExpenseInput) => Promise<ExpenseSummary>;
  };
  cash: {
    correct: (token: string, input: CashCorrectionInput) => Promise<CashTransactionSummary>;
    createRegister: (token: string, input: CashRegisterInput) => Promise<CashRegisterSummary>;
    listRegisters: (token: string, branchId?: string) => Promise<CashRegisterSummary[]>;
    listTransactions: (
      token: string,
      query: CashTransactionQuery,
    ) => Promise<CashTransactionSummary[]>;
    transfer: (token: string, input: CashTransferInput) => Promise<CashTransactionSummary[]>;
    updateRegister: (
      token: string,
      id: string,
      input: CashRegisterInput,
    ) => Promise<CashRegisterSummary>;
  };
  payroll: {
    adjustAccrual: (
      token: string,
      id: string,
      input: PayrollAdjustmentInput,
    ) => Promise<PayrollPeriodDetail>;
    approvePeriod: (token: string, id: string) => Promise<PayrollPeriodDetail>;
    calculatePeriod: (token: string, id: string) => Promise<PayrollPeriodDetail>;
    coachView: (
      token: string,
      dateFrom: string,
      dateTo: string,
    ) => Promise<PayrollAccrualSummary[]>;
    createPeriod: (token: string, input: PayrollPeriodInput) => Promise<PayrollPeriodDetail>;
    createRule: (token: string, input: PayrollRuleInput) => Promise<PayrollRuleSummary>;
    getPeriod: (token: string, id: string) => Promise<PayrollPeriodDetail>;
    listPeriods: (token: string, branchId?: string) => Promise<PayrollPeriodSummary[]>;
    listRules: (token: string, branchId?: string) => Promise<PayrollRuleSummary[]>;
    payPeriod: (
      token: string,
      id: string,
      input: PayrollPaymentInput,
    ) => Promise<PayrollPeriodDetail>;
    updateRule: (token: string, id: string, input: PayrollRuleInput) => Promise<PayrollRuleSummary>;
  };
  analytics: {
    get: (token: string, query: AnalyticsQuery) => Promise<ManagementAnalytics>;
  };
  reports: {
    exportCsv: (token: string, query: ReportQuery) => Promise<CsvExport>;
    get: (token: string, query: ReportQuery) => Promise<ReportData>;
  };
  settings: {
    get: (token: string, key: SettingKey) => Promise<string | null>;
    set: (token: string, update: SettingUpdate) => Promise<void>;
  };
  students: {
    archive: (token: string, id: string) => Promise<StudentSummary>;
    archiveNote: (token: string, noteId: string) => Promise<void>;
    create: (token: string, input: StudentInput) => Promise<StudentSummary>;
    createNote: (
      token: string,
      studentId: string,
      input: StudentNoteInput,
    ) => Promise<StudentProfileNote>;
    get: (token: string, id: string) => Promise<StudentDetail>;
    getProfile: (token: string, id: string) => Promise<StudentProfileOverview>;
    list: (token: string, query: StudentListQuery) => Promise<StudentListResult>;
    update: (token: string, id: string, input: StudentInput) => Promise<StudentSummary>;
    updateNote: (
      token: string,
      noteId: string,
      input: StudentNoteInput,
    ) => Promise<StudentProfileNote>;
  };
  system: {
    information: (token: string) => Promise<SystemInformation>;
  };
  users: {
    create: (token: string, input: UserCreateInput) => Promise<TemporaryPasswordResult>;
    list: (token: string) => Promise<UserSummary[]>;
    recoveryCodeCreate: (token: string) => Promise<RecoveryCodeResult>;
    recoveryCodeStatus: (token: string) => Promise<RecoveryCodeStatus>;
    resetPassword: (token: string, id: string) => Promise<TemporaryPasswordResult>;
    revokeSessions: (token: string, id: string) => Promise<void>;
    staffOptions: (token: string) => Promise<StaffOption[]>;
    update: (token: string, id: string, input: UserUpdateInput) => Promise<UserSummary>;
  };
}
