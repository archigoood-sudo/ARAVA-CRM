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
    update: (token, id, input) => invoke(IPC_CHANNELS.userUpdate, token, id, input),
  },
};

contextBridge.exposeInMainWorld('arava', desktopApi);
