export const queryKeys = {
  activity: ['activity'] as const,
  dashboard: ['dashboard', 'stats'] as const,
  setting: (key: string) => ['settings', key] as const,
  system: ['system', 'information'] as const,
};
