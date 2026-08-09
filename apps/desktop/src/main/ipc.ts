import {
  ApplicationService,
  FinanceService,
  ManagementService,
  StudioService,
  accessibleBranchIds,
  assertCapability,
  type DatabaseClient,
} from '@arava/database';
import {
  IPC_CHANNELS,
  attendanceEntriesSchema,
  analyticsQuerySchema,
  branchInputSchema,
  cashCorrectionInputSchema,
  cashRegisterInputSchema,
  cashTransactionQuerySchema,
  cashTransferInputSchema,
  enrollmentInputSchema,
  expenseCategoryInputSchema,
  expenseInputSchema,
  expenseListQuerySchema,
  forcedPasswordChangeSchema,
  groupInputSchema,
  groupListQuerySchema,
  identifierSchema,
  loginCredentialsSchema,
  ownerRecoverySchema,
  lessonCancelInputSchema,
  lessonGenerateInputSchema,
  lessonInputSchema,
  lessonListQuerySchema,
  passwordChangeSchema,
  paymentInputSchema,
  paymentListQuerySchema,
  payrollAdjustmentInputSchema,
  payrollPaymentInputSchema,
  payrollPeriodInputSchema,
  payrollRuleInputSchema,
  refundInputSchema,
  reportQuerySchema,
  sessionTokenSchema,
  settingKeySchema,
  settingUpdateSchema,
  studentContactInputSchema,
  studentInputSchema,
  studentListQuerySchema,
  subscriptionAdjustmentInputSchema,
  subscriptionCreateInputSchema,
  subscriptionFreezeInputSchema,
  tariffInputSchema,
  tariffListQuerySchema,
  userCreateSchema,
  userUpdateSchema,
  weeklyScheduleInputSchema,
  weeklyScheduleQuerySchema,
  type ActivitySummary,
  type DashboardStats,
  type SettingKey,
  type SystemInformation,
} from '@arava/shared';
import { app, ipcMain } from 'electron';
import type { EnrollmentStatus } from '@prisma/client';

type IpcHandler = (...arguments_: unknown[]) => unknown;
const coachEnrollmentStatuses = ['ACTIVE', 'TRIAL', 'FROZEN'] satisfies EnrollmentStatus[];

