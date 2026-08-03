export const IPC_CHANNELS = {
  activityList: 'activity:list',
  dashboardStats: 'dashboard:stats',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  systemInformation: 'system:information',
} as const;

export interface DashboardStats {
  contacts: number;
  companies: number;
  openOpportunities: number;
  pipelineValue: number;
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
    list: () => Promise<ActivitySummary[]>;
  };
  dashboard: {
    stats: () => Promise<DashboardStats>;
  };
  settings: {
    get: (key: SettingKey) => Promise<string | null>;
    set: (update: SettingUpdate) => Promise<void>;
  };
  system: {
    information: () => Promise<SystemInformation>;
  };
}
