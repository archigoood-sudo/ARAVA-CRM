import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC_CHANNELS,
  type AravaDesktopApi,
  type CustomerDisplayState,
  type CustomerDisplayViewApi,
} from '@arava/shared/channels';

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
  chats: {
    get: (token, conversationId) => invoke(IPC_CHANNELS.chatGet, token, conversationId),
    list: (token, query) => invoke(IPC_CHANNELS.chatList, token, query),
    messages: (token, conversationId, before) =>
      invoke(IPC_CHANNELS.chatMessages, token, conversationId, before),
    read: async (token, conversationId) => {
      await invoke(IPC_CHANNELS.chatRead, token, conversationId);
    },
    send: (token, conversationId, input) =>
      invoke(IPC_CHANNELS.chatSend, token, conversationId, input),
  },
  leads: {
    assignGroup: (token, id, input) => invoke(IPC_CHANNELS.leadAssignGroup, token, id, input),
    convert: (token, id, crmStudentId) => invoke(IPC_CHANNELS.leadConvert, token, id, crmStudentId),
    create: (token, input) => invoke(IPC_CHANNELS.leadCreate, token, input),
    createStudent: (token, id, input) => invoke(IPC_CHANNELS.leadCreateStudent, token, id, input),
    get: (token, id) => invoke(IPC_CHANNELS.leadGet, token, id),
    list: (token, query) => invoke(IPC_CHANNELS.leadList, token, query),
    updateStatus: (token, id, status) => invoke(IPC_CHANNELS.leadUpdateStatus, token, id, status),
  },
  publications: {
    archive: (token, id) => invoke(IPC_CHANNELS.publicationArchive, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.publicationCreate, token, input),
    list: (token) => invoke(IPC_CHANNELS.publicationList, token),
    options: (token) => invoke(IPC_CHANNELS.publicationOptions, token),
    publish: (token, id) => invoke(IPC_CHANNELS.publicationPublish, token, id),
    retry: (token, id) => invoke(IPC_CHANNELS.publicationRetry, token, id),
    selectImage: (token) => invoke(IPC_CHANNELS.publicationSelectImage, token),
    update: (token, id, input) => invoke(IPC_CHANNELS.publicationUpdate, token, id, input),
  },
  integration: {
    confirmInitialSync: (token) => invoke(IPC_CHANNELS.integrationConfirmInitialSync, token),
    confirmReconciliation: (token) => invoke(IPC_CHANNELS.integrationConfirmReconciliation, token),
    diagnose: (token) => invoke(IPC_CHANNELS.integrationDiagnose, token),
    getStatus: (token) => invoke(IPC_CHANNELS.integrationGetStatus, token),
    listConflicts: (token) => invoke(IPC_CHANNELS.integrationListConflicts, token),
    listLog: (token) => invoke(IPC_CHANNELS.integrationListLog, token),
    pair: (token, input) => invoke(IPC_CHANNELS.integrationPair, token, input),
    renameDevice: (token, deviceId, input) =>
      invoke(IPC_CHANNELS.integrationRenameDevice, token, deviceId, input),
    prepareInitialSync: (token) => invoke(IPC_CHANNELS.integrationPrepareInitialSync, token),
    reconciliationPreview: (token) => invoke(IPC_CHANNELS.integrationReconciliationPreview, token),
    resolveConflict: (token, conflictId, input) =>
      invoke(IPC_CHANNELS.integrationResolveConflict, token, conflictId, input),
    recoverFromServer: (token) => invoke(IPC_CHANNELS.integrationRecoverFromServer, token),
    revokeDevice: (token, deviceId) =>
      invoke(IPC_CHANNELS.integrationRevokeDevice, token, deviceId),
    pruneJournal: (token) => invoke(IPC_CHANNELS.integrationPruneJournal, token),
    syncNow: (token) => invoke(IPC_CHANNELS.integrationSyncNow, token),
    testConnection: (token) => invoke(IPC_CHANNELS.integrationTestConnection, token),
    updateSettings: (token, input) => invoke(IPC_CHANNELS.integrationUpdateSettings, token, input),
  },
  webActions: {
    approve: (token, id, input) => invoke(IPC_CHANNELS.webActionApprove, token, id, input),
    list: (token) => invoke(IPC_CHANNELS.webActionList, token),
    reject: (token, id, reason) => invoke(IPC_CHANNELS.webActionReject, token, id, reason),
  },
  trainers: {
    getProfile: (token, id, month) => invoke(IPC_CHANNELS.trainerProfileGet, token, id, month),
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
  customerDisplay: {
    close: (token) => invoke(IPC_CHANNELS.customerDisplayClose, token),
    deleteSlide: (token, id) => invoke(IPC_CHANNELS.customerDisplayDeleteSlide, token, id),
    getStatus: (token) => invoke(IPC_CHANNELS.customerDisplayGetStatus, token),
    moveSlide: (token, id, direction) =>
      invoke(IPC_CHANNELS.customerDisplayMoveSlide, token, id, direction),
    open: (token) => invoke(IPC_CHANNELS.customerDisplayOpen, token),
    preview: (token) => invoke(IPC_CHANNELS.customerDisplayPreview, token),
    returnToPromo: (token) => invoke(IPC_CHANNELS.customerDisplayReturnToPromo, token),
    saveSlide: (token, input) => invoke(IPC_CHANNELS.customerDisplaySaveSlide, token, input),
    selectImage: (token) => invoke(IPC_CHANNELS.customerDisplaySelectImage, token),
    updateSettings: (token, settings) =>
      invoke(IPC_CHANNELS.customerDisplayUpdateSettings, token, settings),
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
  attention: {
    list: (token, filters) => invoke(IPC_CHANNELS.attentionList, token, filters),
    summary: (token) => invoke(IPC_CHANNELS.attentionSummary, token),
  },
  backups: {
    create: (token) => invoke(IPC_CHANNELS.backupCreate, token),
    export: (token) => invoke(IPC_CHANNELS.backupExport, token),
    list: (token) => invoke(IPC_CHANNELS.backupList, token),
    openFolder: async (token) => {
      await invoke(IPC_CHANNELS.backupOpenFolder, token);
    },
    restore: (token, selectionId, confirmation) =>
      invoke(IPC_CHANNELS.backupRestore, token, selectionId, confirmation),
    selectFolder: (token) => invoke(IPC_CHANNELS.backupSelectFolder, token),
    selectManaged: (token, backupId) => invoke(IPC_CHANNELS.backupSelectManaged, token, backupId),
    selectRestoreFile: (token) => invoke(IPC_CHANNELS.backupSelectRestoreFile, token),
    setAutomatic: (token, enabled) => invoke(IPC_CHANNELS.backupSetAutomatic, token, enabled),
    status: (token) => invoke(IPC_CHANNELS.backupStatus, token),
    validate: (token, backupId) => invoke(IPC_CHANNELS.backupValidate, token, backupId),
  },
  groups: {
    addEnrollment: (token, groupId, input) =>
      invoke(IPC_CHANNELS.enrollmentAdd, token, groupId, input),
    archive: (token, id) => invoke(IPC_CHANNELS.groupArchive, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.groupCreate, token, input),
    get: (token, id) => invoke(IPC_CHANNELS.groupGet, token, id),
    listEligibleGroups: (token, studentId) =>
      invoke(IPC_CHANNELS.enrollmentEligibleGroups, token, studentId),
    listEligibleStudents: (token, groupId) =>
      invoke(IPC_CHANNELS.enrollmentEligibleStudents, token, groupId),
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
    scanOptions: (token, studentId, date) =>
      invoke(IPC_CHANNELS.attendanceScanOptions, token, studentId, date),
    save: (token, lessonId, entries) =>
      invoke(IPC_CHANNELS.attendanceSave, token, lessonId, entries),
    today: (token, date) => invoke(IPC_CHANNELS.attendanceToday, token, date),
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
  paymentOperations: {
    cancel: (token, id, input) => invoke(IPC_CHANNELS.paymentOperationCancel, token, id, input),
    cancelAqsi: (token, id) => invoke(IPC_CHANNELS.paymentOperationCancelAqsi, token, id),
    cancelSbp: (token, id) => invoke(IPC_CHANNELS.paymentOperationCancelSbp, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.paymentOperationCreate, token, input),
    get: (token, id) => invoke(IPC_CHANNELS.paymentOperationGet, token, id),
    listStudent: (token, studentId) =>
      invoke(IPC_CHANNELS.paymentOperationListStudent, token, studentId),
    refreshSbp: (token, id) => invoke(IPC_CHANNELS.paymentOperationRefreshSbp, token, id),
    refreshAqsi: (token, id) => invoke(IPC_CHANNELS.paymentOperationRefreshAqsi, token, id),
    retryFiscalReceipt: (token, id) =>
      invoke(IPC_CHANNELS.paymentOperationRetryFiscalReceipt, token, id),
    sbpDevices: (token) => invoke(IPC_CHANNELS.paymentOperationSbpDevices, token),
    sbpHealth: (token) => invoke(IPC_CHANNELS.paymentOperationSbpHealth, token),
    sbpSelectDevice: (token, deviceId) =>
      invoke(IPC_CHANNELS.paymentOperationSbpSelectDevice, token, deviceId),
    startSbp: (token, id) => invoke(IPC_CHANNELS.paymentOperationStartSbp, token, id),
    startAqsi: (token, id) => invoke(IPC_CHANNELS.paymentOperationStartAqsi, token, id),
    testComplete: (token, id, paymentMethod) =>
      invoke(IPC_CHANNELS.paymentOperationTestComplete, token, id, paymentMethod),
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
    archiveNote: async (token, noteId) => {
      await invoke(IPC_CHANNELS.studentNoteArchive, token, noteId);
    },
    create: (token, input) => invoke(IPC_CHANNELS.studentCreate, token, input),
    createNote: (token, studentId, input) =>
      invoke(IPC_CHANNELS.studentNoteCreate, token, studentId, input),
    get: (token, id) => invoke(IPC_CHANNELS.studentGet, token, id),
    getProfile: (token, id) => invoke(IPC_CHANNELS.studentProfileGet, token, id),
    list: (token, query) => invoke(IPC_CHANNELS.studentList, token, query),
    options: (token, branchId) => invoke(IPC_CHANNELS.studentOptions, token, branchId),
    update: (token, id, input) => invoke(IPC_CHANNELS.studentUpdate, token, id, input),
    updateNote: (token, noteId, input) =>
      invoke(IPC_CHANNELS.studentNoteUpdate, token, noteId, input),
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

const customerDisplay = process.argv.includes('--arava-customer-display');
if (customerDisplay) {
  const secretArgument = process.argv.find((argument) =>
    argument.startsWith('--arava-customer-secret='),
  );
  const secret = secretArgument?.slice('--arava-customer-secret='.length) ?? '';
  const viewApi: CustomerDisplayViewApi = {
    getState: () => invoke(IPC_CHANNELS.customerDisplayGetState, secret),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: CustomerDisplayState) =>
        listener(state);
      ipcRenderer.on(IPC_CHANNELS.customerDisplayStateChanged, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.customerDisplayStateChanged, handler);
    },
  };
  contextBridge.exposeInMainWorld('customerDisplayView', viewApi);
} else {
  contextBridge.exposeInMainWorld('arava', desktopApi);
}