export function createIpcHandlers(
  database: DatabaseClient,
  service: ApplicationService,
  databasePath: string,
): Record<string, IpcHandler> {
  const studio = new StudioService(database, service);
  const finance = new FinanceService(database, service);
  const management = new ManagementService(database, service);
  return {
    [IPC_CHANNELS.authLogin]: (unsafeCredentials) =>
      service.login(loginCredentialsSchema.parse(unsafeCredentials)),
    [IPC_CHANNELS.authRestore]: (unsafeToken) =>
      service.restoreSession(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.authLogout]: (unsafeToken) =>
      service.logout(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.authChangePassword]: (unsafeToken, unsafeInput) =>
      service.changePassword(
        sessionTokenSchema.parse(unsafeToken),
        passwordChangeSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.authCompletePasswordChange]: (unsafeToken, unsafeInput) =>
      service.completePasswordChange(
        sessionTokenSchema.parse(unsafeToken),
        forcedPasswordChangeSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.authRecoverOwner]: (unsafeInput) =>
      service.recoverOwner(ownerRecoverySchema.parse(unsafeInput)),

    [IPC_CHANNELS.userList]: (unsafeToken) =>
      service.listUsers(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.userCreate]: (unsafeToken, unsafeInput) =>
      service.createUserWithTemporaryPassword(
        sessionTokenSchema.parse(unsafeToken),
        userCreateSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.userUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      service.updateUser(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        userUpdateSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.userResetPassword]: (unsafeToken, unsafeId) =>
      service.resetUserPassword(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.userRevokeSessions]: (unsafeToken, unsafeId) =>
      service.revokeUserSessions(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.userRecoveryCodeStatus]: (unsafeToken) =>
      service.recoveryCodeStatus(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.userRecoveryCodeCreate]: (unsafeToken) =>
      service.createRecoveryCode(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.userStaffOptions]: (unsafeToken) =>
      studio.listStaffOptions(sessionTokenSchema.parse(unsafeToken)),

    [IPC_CHANNELS.groupList]: (unsafeToken, unsafeQuery) =>
      studio.listGroups(
        sessionTokenSchema.parse(unsafeToken),
        groupListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.groupGet]: (unsafeToken, unsafeId) =>
      studio.getGroup(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.groupCreate]: (unsafeToken, unsafeInput) =>
      studio.createGroup(
        sessionTokenSchema.parse(unsafeToken),
        groupInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.groupUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      studio.updateGroup(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        groupInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.groupArchive]: (unsafeToken, unsafeId) =>
      studio.archiveGroup(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.enrollmentAdd]: (unsafeToken, unsafeGroupId, unsafeInput) =>
      studio.addEnrollment(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeGroupId),
        enrollmentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.enrollmentRemove]: (unsafeToken, unsafeGroupId, unsafeEnrollmentId) =>
      studio.removeEnrollment(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeGroupId),
        identifierSchema.parse(unsafeEnrollmentId),
      ),

    [IPC_CHANNELS.scheduleList]: (unsafeToken, unsafeQuery) =>
      studio.listSchedules(
        sessionTokenSchema.parse(unsafeToken),
        weeklyScheduleQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.scheduleCreate]: (unsafeToken, unsafeInput) =>
      studio.createSchedule(
        sessionTokenSchema.parse(unsafeToken),
        weeklyScheduleInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.scheduleUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      studio.updateSchedule(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        weeklyScheduleInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.scheduleDeactivate]: (unsafeToken, unsafeId) =>
      studio.deactivateSchedule(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),

    [IPC_CHANNELS.lessonList]: (unsafeToken, unsafeQuery) =>
      studio.listLessons(
        sessionTokenSchema.parse(unsafeToken),
        lessonListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.lessonGet]: (unsafeToken, unsafeId) =>
      studio.getLesson(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.lessonCreate]: (unsafeToken, unsafeInput) =>
      studio.createLesson(
        sessionTokenSchema.parse(unsafeToken),
        lessonInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.lessonUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      studio.updateLesson(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        lessonInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.lessonCancel]: (unsafeToken, unsafeId, unsafeInput) =>
      studio.cancelLesson(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        lessonCancelInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.lessonGenerate]: (unsafeToken, unsafeInput) =>
      studio.generateLessons(
        sessionTokenSchema.parse(unsafeToken),
        lessonGenerateInputSchema.parse(unsafeInput),
      ),

    [IPC_CHANNELS.attendanceGet]: (unsafeToken, unsafeLessonId) =>
      studio.getAttendance(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeLessonId),
      ),
    [IPC_CHANNELS.attendanceSave]: (unsafeToken, unsafeLessonId, unsafeEntries) =>
      studio.saveAttendance(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeLessonId),
        attendanceEntriesSchema.parse(unsafeEntries),
      ),

    [IPC_CHANNELS.tariffList]: (unsafeToken, unsafeQuery) =>
      finance.listTariffs(
        sessionTokenSchema.parse(unsafeToken),
        tariffListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.tariffGet]: (unsafeToken, unsafeId) =>
      finance.getTariff(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.tariffCreate]: (unsafeToken, unsafeInput) =>
      finance.createTariff(
        sessionTokenSchema.parse(unsafeToken),
        tariffInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.tariffUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      finance.updateTariff(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        tariffInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.tariffArchive]: (unsafeToken, unsafeId) =>
      finance.archiveTariff(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),

    [IPC_CHANNELS.subscriptionCreate]: (unsafeToken, unsafeInput) =>
      finance.createSubscription(
        sessionTokenSchema.parse(unsafeToken),
        subscriptionCreateInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.subscriptionListStudent]: (unsafeToken, unsafeStudentId) =>
      finance.listStudentSubscriptions(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
      ),
    [IPC_CHANNELS.subscriptionGet]: (unsafeToken, unsafeId) =>
      finance.getSubscription(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.subscriptionFreeze]: (unsafeToken, unsafeId, unsafeInput) =>
      finance.freezeSubscription(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        subscriptionFreezeInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.subscriptionUnfreeze]: (unsafeToken, unsafeId) =>
      finance.unfreezeSubscription(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.subscriptionAdjust]: (unsafeToken, unsafeId, unsafeInput) =>
      finance.adjustSubscription(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        subscriptionAdjustmentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.subscriptionCancel]: (unsafeToken, unsafeId) =>
      finance.cancelSubscription(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),

    [IPC_CHANNELS.paymentCreate]: (unsafeToken, unsafeInput) =>
      finance.createPayment(
        sessionTokenSchema.parse(unsafeToken),
        paymentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.paymentList]: (unsafeToken, unsafeQuery) =>
      finance.listPayments(
        sessionTokenSchema.parse(unsafeToken),
        paymentListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.paymentGet]: (unsafeToken, unsafeId) =>
      finance.getPayment(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.paymentCancel]: (unsafeToken, unsafeId) =>
      finance.cancelPayment(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.refundCreate]: (unsafeToken, unsafePaymentId, unsafeInput) =>
      finance.createRefund(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafePaymentId),
        refundInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.financeEmployees]: (unsafeToken) =>
      finance.listFinanceEmployees(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.financeStats]: (unsafeToken, unsafeBranchId) =>
      finance.financeStats(
        sessionTokenSchema.parse(unsafeToken),
        unsafeBranchId === undefined ? undefined : identifierSchema.parse(unsafeBranchId),
      ),

    [IPC_CHANNELS.expenseCategoryList]: (unsafeToken, unsafeIncludeArchived) =>
      management.listExpenseCategories(
        sessionTokenSchema.parse(unsafeToken),
        unsafeIncludeArchived === true,
      ),
    [IPC_CHANNELS.expenseCategoryCreate]: (unsafeToken, unsafeInput) =>
      management.createExpenseCategory(
        sessionTokenSchema.parse(unsafeToken),
        expenseCategoryInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.expenseCategoryUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      management.updateExpenseCategory(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        expenseCategoryInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.expenseCategoryArchive]: (unsafeToken, unsafeId) =>
      management.archiveExpenseCategory(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.expenseList]: (unsafeToken, unsafeQuery) =>
      management.listExpenses(
        sessionTokenSchema.parse(unsafeToken),
        expenseListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.expenseCreate]: (unsafeToken, unsafeInput) =>
      management.createExpense(
        sessionTokenSchema.parse(unsafeToken),
        expenseInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.expenseUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      management.updateExpense(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        expenseInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.expenseConfirm]: (unsafeToken, unsafeId, unsafeRegisterId) =>
      management.confirmExpense(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        identifierSchema.parse(unsafeRegisterId),
      ),
    [IPC_CHANNELS.expenseCancel]: (unsafeToken, unsafeId) =>
      management.cancelExpense(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.cashRegisterList]: (unsafeToken, unsafeBranchId) =>
      management.listCashRegisters(
        sessionTokenSchema.parse(unsafeToken),
        unsafeBranchId === undefined ? undefined : identifierSchema.parse(unsafeBranchId),
      ),
    [IPC_CHANNELS.cashRegisterCreate]: (unsafeToken, unsafeInput) =>
      management.createCashRegister(
        sessionTokenSchema.parse(unsafeToken),
        cashRegisterInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cashRegisterUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      management.updateCashRegister(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        cashRegisterInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cashTransactionList]: (unsafeToken, unsafeQuery) =>
      management.listCashTransactions(
        sessionTokenSchema.parse(unsafeToken),
        cashTransactionQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.cashCorrectionCreate]: (unsafeToken, unsafeInput) =>
      management.correctCash(
        sessionTokenSchema.parse(unsafeToken),
        cashCorrectionInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cashTransferCreate]: (unsafeToken, unsafeInput) =>
      management.transferCash(
        sessionTokenSchema.parse(unsafeToken),
        cashTransferInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollRuleList]: (unsafeToken, unsafeBranchId) =>
      management.listPayrollRules(
        sessionTokenSchema.parse(unsafeToken),
        unsafeBranchId === undefined ? undefined : identifierSchema.parse(unsafeBranchId),
      ),
    [IPC_CHANNELS.payrollRuleCreate]: (unsafeToken, unsafeInput) =>
      management.createPayrollRule(
        sessionTokenSchema.parse(unsafeToken),
        payrollRuleInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollRuleUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      management.updatePayrollRule(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        payrollRuleInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollPeriodList]: (unsafeToken, unsafeBranchId) =>
      management.listPayrollPeriods(
        sessionTokenSchema.parse(unsafeToken),
        unsafeBranchId === undefined ? undefined : identifierSchema.parse(unsafeBranchId),
      ),
    [IPC_CHANNELS.payrollPeriodCreate]: (unsafeToken, unsafeInput) =>
      management.createPayrollPeriod(
        sessionTokenSchema.parse(unsafeToken),
        payrollPeriodInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollPeriodGet]: (unsafeToken, unsafeId) =>
      management.getPayrollPeriod(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.payrollPeriodCalculate]: (unsafeToken, unsafeId) =>
      management.calculatePayrollPeriod(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.payrollPeriodApprove]: (unsafeToken, unsafeId) =>
      management.approvePayrollPeriod(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.payrollPeriodPay]: (unsafeToken, unsafeId, unsafeInput) =>
      management.payPayrollPeriod(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        payrollPaymentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollAccrualAdjust]: (unsafeToken, unsafeId, unsafeInput) =>
      management.adjustPayrollAccrual(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        payrollAdjustmentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollCoachView]: (unsafeToken, unsafeDateFrom, unsafeDateTo) =>
      management.coachPayroll(
        sessionTokenSchema.parse(unsafeToken),
        String(unsafeDateFrom),
        String(unsafeDateTo),
      ),
    [IPC_CHANNELS.analyticsGet]: (unsafeToken, unsafeQuery) =>
      management.analytics(
        sessionTokenSchema.parse(unsafeToken),
        analyticsQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.reportGet]: (unsafeToken, unsafeQuery) =>
      management.report(
        sessionTokenSchema.parse(unsafeToken),
        reportQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.reportExportCsv]: (unsafeToken, unsafeQuery) =>
      management.exportReportCsv(
        sessionTokenSchema.parse(unsafeToken),
        reportQuerySchema.parse(unsafeQuery),
      ),

    [IPC_CHANNELS.branchList]: (unsafeToken, unsafeIncludeArchived) =>
      service.listBranches(sessionTokenSchema.parse(unsafeToken), unsafeIncludeArchived === true),
    [IPC_CHANNELS.branchCreate]: (unsafeToken, unsafeInput) =>
      service.createBranch(
        sessionTokenSchema.parse(unsafeToken),
        branchInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.branchUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      service.updateBranch(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        branchInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.branchArchive]: (unsafeToken, unsafeId) =>
      service.archiveBranch(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),

    [IPC_CHANNELS.studentList]: (unsafeToken, unsafeQuery) =>
      service.listStudents(
        sessionTokenSchema.parse(unsafeToken),
        studentListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.studentGet]: (unsafeToken, unsafeId) =>
      service.getStudent(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.studentCreate]: (unsafeToken, unsafeInput) =>
      service.createStudent(
        sessionTokenSchema.parse(unsafeToken),
        studentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.studentUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      service.updateStudent(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        studentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.studentArchive]: (unsafeToken, unsafeId) =>
      service.archiveStudent(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),

    [IPC_CHANNELS.contactCreate]: (unsafeToken, unsafeStudentId, unsafeInput) =>
      service.createContact(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
        studentContactInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.contactUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      service.updateContact(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        studentContactInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.contactRemove]: (unsafeToken, unsafeId) =>
      service.removeContact(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),

    [IPC_CHANNELS.dashboardStats]: async (unsafeToken): Promise<DashboardStats> => {
      const actor = await service.authenticate(sessionTokenSchema.parse(unsafeToken));
      const branchIds = accessibleBranchIds(actor);
      const studentScope = {
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(actor.role === 'COACH'
          ? {
              enrollments: {
                some: {
                  group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] },
                  leftAt: null,
                  status: { in: coachEnrollmentStatuses },
                },
              },
            }
          : {}),
      };
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date();
      dayEnd.setHours(23, 59, 59, 999);
      const coachGroupScope =
        actor.role === 'COACH'
          ? { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] }
          : {};
      const [
        branches,
        students,
        trialStudents,
        users,
        groups,
        lessons,
        subscriptions,
        financeSummary,
      ] = await Promise.all([
        database.branch.count({
          where: { ...(branchIds ? { id: { in: branchIds } } : {}), isActive: true },
        }),
        database.student.count({
          where: { archivedAt: null, ...studentScope },
        }),
        database.student.count({
          where: {
            archivedAt: null,
            ...studentScope,
            status: 'TRIAL',
          },
        }),
        database.user.count({
          where:
            actor.role === 'OWNER' || actor.role === 'ADMIN'
              ? { isActive: true }
              : { id: '__not_visible__' },
        }),
        database.danceGroup.findMany({
          include: {
            _count: {
              select: {
                enrollments: {
                  where: { leftAt: null, status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] } },
                },
              },
            },
          },
          where: {
            archivedAt: null,
            status: { in: ['ACTIVE', 'RECRUITING'] },
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
            ...coachGroupScope,
          },
        }),
        database.lesson.findMany({
          include: {
            _count: { select: { attendance: true } },
            group: {
              include: {
                _count: {
                  select: {
                    enrollments: {
                      where: { leftAt: null, status: { in: ['ACTIVE', 'TRIAL'] } },
                    },
                  },
                },
              },
            },
          },
          where: {
            startsAt: { gte: dayStart, lte: dayEnd },
            status: { not: 'CANCELLED' },
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
            ...(actor.role === 'COACH'
              ? {
                  OR: [
                    { coachId: actor.id },
                    { group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] } },
                  ],
                }
              : {}),
          },
        }),
        database.subscription.findMany({
          select: { expiresAt: true, lessonLimit: true, lessonsUsed: true },
          where: {
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
            ...(actor.role === 'COACH' ? { student: studentScope } : {}),
            status: { in: ['ACTIVE', 'FROZEN'] },
          },
        }),
        actor.role === 'COACH'
          ? Promise.resolve({ outstandingDebt: 0, revenueThisMonth: 0, revenueToday: 0 })
          : finance.financeStats(sessionTokenSchema.parse(unsafeToken)),
      ]);
      const expectedToday = lessons.reduce(
        (total, lesson) => total + lesson.group._count.enrollments,
        0,
      );
      const attendanceMarked = lessons.reduce(
        (total, lesson) => total + lesson._count.attendance,
        0,
      );
      const now = new Date();
      const expiringBoundary = new Date(now.getTime() + 5 * 86_400_000);
      const managementScope = branchIds ? { branchId: { in: branchIds } } : {};
      const [expenseToday, cashToday, payrollPendingApproval] =
        actor.role === 'COACH'
          ? [{ _sum: { amount: null } }, [], 0]
          : await Promise.all([
              database.expense.aggregate({
                _sum: { amount: true },
                where: {
                  ...managementScope,
                  spentAt: { gte: dayStart, lte: dayEnd },
                  status: 'CONFIRMED',
                },
              }),
              database.cashTransaction.findMany({
                select: { amount: true, type: true },
                where: { ...managementScope, occurredAt: { gte: dayStart, lte: dayEnd } },
              }),
              database.payrollPeriod.count({
                where: {
                  ...(branchIds ? { branchId: { in: branchIds } } : {}),
                  status: 'CALCULATED',
                },
              }),
            ]);
      const netCashFlow = cashToday.reduce(
        (sum, transaction) =>
          sum +
          (transaction.type === 'INCOME'
            ? transaction.amount
            : transaction.type === 'EXPENSE'
              ? -transaction.amount
              : transaction.amount),
        0,
      );
      return {
        activeGroups: groups.length,
        attendanceMarked,
        attendanceUnmarked: Math.max(0, expectedToday - attendanceMarked),
        branches,
        expectedToday,
        expensesToday: expenseToday._sum.amount ?? 0,
        groupsLowOccupancy: groups.filter(
          (group) => group._count.enrollments / group.capacity < 0.5,
        ).length,
        groupsWithPlaces: groups.filter((group) => group._count.enrollments < group.capacity)
          .length,
        lessonsToday: lessons.length,
        lowLessonBalance: subscriptions.filter(
          ({ lessonLimit, lessonsUsed }) =>
            lessonLimit !== null && Math.max(0, lessonLimit - lessonsUsed) <= 2,
        ).length,
        netCashFlow,
        outstandingDebt: financeSummary.outstandingDebt,
        payrollPendingApproval,
        revenueThisMonth: financeSummary.revenueThisMonth,
        revenueToday: financeSummary.revenueToday,
        students,
        subscriptionsExpiringSoon: subscriptions.filter(
          ({ expiresAt }) => expiresAt && expiresAt >= now && expiresAt <= expiringBoundary,
        ).length,
        trialStudents,
        users,
      };
    },

    [IPC_CHANNELS.activityList]: async (unsafeToken): Promise<ActivitySummary[]> => {
      await service.authenticate(sessionTokenSchema.parse(unsafeToken));
      const activity = await database.activityEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
      });
      return activity.map((event) => ({
        createdAt: event.createdAt.toISOString(),
        detail: event.detail,
        id: event.id,
        title: event.title,
      }));
    },

    [IPC_CHANNELS.settingsGet]: async (unsafeToken, unsafeKey): Promise<string | null> => {
      await service.authenticate(sessionTokenSchema.parse(unsafeToken));
      const key: SettingKey = settingKeySchema.parse(unsafeKey);
      const setting = await database.appSetting.findUnique({ where: { key } });
      return setting?.value ?? null;
    },
    [IPC_CHANNELS.settingsSet]: async (unsafeToken, unsafeUpdate): Promise<void> => {
      const actor = await service.authenticate(sessionTokenSchema.parse(unsafeToken));
      const update = settingUpdateSchema.parse(unsafeUpdate);
      if (update.key === 'general.workspaceName')
        assertCapability(actor, 'canManageSystemSettings');
      await database.appSetting.upsert({
        create: update,
        update: { value: update.value },
        where: { key: update.key },
      });
    },
    [IPC_CHANNELS.systemInformation]: async (unsafeToken): Promise<SystemInformation> => {
      await service.authenticate(sessionTokenSchema.parse(unsafeToken));
      return { appVersion: app.getVersion(), databasePath, platform: process.platform };
    },
  };
}

export function registerIpcHandlers(database: DatabaseClient, databasePath: string): void {
  const service = new ApplicationService(database);
  const handlers = createIpcHandlers(database, service, databasePath);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...arguments_: unknown[]) => handler(...arguments_));
  }
}

export function removeIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) ipcMain.removeHandler(channel);
}
