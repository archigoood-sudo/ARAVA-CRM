import { IPC_CHANNELS, settingKeySchema, settingUpdateSchema } from '@arava/shared';
import { app, ipcMain } from 'electron';

import type { DatabaseClient } from '@arava/database';
import type { ActivitySummary, DashboardStats, SettingKey, SystemInformation } from '@arava/shared';

export function registerIpcHandlers(database: DatabaseClient, databasePath: string): void {
  ipcMain.handle(IPC_CHANNELS.dashboardStats, async (): Promise<DashboardStats> => {
    const [contacts, companies, openOpportunities, pipeline] = await database.$transaction([
      database.contact.count(),
      database.company.count(),
      database.opportunity.count({ where: { stage: { notIn: ['won', 'lost'] } } }),
      database.opportunity.aggregate({
        _sum: { value: true },
        where: { stage: { not: 'lost' } },
      }),
    ]);

    return {
      companies,
      contacts,
      openOpportunities,
      pipelineValue: pipeline._sum.value ?? 0,
    };
  });

  ipcMain.handle(IPC_CHANNELS.activityList, async (): Promise<ActivitySummary[]> => {
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
  });

  ipcMain.handle(
    IPC_CHANNELS.settingsGet,
    async (_event, unsafeKey: unknown): Promise<string | null> => {
      const key: SettingKey = settingKeySchema.parse(unsafeKey);
      const setting = await database.appSetting.findUnique({ where: { key } });
      return setting?.value ?? null;
    },
  );

  ipcMain.handle(IPC_CHANNELS.settingsSet, async (_event, unsafeUpdate: unknown): Promise<void> => {
    const update = settingUpdateSchema.parse(unsafeUpdate);
    await database.appSetting.upsert({
      create: update,
      update: { value: update.value },
      where: { key: update.key },
    });
  });

  ipcMain.handle(IPC_CHANNELS.systemInformation, (): SystemInformation => {
    return {
      appVersion: app.getVersion(),
      databasePath,
      platform: process.platform,
    };
  });
}

export function removeIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}
