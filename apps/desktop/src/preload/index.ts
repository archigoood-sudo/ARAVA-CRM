import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS, type AravaDesktopApi } from '@arava/shared/channels';

const desktopApi: AravaDesktopApi = {
  activity: {
    list: () =>
      ipcRenderer.invoke(IPC_CHANNELS.activityList) as Promise<
        Awaited<ReturnType<AravaDesktopApi['activity']['list']>>
      >,
  },
  dashboard: {
    stats: () =>
      ipcRenderer.invoke(IPC_CHANNELS.dashboardStats) as Promise<
        Awaited<ReturnType<AravaDesktopApi['dashboard']['stats']>>
      >,
  },
  settings: {
    get: (key) => ipcRenderer.invoke(IPC_CHANNELS.settingsGet, key) as Promise<string | null>,
    set: async (update) => {
      await ipcRenderer.invoke(IPC_CHANNELS.settingsSet, update);
    },
  },
  system: {
    information: () =>
      ipcRenderer.invoke(IPC_CHANNELS.systemInformation) as Promise<
        Awaited<ReturnType<AravaDesktopApi['system']['information']>>
      >,
  },
};

contextBridge.exposeInMainWorld('arava', desktopApi);
