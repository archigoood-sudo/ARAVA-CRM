import {
  ApplicationService,
  accessibleBranchIds,
  assertPermission,
  type DatabaseClient,
} from '@arava/database';
import {
  IPC_CHANNELS,
  branchInputSchema,
  identifierSchema,
  loginCredentialsSchema,
  passwordChangeSchema,
  sessionTokenSchema,
  settingKeySchema,
  settingUpdateSchema,
  studentContactInputSchema,
  studentInputSchema,
  studentListQuerySchema,
  userCreateSchema,
  userUpdateSchema,
  type ActivitySummary,
  type DashboardStats,
  type SettingKey,
  type SystemInformation,
} from '@arava/shared';
import { app, ipcMain } from 'electron';

type IpcHandler = (...arguments_: unknown[]) => unknown;

export function createIpcHandlers(
  database: DatabaseClient,
  service: ApplicationService,
  databasePath: string,
): Record<string, IpcHandler> {
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

    [IPC_CHANNELS.userList]: (unsafeToken) =>
      service.listUsers(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.userCreate]: (unsafeToken, unsafeInput) =>
      service.createUser(
        sessionTokenSchema.parse(unsafeToken),
        userCreateSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.userUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      service.updateUser(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        userUpdateSchema.parse(unsafeInput),
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
      const studentScope = branchIds ? { branchId: { in: branchIds } } : {};
      const [branches, students, trialStudents, users] = await database.$transaction([
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
      ]);
      return { branches, students, trialStudents, users };
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
      if (update.key === 'general.workspaceName') assertPermission(actor, 'workspace:manage');
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
