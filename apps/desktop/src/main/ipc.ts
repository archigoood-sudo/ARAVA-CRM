import {
  ApplicationService,
  StudioService,
  accessibleBranchIds,
  assertPermission,
  type DatabaseClient,
} from '@arava/database';
import {
  IPC_CHANNELS,
  attendanceEntriesSchema,
  branchInputSchema,
  enrollmentInputSchema,
  groupInputSchema,
  groupListQuerySchema,
  identifierSchema,
  loginCredentialsSchema,
  lessonCancelInputSchema,
  lessonGenerateInputSchema,
  lessonInputSchema,
  lessonListQuerySchema,
  passwordChangeSchema,
  sessionTokenSchema,
  settingKeySchema,
  settingUpdateSchema,
  studentContactInputSchema,
  studentInputSchema,
  studentListQuerySchema,
  userCreateSchema,
  userUpdateSchema,
  weeklyScheduleInputSchema,
  weeklyScheduleQuerySchema,
  type ActivitySummary,
  type DashboardStats,
  type SettingKey,
  type SystemInformation,
} from '@arava/shared';
import { app, ipcMain } from 'electron';
import type { EnrollmentStatus } from '@prisma/client';

type IpcHandler = (...arguments_: unknown[]) => unknown;
const coachEnrollmentStatuses = ['ACTIVE', 'TRIAL', 'FROZEN'] satisfies EnrollmentStatus[];

export function createIpcHandlers(
  database: DatabaseClient,
  service: ApplicationService,
  databasePath: string,
): Record<string, IpcHandler> {
  const studio = new StudioService(database, service);
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
    [IPC_CHANNELS.userStaffOptions]: (unsafeToken) =>
      studio.listStaffOptions(sessionTokenSchema.parse(unsafeToken)),

    [IPC_CHANNELS.groupList]: (unsafeToken, unsafeQuery) =>
      studio.listGroups(
        sessionTokenSchema.parse(unsafeToken),
        groupListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.groupGet]: (unsafeToken, unsafeId) =>
      studio.getGroup(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.groupCreate]: (unsafeToken, unsafeInput) =>
      studio.createGroup(
        sessionTokenSchema.parse(unsafeToken),
        groupInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.groupUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      studio.updateGroup(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        groupInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.groupArchive]: (unsafeToken, unsafeId) =>
      studio.archiveGroup(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.enrollmentAdd]: (unsafeToken, unsafeGroupId, unsafeInput) =>
      studio.addEnrollment(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeGroupId),
        enrollmentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.enrollmentRemove]: (unsafeToken, unsafeGroupId, unsafeEnrollmentId) =>
      studio.removeEnrollment(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeGroupId),
        identifierSchema.parse(unsafeEnrollmentId),
      ),

    [IPC_CHANNELS.scheduleList]: (unsafeToken, unsafeQuery) =>
      studio.listSchedules(
        sessionTokenSchema.parse(unsafeToken),
        weeklyScheduleQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.scheduleCreate]: (unsafeToken, unsafeInput) =>
      studio.createSchedule(
        sessionTokenSchema.parse(unsafeToken),
        weeklyScheduleInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.scheduleUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      studio.updateSchedule(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        weeklyScheduleInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.scheduleDeactivate]: (unsafeToken, unsafeId) =>
      studio.deactivateSchedule(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),

    [IPC_CHANNELS.lessonList]: (unsafeToken, unsafeQuery) =>
      studio.listLessons(
        sessionTokenSchema.parse(unsafeToken),
        lessonListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.lessonGet]: (unsafeToken, unsafeId) =>
      studio.getLesson(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.lessonCreate]: (unsafeToken, unsafeInput) =>
      studio.createLesson(
        sessionTokenSchema.parse(unsafeToken),
        lessonInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.lessonUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      studio.updateLesson(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        lessonInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.lessonCancel]: (unsafeToken, unsafeId, unsafeInput) =>
      studio.cancelLesson(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        lessonCancelInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.lessonGenerate]: (unsafeToken, unsafeInput) =>
      studio.generateLessons(
        sessionTokenSchema.parse(unsafeToken),
        lessonGenerateInputSchema.parse(unsafeInput),
      ),

    [IPC_CHANNELS.attendanceGet]: (unsafeToken, unsafeLessonId) =>
      studio.getAttendance(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeLessonId),
      ),
    [IPC_CHANNELS.attendanceSave]: (unsafeToken, unsafeLessonId, unsafeEntries) =>
      studio.saveAttendance(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeLessonId),
        attendanceEntriesSchema.parse(unsafeEntries),
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
      const studentScope = {
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(actor.role === 'COACH'
          ? {
              enrollments: {
                some: {
                  group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] },
                  leftAt: null,
                  status: { in: coachEnrollmentStatuses },
                },
              },
            }
          : {}),
      };
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date();
      dayEnd.setHours(23, 59, 59, 999);
      const coachGroupScope =
        actor.role === 'COACH'
          ? { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] }
          : {};
      const [branches, students, trialStudents, users, groups, lessons] = await Promise.all([
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
        database.danceGroup.findMany({
          include: {
            _count: {
              select: {
                enrollments: {
                  where: { leftAt: null, status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] } },
                },
              },
            },
          },
          where: {
            archivedAt: null,
            status: { in: ['ACTIVE', 'RECRUITING'] },
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
            ...coachGroupScope,
          },
        }),
        database.lesson.findMany({
          include: {
            _count: { select: { attendance: true } },
            group: {
              include: {
                _count: {
                  select: {
                    enrollments: {
                      where: { leftAt: null, status: { in: ['ACTIVE', 'TRIAL'] } },
                    },
                  },
                },
              },
            },
          },
          where: {
            startsAt: { gte: dayStart, lte: dayEnd },
            status: { not: 'CANCELLED' },
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
            ...(actor.role === 'COACH'
              ? {
                  OR: [
                    { coachId: actor.id },
                    { group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] } },
                  ],
                }
              : {}),
          },
        }),
      ]);
      const expectedToday = lessons.reduce(
        (total, lesson) => total + lesson.group._count.enrollments,
        0,
      );
      const attendanceMarked = lessons.reduce(
        (total, lesson) => total + lesson._count.attendance,
        0,
      );
      return {
        activeGroups: groups.length,
        attendanceMarked,
        attendanceUnmarked: Math.max(0, expectedToday - attendanceMarked),
        branches,
        expectedToday,
        groupsWithPlaces: groups.filter((group) => group._count.enrollments < group.capacity)
          .length,
        lessonsToday: lessons.length,
        students,
        trialStudents,
        users,
      };
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
