import type { AravaDesktopApi, SettingKey } from '@arava/shared';

const browserSettings = new Map<SettingKey, string>([['general.workspaceName', 'ARAVA Workspace']]);

const browserPreviewApi: AravaDesktopApi = {
  activity: {
    list: () =>
      Promise.resolve([
        {
          createdAt: new Date().toISOString(),
          detail: 'Your CRM workspace is ready for contacts, companies, and opportunities.',
          id: 'browser-preview',
          title: 'ARAVA CRM initialized',
        },
      ]),
  },
  dashboard: {
    stats: () =>
      Promise.resolve({
        companies: 0,
        contacts: 0,
        openOpportunities: 0,
        pipelineValue: 0,
      }),
  },
  settings: {
    get: (key) => Promise.resolve(browserSettings.get(key) ?? null),
    set: ({ key, value }) => {
      browserSettings.set(key, value);
      return Promise.resolve();
    },
  },
  system: {
    information: () =>
      Promise.resolve({
        appVersion: '0.1.0',
        databasePath: 'Available in the desktop application',
        platform: 'darwin',
      }),
  },
};

export function getDesktopApi(): AravaDesktopApi {
  return window.arava ?? browserPreviewApi;
}
