import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS, type AravaDesktopApi } from '@arava/shared/channels';

const invoke = <Result>(channel: string, ...arguments_: unknown[]) =>
  ipcRenderer.invoke(channel, ...arguments_) as Promise<Result>;

const desktopApi: AravaDesktopApi = {
  activity: { list: (token) => invoke(IPC_CHANNELS.activityList, token) },
  auth: {
    changePassword: (token, input) => invoke(IPC_CHANNELS.authChangePassword, token, input),
    login: (credentials) => invoke(IPC_CHANNELS.authLogin, credentials),
    logout: async (token) => {
      await invoke(IPC_CHANNELS.authLogout, token);
    },
    restore: (token) => invoke(IPC_CHANNELS.authRestore, token),
  },
  branches: {
    archive: (token, id) => invoke(IPC_CHANNELS.branchArchive, token, id),
    create: (token, input) => invoke(IPC_CHANNELS.branchCreate, token, input),
    list: (token, includeArchived) => invoke(IPC_CHANNELS.branchList, token, includeArchived),
    update: (token, id, input) => invoke(IPC_CHANNELS.branchUpdate, token, id, input),
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
  },
  attendance: {
    get: (token, lessonId) => invoke(IPC_CHANNELS.attendanceGet, token, lessonId),
    save: (token, lessonId, entries) =>
      invoke(IPC_CHANNELS.attendanceSave, token, lessonId, entries),
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
    staffOptions: (token) => invoke(IPC_CHANNELS.userStaffOptions, token),
    update: (token, id, input) => invoke(IPC_CHANNELS.userUpdate, token, id, input),
  },
};

contextBridge.exposeInMainWorld('arava', desktopApi);
