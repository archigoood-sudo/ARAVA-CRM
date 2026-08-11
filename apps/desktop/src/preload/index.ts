import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS, type AravaDesktopApi } from '@arava/shared/channels';

const invoke = async <Result>(channel: string, ...arguments_: unknown[]): Promise<Result> => {
  try {
    return (await ipcRenderer.invoke(channel, ...arguments_)) as Result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Сеанс завершён')) {
      (
        globalThis as {
          postMessage?: (message: unknown, targetOrigin: string) => void;
        }
      ).postMessage?.({ type: 'arava-session-expired' }, '*');
    }
    throw error;
  }
};

const desktopApi: AravaDesktopApi = {
  audit: { list: (token) => invoke(IPC_CHANNELS.auditList, token) },
  activity: { list: (token) => invoke(IPC_CHANNELS.activityList, token) },
  auth: {
    changePassword: (token, input) => invoke(IPC_CHANNELS.authChangePassword, token, input),
    completePasswordChange: (token, input) =>
      invoke(IPC_CHANNELS.authCompletePasswordChange, token, input),
    login: (credentials) => invoke(IPC_CHANNELS.authLogin, credentials),
    logout: async (token) => {
      await invoke(IPC_CHANNELS.authLogout, token);
    },
    recoverOwner: (input) => invoke(IPC_CHANNELS.authRecoverOwner, input),
    restore: (token) => invoke(IPC_CHANNELS.authRestore, token),
  },
  globalSearch: {
    query: (token, query) => invoke(IPC_CHANNELS.globalSearch, token, query),
  },
  branches: {
    archive: (token, id) => invoke(IPC_CHANNELS.branchArchive, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.branchCreate, token, input),
    list: (token, includeArchived) => invoke(IPC_CHANNELS.branchList, token, includeArchived),
    update: (token, id, input) => invoke(IPC_CHANNELS.branchUpdate, token, id, input),
  },
  cards: {
    archive: (token, id, input) => invoke(IPC_CHANNELS.cardArchive, token, id, input),
    assign: (token, input) => invoke(IPC_CHANNELS.cardAssign, token, input),
    block: (token, id, input) => invoke(IPC_CHANNELS.cardBlock, token, id, input),
    find: (token, barcode) => invoke(IPC_CHANNELS.cardFind, token, barcode),
    history: (token, cardId) => invoke(IPC_CHANNELS.cardHistory, token, cardId),
    list: (token, query) => invoke(IPC_CHANNELS.cardList, token, query),
    markLost: (token, id, input) => invoke(IPC_CHANNELS.cardMarkLost, token, id, input),
    reactivate: (token, id, input) => invoke(IPC_CHANNELS.cardReactivate, token, id, input),
    register: (token, input) => invoke(IPC_CHANNELS.cardRegister, token, input),
    replace: (token, input) => invoke(IPC_CHANNELS.cardReplace, token, input),
    resolveScan: (token, barcode) => invoke(IPC_CHANNELS.cardResolveScan, token, barcode),
    scanHistory: (token, cardId) => invoke(IPC_CHANNELS.cardScanHistory, token, cardId),
    studentCurrent: (token, studentId) => invoke(IPC_CHANNELS.cardStudentCurrent, token, studentId),
    unassign: (token, id, input) => invoke(IPC_CHANNELS.cardUnassign, token, id, input),
  },
  rooms: {
    archive: (token, id) => invoke(IPC_CHANNELS.roomArchive, token, id),
    availability: (token, roomId, date) =>
      invoke(IPC_CHANNELS.roomAvailability, token, roomId, date),
    create: (token, input) => invoke(IPC_CHANNELS.roomCreate, token, input),
    list: (token, branchId, includeArchived) =>
      invoke(IPC_CHANNELS.roomList, token, branchId, includeArchived),
    update: (token, id, input) => invoke(IPC_CHANNELS.roomUpdate, token, id, input),
    utilization: (token, roomId, dateFrom, dateTo) =>
      invoke(IPC_CHANNELS.roomUtilization, token, roomId, dateFrom, dateTo),
  },
  rentals: {
    cancel: (token, id) => invoke(IPC_CHANNELS.rentalCancel, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.rentalCreate, token, input),
    list: (token, query) => invoke(IPC_CHANNELS.rentalList, token, query),
    update: (token, id, input) => invoke(IPC_CHANNELS.rentalUpdate, token, id, input),
  },
  closures: {
    create: (token, input) => invoke(IPC_CHANNELS.closureCreate, token, input),
    list: (token, query) => invoke(IPC_CHANNELS.closureList, token, query),
    preview: (token, input) => invoke(IPC_CHANNELS.closurePreview, token, input),
  },
  calendarExceptions: {
    create: (token, input) => invoke(IPC_CHANNELS.calendarExceptionCreate, token, input),
    list: (token, query) => invoke(IPC_CHANNELS.calendarExceptionList, token, query),
  },
  contacts: {
    create: (token, studentId, input) =>
      invoke(IPC_CHANNELS.contactCreate, token, studentId, input),
    remove: async (token, id) => {
      await invoke(IPC_CHANNELS.contactRemove, token, id);
    },
    update: (token, id, input) => invoke(IPC_CHANNELS.contactUpdate, token, id, input),
  },
  dashboard: { stats: (token) => invoke(IPC_CHANNELS.dashboardStats, token) },
  groups: {
    addEnrollment: (token, groupId, input) =>
      invoke(IPC_CHANNELS.enrollmentAdd, token, groupId, input),
    archive: (token, id) => invoke(IPC_CHANNELS.groupArchive, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.groupCreate, token, input),
    get: (token, id) => invoke(IPC_CHANNELS.groupGet, token, id),
    list: (token, query) => invoke(IPC_CHANNELS.groupList, token, query),
    removeEnrollment: async (token, groupId, enrollmentId) => {
      await invoke(IPC_CHANNELS.enrollmentRemove, token, groupId, enrollmentId);
    },
    update: (token, id, input) => invoke(IPC_CHANNELS.groupUpdate, token, id, input),
  },
  schedules: {
    create: (token, input) => invoke(IPC_CHANNELS.scheduleCreate, token, input),
    deactivate: (token, id) => invoke(IPC_CHANNELS.scheduleDeactivate, token, id),
    list: (token, query) => invoke(IPC_CHANNELS.scheduleList, token, query),
    update: (token, id, input) => invoke(IPC_CHANNELS.scheduleUpdate, token, id, input),
  },
  lessons: {
    cancel: (token, id, input) => invoke(IPC_CHANNELS.lessonCancel, token, id, input),
    create: (token, input) => invoke(IPC_CHANNELS.lessonCreate, token, input),
    generate: (token, input) => invoke(IPC_CHANNELS.lessonGenerate, token, input),
    get: (token, id) => invoke(IPC_CHANNELS.lessonGet, token, id),
    list: (token, query) => invoke(IPC_CHANNELS.lessonList, token, query),
    update: (token, id, input) => invoke(IPC_CHANNELS.lessonUpdate, token, id, input),
    copyDay: (token, input) => invoke(IPC_CHANNELS.lessonCopyDay, token, input),
    assignSubstitution: (token, id, input) =>
      invoke(IPC_CHANNELS.substitutionAssign, token, id, input),
  },
  attendance: {
    get: (token, lessonId) => invoke(IPC_CHANNELS.attendanceGet, token, lessonId),
    save: (token, lessonId, entries) =>
      invoke(IPC_CHANNELS.attendanceSave, token, lessonId, entries),
  },
  tariffs: {
    archive: (token, id) => invoke(IPC_CHANNELS.tariffArchive, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.tariffCreate, token, input),
    get: (token, id) => invoke(IPC_CHANNELS.tariffGet, token, id),
    list: (token, query) => invoke(IPC_CHANNELS.tariffList, token, query),
    update: (token, id, input) => invoke(IPC_CHANNELS.tariffUpdate, token, id, input),
  },
  subscriptions: {
    adjust: (token, id, input) => invoke(IPC_CHANNELS.subscriptionAdjust, token, id, input),
    cancel: (token, id) => invoke(IPC_CHANNELS.subscriptionCancel, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.subscriptionCreate, token, input),
    freeze: (token, id, input) => invoke(IPC_CHANNELS.subscriptionFreeze, token, id, input),
    get: (token, id) => invoke(IPC_CHANNELS.subscriptionGet, token, id),
    listStudent: (token, studentId) =>
      invoke(IPC_CHANNELS.subscriptionListStudent, token, studentId),
    unfreeze: (token, id) => invoke(IPC_CHANNELS.subscriptionUnfreeze, token, id),
  },
  payments: {
    cancel: (token, id) => invoke(IPC_CHANNELS.paymentCancel, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.paymentCreate, token, input),
    get: (token, id) => invoke(IPC_CHANNELS.paymentGet, token, id),
    list: (token, query) => invoke(IPC_CHANNELS.paymentList, token, query),
  },
  refunds: {
    create: (token, paymentId, input) => invoke(IPC_CHANNELS.refundCreate, token, paymentId, input),
  },
  finance: {
    employees: (token) => invoke(IPC_CHANNELS.financeEmployees, token),
    stats: (token, branchId) => invoke(IPC_CHANNELS.financeStats, token, branchId),
  },
  expenseCategories: {
    archive: (token, id) => invoke(IPC_CHANNELS.expenseCategoryArchive, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.expenseCategoryCreate, token, input),
    list: (token, includeArchived) =>
      invoke(IPC_CHANNELS.expenseCategoryList, token, includeArchived),
    update: (token, id, input) => invoke(IPC_CHANNELS.expenseCategoryUpdate, token, id, input),
  },
  expenses: {
    cancel: (token, id) => invoke(IPC_CHANNELS.expenseCancel, token, id),
    confirm: (token, id, cashRegisterId) =>
      invoke(IPC_CHANNELS.expenseConfirm, token, id, cashRegisterId),
    create: (token, input) => invoke(IPC_CHANNELS.expenseCreate, token, input),
    list: (token, query) => invoke(IPC_CHANNELS.expenseList, token, query),
    update: (token, id, input) => invoke(IPC_CHANNELS.expenseUpdate, token, id, input),
  },
  cash: {
    correct: (token, input) => invoke(IPC_CHANNELS.cashCorrectionCreate, token, input),
    createRegister: (token, input) => invoke(IPC_CHANNELS.cashRegisterCreate, token, input),
    listRegisters: (token, branchId) => invoke(IPC_CHANNELS.cashRegisterList, token, branchId),
    listTransactions: (token, query) => invoke(IPC_CHANNELS.cashTransactionList, token, query),
    transfer: (token, input) => invoke(IPC_CHANNELS.cashTransferCreate, token, input),
    updateRegister: (token, id, input) => invoke(IPC_CHANNELS.cashRegisterUpdate, token, id, input),
  },
  payroll: {
    adjustAccrual: (token, id, input) =>
      invoke(IPC_CHANNELS.payrollAccrualAdjust, token, id, input),
    approvePeriod: (token, id) => invoke(IPC_CHANNELS.payrollPeriodApprove, token, id),
    calculatePeriod: (token, id) => invoke(IPC_CHANNELS.payrollPeriodCalculate, token, id),
    coachView: (token, dateFrom, dateTo) =>
      invoke(IPC_CHANNELS.payrollCoachView, token, dateFrom, dateTo),
    createPeriod: (token, input) => invoke(IPC_CHANNELS.payrollPeriodCreate, token, input),
    createRule: (token, input) => invoke(IPC_CHANNELS.payrollRuleCreate, token, input),
    getPeriod: (token, id) => invoke(IPC_CHANNELS.payrollPeriodGet, token, id),
    listPeriods: (token, branchId) => invoke(IPC_CHANNELS.payrollPeriodList, token, branchId),
    listRules: (token, branchId) => invoke(IPC_CHANNELS.payrollRuleList, token, branchId),
    payPeriod: (token, id, input) => invoke(IPC_CHANNELS.payrollPeriodPay, token, id, input),
    updateRule: (token, id, input) => invoke(IPC_CHANNELS.payrollRuleUpdate, token, id, input),
  },
  analytics: {
    get: (token, query) => invoke(IPC_CHANNELS.analyticsGet, token, query),
  },
  reports: {
    exportCsv: (token, query) => invoke(IPC_CHANNELS.reportExportCsv, token, query),
    get: (token, query) => invoke(IPC_CHANNELS.reportGet, token, query),
  },
  settings: {
    get: (token, key) => invoke(IPC_CHANNELS.settingsGet, token, key),
    set: async (token, update) => {
      await invoke(IPC_CHANNELS.settingsSet, token, update);
    },
  },
  students: {
    archive: (token, id) => invoke(IPC_CHANNELS.studentArchive, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.studentCreate, token, input),
    get: (token, id) => invoke(IPC_CHANNELS.studentGet, token, id),
    list: (token, query) => invoke(IPC_CHANNELS.studentList, token, query),
    update: (token, id, input) => invoke(IPC_CHANNELS.studentUpdate, token, id, input),
  },
  system: { information: (token) => invoke(IPC_CHANNELS.systemInformation, token) },
  users: {
    create: (token, input) => invoke(IPC_CHANNELS.userCreate, token, input),
    list: (token) => invoke(IPC_CHANNELS.userList, token),
    recoveryCodeCreate: (token) => invoke(IPC_CHANNELS.userRecoveryCodeCreate, token),
    recoveryCodeStatus: (token) => invoke(IPC_CHANNELS.userRecoveryCodeStatus, token),
    resetPassword: (token, id) => invoke(IPC_CHANNELS.userResetPassword, token, id),
    revokeSessions: async (token, id) => {
      await invoke(IPC_CHANNELS.userRevokeSessions, token, id);
    },
    staffOptions: (token) => invoke(IPC_CHANNELS.userStaffOptions, token),
    update: (token, id, input) => invoke(IPC_CHANNELS.userUpdate, token, id, input),
  },
};

contextBridge.exposeInMainWorld('arava', desktopApi);
