import {
  ApplicationService,
  AttendanceWorkspaceService,
  ChatService,
  CalendarService,
  CardService,
  FinanceService,
  GlobalSearchService,
  LeadService,
  ManagementService,
  AqsiPaymentService,
  PaymentOperationService,
  PublicationService,
  StudioService,
  StudentProfileService,
  TrainerProfileService,
  AttentionService,
  BackupService,
  accessibleBranchIds,
  assertCapability,
  assertPermission,
  type DatabaseClient,
} from '@arava/database';
import {
  IPC_CHANNELS,
  attendanceEntriesSchema,
  attendanceWorkspaceDateSchema,
  chatListQuerySchema,
  chatSendInputSchema,
  calendarExceptionInputSchema,
  calendarRangeQuerySchema,
  barcodeSchema,
  analyticsQuerySchema,
  attentionFiltersSchema,
  branchInputSchema,
  cardActionInputSchema,
  cardAssignInputSchema,
  cardListQuerySchema,
  cardRegisterInputSchema,
  cardReplaceInputSchema,
  cashCorrectionInputSchema,
  cashRegisterInputSchema,
  cashTransactionQuerySchema,
  cashTransferInputSchema,
  copyDayInputSchema,
  enrollmentInputSchema,
  expenseCategoryInputSchema,
  expenseInputSchema,
  expenseListQuerySchema,
  forcedPasswordChangeSchema,
  groupInputSchema,
  groupListQuerySchema,
  globalSearchQuerySchema,
  identifierSchema,
  loginCredentialsSchema,
  ownerRecoverySchema,
  lessonCancelInputSchema,
  lessonGenerateInputSchema,
  lessonInputSchema,
  lessonListQuerySchema,
  leadCreateInputSchema,
  leadGroupAssignmentInputSchema,
  leadListQuerySchema,
  leadStudentConversionInputSchema,
  leadStatusSchema,
  passwordChangeSchema,
  paymentInputSchema,
  paymentListQuerySchema,
  paymentMethodSchema,
  paymentOperationCreateSchema,
  paymentOperationReasonSchema,
  publicationInputSchema,
  payrollAdjustmentInputSchema,
  payrollPaymentInputSchema,
  payrollPeriodInputSchema,
  payrollRuleInputSchema,
  refundInputSchema,
  reportQuerySchema,
  roomClosureInputSchema,
  roomInputSchema,
  roomRentalInputSchema,
  sessionTokenSchema,
  settingKeySchema,
  settingUpdateSchema,
  studentContactInputSchema,
  studentInputSchema,
  studentListQuerySchema,
  studentNoteInputSchema,
  subscriptionAdjustmentInputSchema,
  subscriptionCreateInputSchema,
  subscriptionFreezeInputSchema,
  tariffInputSchema,
  tariffListQuerySchema,
  trainerSubstitutionInputSchema,
  userCreateSchema,
  userUpdateSchema,
  weeklyScheduleInputSchema,
  weeklyScheduleQuerySchema,
  type ActivitySummary,
  type AuditLogSummary,
  type DashboardStats,
  type AttentionItem,
  type AttentionSummary,
  type SettingKey,
  type SystemInformation,
} from '@arava/shared';
import { app, dialog, ipcMain, shell } from 'electron';
import { basename, dirname, extname, join } from 'node:path';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { EnrollmentStatus } from '@prisma/client';
import { z } from 'zod';
import { getBuildMetadata } from './build-metadata';
import type { CustomerDisplayManager } from './customer-display-manager';
import type { IntegrationManager } from './integration-manager';

type IpcHandler = (...arguments_: unknown[]) => unknown;
const coachEnrollmentStatuses = ['ACTIVE', 'TRIAL', 'FROZEN'] satisfies EnrollmentStatus[];
const customerDisplaySettingsSchema = z.object({
  customerSeconds: z.number().int().min(3).max(300),
  displayId: z.string().trim().min(1).optional(),
  enabled: z.boolean(),
  fullscreen: z.boolean(),
  showLastName: z.boolean(),
  slideSeconds: z.number().int().min(3).max(300),
});
const customerDisplaySlideSchema = z.object({
  displaySeconds: z.number().int().min(3).max(300).optional(),
  id: z.string().min(1).optional(),
  isActive: z.boolean(),
  mediaId: z
    .string()
    .regex(/^[\da-f-]+\.(?:jpe?g|png|webp)$/iu)
    .optional(),
  text: z.string().trim().max(500).optional(),
  title: z.string().trim().min(1).max(120),
});
const integrationSettingsSchema = z.object({
  baseUrl: z.string().trim().max(500),
  enabled: z.boolean(),
});
const integrationPairSchema = integrationSettingsSchema.extend({
  pairingCode: z.string().trim().min(6).max(128),
});
const integrationRenameSchema = z.object({
  deviceId: z.string().trim().min(1),
  displayName: z.string().trim().min(1).max(64),
});
const integrationConflictResolutionSchema = z.object({
  expectedCanonicalRevision: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(160),
  resolution: z.enum(['KEEP_CANONICAL', 'ACCEPT_CANDIDATE']),
});

export interface BackupIpcDependencies {
  backup?: BackupService;
  chooseBackupFile?: () => Promise<string | undefined>;
  chooseBackupFolder?: () => Promise<string | undefined>;
  chooseExportPath?: (defaultPath: string) => Promise<string | undefined>;
  openFolder?: (path: string) => Promise<void>;
  relaunch?: () => void;
  customerDisplay?: CustomerDisplayManager;
  integration?: IntegrationManager;
}

export function createIpcHandlers(
  database: DatabaseClient,
  service: ApplicationService,
  databasePath: string,
  backupDependencies: BackupIpcDependencies = {},
): Record<string, IpcHandler> {
  const studio = new StudioService(database, service);
  const attendanceWorkspace = new AttendanceWorkspaceService(database, service);
  const finance = new FinanceService(database, service);
  const paymentOperations = new PaymentOperationService(database, service);
  const management = new ManagementService(database, service);
  const calendar = new CalendarService(database, service);
  const cards = new CardService(database, service);
  const search = new GlobalSearchService(database, service);
  const studentProfiles = new StudentProfileService(database, service);
  const trainerProfiles = new TrainerProfileService(database, service);
  const attention = new AttentionService(database, service);
  const publications = new PublicationService(database, service);
  const backups =
    backupDependencies.backup ??
    new BackupService(database, service, {
      databasePath,
      defaultBackupDirectory: join(dirname(databasePath), 'backups'),
      externalLogPath: join(dirname(databasePath), 'backup-restore.log'),
    });
  const integration = backupDependencies.integration?.service;
  const aqsiPayments = integration
    ? new AqsiPaymentService(paymentOperations, integration)
    : undefined;
  const chats = integration ? new ChatService(database, service, integration) : undefined;
  const leads = integration ? new LeadService(database, service, integration, studio) : undefined;
  const requireIntegration = () => {
    if (!integration) throw new Error('Сервис интеграции не инициализирован.');
    return integration;
  };
  const requireChats = () => {
    if (!chats) throw new Error('Сервис чатов не инициализирован.');
    return chats;
  };
  const requireLeads = () => {
    if (!leads) throw new Error('Сервис заявок не инициализирован.');
    return leads;
  };
  const requireAqsiPayments = () => {
    if (!aqsiPayments) throw new Error('Сервис оплаты через aQsi не инициализирован.');
    return aqsiPayments;
  };
  const paymentManagerToken = async (unsafeToken: unknown) => {
    const token = sessionTokenSchema.parse(unsafeToken);
    assertPermission(await service.authenticate(token), 'payments:manage');
    return token;
  };
  const publicationMediaDirectory = join(dirname(databasePath), 'media', 'publications');
  const publicationMedia = (mediaId?: string) => {
    if (!mediaId) return undefined;
    if (!/^[\da-f-]+\.(?:jpe?g|png|webp)$/iu.test(mediaId))
      throw new Error('Некорректное изображение публикации.');
    const extension = extname(mediaId).toLowerCase();
    return {
      contentType:
        extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg',
      fileName: mediaId,
      localPath: join(publicationMediaDirectory, mediaId),
    };
  };
  return {
    [IPC_CHANNELS.authLogin]: (unsafeCredentials) =>
      service.login(loginCredentialsSchema.parse(unsafeCredentials)),
    [IPC_CHANNELS.authRestore]: (unsafeToken) =>
      service.restoreSession(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.authLogout]: async (unsafeToken) => {
      const token = sessionTokenSchema.parse(unsafeToken);
      await backupDependencies.customerDisplay?.returnToPromo();
      await service.logout(token);
      chats?.clearAuthorizationCache();
    },
    [IPC_CHANNELS.authChangePassword]: (unsafeToken, unsafeInput) =>
      service.changePassword(
        sessionTokenSchema.parse(unsafeToken),
        passwordChangeSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.authCompletePasswordChange]: (unsafeToken, unsafeInput) =>
      service.completePasswordChange(
        sessionTokenSchema.parse(unsafeToken),
        forcedPasswordChangeSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.authRecoverOwner]: (unsafeInput) =>
      service.recoverOwner(ownerRecoverySchema.parse(unsafeInput)),

    [IPC_CHANNELS.userList]: (unsafeToken) =>
      service.listUsers(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.userCreate]: (unsafeToken, unsafeInput) =>
      service.createUserWithTemporaryPassword(
        sessionTokenSchema.parse(unsafeToken),
        userCreateSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.userUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      service.updateUser(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        userUpdateSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.userResetPassword]: (unsafeToken, unsafeId) =>
      service.resetUserPassword(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.userRevokeSessions]: (unsafeToken, unsafeId) =>
      service.revokeUserSessions(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.userRecoveryCodeStatus]: (unsafeToken) =>
      service.recoveryCodeStatus(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.userRecoveryCodeCreate]: (unsafeToken) =>
      service.createRecoveryCode(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.userStaffOptions]: (unsafeToken) =>
      studio.listStaffOptions(sessionTokenSchema.parse(unsafeToken)),

    [IPC_CHANNELS.globalSearch]: (unsafeToken, unsafeQuery) =>
      search.search(
        sessionTokenSchema.parse(unsafeToken),
        globalSearchQuerySchema.parse(unsafeQuery),
      ),

    [IPC_CHANNELS.chatList]: (unsafeToken, unsafeQuery) =>
      requireChats().list(
        sessionTokenSchema.parse(unsafeToken),
        chatListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.chatGet]: (unsafeToken, unsafeConversationId) =>
      requireChats().get(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeConversationId),
      ),
    [IPC_CHANNELS.chatImage]: (unsafeToken, unsafeConversationId, unsafeAttachmentId) =>
      requireChats().image(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeConversationId),
        identifierSchema.parse(unsafeAttachmentId),
      ),
    [IPC_CHANNELS.chatMessages]: (unsafeToken, unsafeConversationId, unsafeBefore) =>
      requireChats().messages(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeConversationId),
        unsafeBefore === undefined ? undefined : identifierSchema.parse(unsafeBefore),
      ),
    [IPC_CHANNELS.chatRead]: (unsafeToken, unsafeConversationId) =>
      requireChats().markRead(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeConversationId),
      ),
    [IPC_CHANNELS.chatSend]: (unsafeToken, unsafeConversationId, unsafeInput) =>
      requireChats().send(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeConversationId),
        chatSendInputSchema.parse(unsafeInput),
      ),

    [IPC_CHANNELS.leadList]: (unsafeToken, unsafeQuery) =>
      requireLeads().list(
        sessionTokenSchema.parse(unsafeToken),
        leadListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.leadGet]: (unsafeToken, unsafeId) =>
      requireLeads().get(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.leadAssignGroup]: (unsafeToken, unsafeId, unsafeInput) =>
      requireLeads().assignGroup(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        leadGroupAssignmentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.leadCreate]: (unsafeToken, unsafeInput) =>
      requireLeads().create(
        sessionTokenSchema.parse(unsafeToken),
        leadCreateInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.leadUpdateStatus]: (unsafeToken, unsafeId, unsafeStatus) =>
      requireLeads().updateStatus(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        leadStatusSchema.parse(unsafeStatus),
      ),
    [IPC_CHANNELS.leadConvert]: (unsafeToken, unsafeId, unsafeStudentId) =>
      requireLeads().convert(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        identifierSchema.parse(unsafeStudentId),
      ),
    [IPC_CHANNELS.leadCreateStudent]: (unsafeToken, unsafeId, unsafeInput) =>
      requireLeads().createStudent(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        leadStudentConversionInputSchema.parse(unsafeInput),
      ),

    [IPC_CHANNELS.publicationList]: (unsafeToken) =>
      publications.list(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.publicationOptions]: (unsafeToken) =>
      publications.options(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.publicationCreate]: (unsafeToken, unsafeInput) => {
      const input = publicationInputSchema.parse(unsafeInput);
      return publications.create(
        sessionTokenSchema.parse(unsafeToken),
        input,
        publicationMedia(input.mediaId),
      );
    },
    [IPC_CHANNELS.publicationUpdate]: (unsafeToken, unsafeId, unsafeInput) => {
      const input = publicationInputSchema.parse(unsafeInput);
      return publications.update(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        input,
        publicationMedia(input.mediaId),
      );
    },
    [IPC_CHANNELS.publicationPublish]: (unsafeToken, unsafeId) =>
      publications.publish(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.publicationArchive]: (unsafeToken, unsafeId) =>
      publications.archive(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.publicationRetry]: (unsafeToken, unsafeId) =>
      publications.retry(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.publicationSelectImage]: async (unsafeToken) => {
      await publications.options(sessionTokenSchema.parse(unsafeToken));
      const selection = await dialog.showOpenDialog({
        filters: [{ extensions: ['jpg', 'jpeg', 'png', 'webp'], name: 'Изображения' }],
        properties: ['openFile'],
        title: 'Выберите изображение публикации',
      });
      const source = selection.filePaths[0];
      if (selection.canceled || !source) return undefined;
      const bytes = await readFile(source);
      if (!bytes.length || bytes.length > 10 * 1024 * 1024)
        throw new Error('Изображение должно быть не больше 10 МБ.');
      const extension = extname(source).toLowerCase();
      const signatureValid =
        (extension === '.png' &&
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        ((extension === '.jpg' || extension === '.jpeg') &&
          bytes.length >= 3 &&
          bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255) ||
        (extension === '.webp' &&
          bytes.length >= 12 &&
          bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
          bytes.subarray(8, 12).toString('ascii') === 'WEBP');
      if (!signatureValid)
        throw new Error('Содержимое файла не соответствует формату изображения.');
      const mediaId = `${randomUUID()}${extension}`;
      await mkdir(publicationMediaDirectory, { recursive: true });
      await copyFile(source, join(publicationMediaDirectory, mediaId));
      return { fileName: basename(source), mediaId };
    },

    [IPC_CHANNELS.integrationGetStatus]: (unsafeToken) =>
      requireIntegration().getStatus(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.integrationDiagnose]: (unsafeToken) =>
      requireIntegration().diagnose(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.integrationUpdateSettings]: (unsafeToken, unsafeInput) =>
      requireIntegration().updateSettings(
        sessionTokenSchema.parse(unsafeToken),
        integrationSettingsSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.integrationPair]: (unsafeToken, unsafeInput) =>
      requireIntegration().pair(
        sessionTokenSchema.parse(unsafeToken),
        integrationPairSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.integrationRenameDevice]: (unsafeToken, unsafeId, unsafeInput) =>
      requireIntegration().renameDevice(
        sessionTokenSchema.parse(unsafeToken),
        integrationRenameSchema.parse({
          ...(typeof unsafeInput === 'object' && unsafeInput ? unsafeInput : {}),
          deviceId: String(unsafeId),
        }),
      ),
    [IPC_CHANNELS.integrationRevokeDevice]: (unsafeToken, unsafeId) =>
      requireIntegration().revokeDevice(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.integrationListConflicts]: (unsafeToken) =>
      requireIntegration().listConflicts(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.integrationResolveConflict]: (unsafeToken, unsafeId, unsafeInput) =>
      requireIntegration().resolveConflict(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        integrationConflictResolutionSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.integrationRecoverFromServer]: (unsafeToken) =>
      requireIntegration().recoverFromServer(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.integrationReconciliationPreview]: (unsafeToken) =>
      requireIntegration().reconciliationPreview(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.integrationConfirmReconciliation]: (unsafeToken) =>
      requireIntegration().confirmReconciliation(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.integrationPruneJournal]: (unsafeToken) =>
      requireIntegration().pruneJournal(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.integrationTestConnection]: (unsafeToken) =>
      requireIntegration().testConnection(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.integrationSyncNow]: (unsafeToken) =>
      requireIntegration().syncNow(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.integrationListLog]: (unsafeToken) =>
      requireIntegration().listLog(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.integrationPrepareInitialSync]: (unsafeToken) =>
      requireIntegration().prepareInitialSync(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.integrationConfirmInitialSync]: (unsafeToken) =>
      requireIntegration().confirmInitialSync(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.clientAccessStatus]: (unsafeToken, unsafeStudentId, unsafePhones) =>
      requireIntegration().getClientAccessStatus(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
        z.array(z.string().trim().min(1).max(40)).max(20).parse(unsafePhones),
      ),
    [IPC_CHANNELS.clientAccessIssue]: (unsafeToken, unsafeStudentId, unsafeInput) =>
      requireIntegration().issueClientAccess(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
        z
          .object({
            displayName: z.string().trim().min(2).max(120),
            phone: z.string().trim().min(5).max(40),
          })
          .strict()
          .parse(unsafeInput),
      ),
    [IPC_CHANNELS.clientAccessReissue]: (unsafeToken, unsafeStudentId) =>
      requireIntegration().reissueClientAccess(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
      ),
    [IPC_CHANNELS.clientAccessLink]: (unsafeToken, unsafeStudentId, unsafeAccountId) =>
      requireIntegration().linkClientAccess(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
        identifierSchema.parse(unsafeAccountId),
      ),
    [IPC_CHANNELS.clientAccessRevoke]: (unsafeToken, unsafeStudentId) =>
      requireIntegration().revokeClientAccess(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
      ),
    [IPC_CHANNELS.webActionList]: (unsafeToken) =>
      requireIntegration().listWebActions(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.webActionApprove]: (unsafeToken, unsafeId, unsafeInput) =>
      requireIntegration().approveWebAction(
        sessionTokenSchema.parse(unsafeToken),
        z.string().min(1).parse(unsafeId),
        subscriptionFreezeInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.webActionReject]: (unsafeToken, unsafeId, unsafeReason) =>
      requireIntegration().rejectWebAction(
        sessionTokenSchema.parse(unsafeToken),
        z.string().min(1).parse(unsafeId),
        z.string().trim().max(300).optional().parse(unsafeReason),
      ),

    [IPC_CHANNELS.cardList]: (unsafeToken, unsafeQuery) =>
      cards.listCards(
        sessionTokenSchema.parse(unsafeToken),
        cardListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.cardFind]: (unsafeToken, unsafeBarcode) =>
      cards.findCard(sessionTokenSchema.parse(unsafeToken), barcodeSchema.parse(unsafeBarcode)),
    [IPC_CHANNELS.cardRegister]: (unsafeToken, unsafeInput) =>
      cards.registerCard(
        sessionTokenSchema.parse(unsafeToken),
        cardRegisterInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cardAssign]: (unsafeToken, unsafeInput) =>
      cards.assignCard(
        sessionTokenSchema.parse(unsafeToken),
        cardAssignInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cardUnassign]: (unsafeToken, unsafeId, unsafeInput) =>
      cards.unassignCard(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        cardActionInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cardBlock]: (unsafeToken, unsafeId, unsafeInput) =>
      cards.blockCard(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        cardActionInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cardReactivate]: (unsafeToken, unsafeId, unsafeInput) =>
      cards.reactivateCard(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        cardActionInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cardMarkLost]: (unsafeToken, unsafeId, unsafeInput) =>
      cards.markLost(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        cardActionInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cardArchive]: (unsafeToken, unsafeId, unsafeInput) =>
      cards.archiveCard(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        cardActionInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cardReplace]: (unsafeToken, unsafeInput) =>
      cards.replaceCard(
        sessionTokenSchema.parse(unsafeToken),
        cardReplaceInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cardResolveScan]: async (unsafeToken, unsafeBarcode) => {
      const token = sessionTokenSchema.parse(unsafeToken);
      const result = await cards.resolveScan(token, barcodeSchema.parse(unsafeBarcode));
      if (result.result === 'OPENED' && result.studentId)
        await backupDependencies.customerDisplay?.showStudentForScan(token, result.studentId);
      return result;
    },
    [IPC_CHANNELS.customerDisplayGetStatus]: (unsafeToken) =>
      backupDependencies.customerDisplay?.getStatus(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.customerDisplayUpdateSettings]: (unsafeToken, unsafeSettings) =>
      backupDependencies.customerDisplay?.updateSettings(
        sessionTokenSchema.parse(unsafeToken),
        customerDisplaySettingsSchema.parse(unsafeSettings),
      ),
    [IPC_CHANNELS.customerDisplayOpen]: (unsafeToken) =>
      backupDependencies.customerDisplay?.open(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.customerDisplayClose]: (unsafeToken) =>
      backupDependencies.customerDisplay?.close(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.customerDisplayPreview]: (unsafeToken) =>
      backupDependencies.customerDisplay?.openPreview(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.customerDisplayReturnToPromo]: (unsafeToken) =>
      backupDependencies.customerDisplay?.returnToPromo(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.customerDisplaySelectImage]: (unsafeToken) =>
      backupDependencies.customerDisplay?.selectImage(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.customerDisplaySaveSlide]: (unsafeToken, unsafeInput) =>
      backupDependencies.customerDisplay?.saveSlide(
        sessionTokenSchema.parse(unsafeToken),
        customerDisplaySlideSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.customerDisplayDeleteSlide]: (unsafeToken, unsafeId) =>
      backupDependencies.customerDisplay?.deleteSlide(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.customerDisplayMoveSlide]: (unsafeToken, unsafeId, unsafeDirection) =>
      backupDependencies.customerDisplay?.moveSlide(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        z.enum(['UP', 'DOWN']).parse(unsafeDirection),
      ),
    [IPC_CHANNELS.customerDisplayGetState]: (unsafeSecret) =>
      backupDependencies.customerDisplay?.getDisplayState(z.string().uuid().parse(unsafeSecret)),
    [IPC_CHANNELS.cardHistory]: (unsafeToken, unsafeId) =>
      cards.cardHistory(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.cardScanHistory]: (unsafeToken, unsafeId) =>
      cards.scanHistory(
        sessionTokenSchema.parse(unsafeToken),
        unsafeId === undefined ? undefined : identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.cardStudentCurrent]: (unsafeToken, unsafeStudentId) =>
      cards.currentStudentCard(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
      ),

    [IPC_CHANNELS.roomList]: (unsafeToken, unsafeBranchId, unsafeIncludeArchived) =>
      calendar.listRooms(
        sessionTokenSchema.parse(unsafeToken),
        unsafeBranchId === undefined ? undefined : identifierSchema.parse(unsafeBranchId),
        unsafeIncludeArchived === true,
      ),
    [IPC_CHANNELS.roomCreate]: (unsafeToken, unsafeInput) =>
      calendar.createRoom(
        sessionTokenSchema.parse(unsafeToken),
        roomInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.roomUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      calendar.updateRoom(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        roomInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.roomArchive]: (unsafeToken, unsafeId) =>
      calendar.archiveRoom(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.roomAvailability]: (unsafeToken, unsafeRoomId, unsafeDate) =>
      calendar.availability(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeRoomId),
        z.string().date().parse(unsafeDate),
      ),
    [IPC_CHANNELS.roomUtilization]: (unsafeToken, unsafeRoomId, unsafeDateFrom, unsafeDateTo) =>
      calendar.utilization(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeRoomId),
        z.string().datetime({ offset: true }).parse(unsafeDateFrom),
        z.string().datetime({ offset: true }).parse(unsafeDateTo),
      ),
    [IPC_CHANNELS.rentalList]: (unsafeToken, unsafeQuery) =>
      calendar.listRentals(
        sessionTokenSchema.parse(unsafeToken),
        calendarRangeQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.rentalCreate]: (unsafeToken, unsafeInput) =>
      calendar.createRental(
        sessionTokenSchema.parse(unsafeToken),
        roomRentalInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.rentalUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      calendar.updateRental(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        roomRentalInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.rentalCancel]: (unsafeToken, unsafeId) =>
      calendar.cancelRental(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.closurePreview]: (unsafeToken, unsafeInput) =>
      calendar.previewClosure(
        sessionTokenSchema.parse(unsafeToken),
        roomClosureInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.closureCreate]: (unsafeToken, unsafeInput) =>
      calendar.createClosure(
        sessionTokenSchema.parse(unsafeToken),
        roomClosureInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.closureList]: (unsafeToken, unsafeQuery) =>
      calendar.listClosures(
        sessionTokenSchema.parse(unsafeToken),
        calendarRangeQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.calendarExceptionCreate]: (unsafeToken, unsafeInput) =>
      calendar.createException(
        sessionTokenSchema.parse(unsafeToken),
        calendarExceptionInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.calendarExceptionList]: (unsafeToken, unsafeQuery) =>
      calendar.listExceptions(
        sessionTokenSchema.parse(unsafeToken),
        calendarRangeQuerySchema.parse(unsafeQuery),
      ),

    [IPC_CHANNELS.groupList]: (unsafeToken, unsafeQuery) =>
      studio.listGroups(
        sessionTokenSchema.parse(unsafeToken),
        groupListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.groupGet]: (unsafeToken, unsafeId) =>
      studio.getGroup(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.enrollmentEligibleGroups]: (unsafeToken, unsafeStudentId) =>
      studio.listEligibleGroupsForStudent(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
      ),
    [IPC_CHANNELS.enrollmentEligibleStudents]: (unsafeToken, unsafeGroupId) =>
      studio.listEligibleStudentsForGroup(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeGroupId),
      ),
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
    [IPC_CHANNELS.lessonCopyDay]: (unsafeToken, unsafeInput) =>
      calendar.copyDay(
        sessionTokenSchema.parse(unsafeToken),
        copyDayInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.substitutionAssign]: (unsafeToken, unsafeId, unsafeInput) =>
      calendar.assignSubstitution(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        trainerSubstitutionInputSchema.parse(unsafeInput),
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
    [IPC_CHANNELS.attendanceToday]: (unsafeToken, unsafeDate) =>
      attendanceWorkspace.today(
        sessionTokenSchema.parse(unsafeToken),
        attendanceWorkspaceDateSchema.parse(unsafeDate),
      ),
    [IPC_CHANNELS.attendanceScanOptions]: (unsafeToken, unsafeStudentId, unsafeDate) =>
      attendanceWorkspace.scanOptions(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
        attendanceWorkspaceDateSchema.parse(unsafeDate),
      ),

    [IPC_CHANNELS.tariffList]: (unsafeToken, unsafeQuery) =>
      finance.listTariffs(
        sessionTokenSchema.parse(unsafeToken),
        tariffListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.tariffGet]: (unsafeToken, unsafeId) =>
      finance.getTariff(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.tariffCreate]: (unsafeToken, unsafeInput) =>
      finance.createTariff(
        sessionTokenSchema.parse(unsafeToken),
        tariffInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.tariffUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      finance.updateTariff(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        tariffInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.tariffArchive]: (unsafeToken, unsafeId) =>
      finance.archiveTariff(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),

    [IPC_CHANNELS.subscriptionCreate]: (unsafeToken, unsafeInput) =>
      finance.createSubscription(
        sessionTokenSchema.parse(unsafeToken),
        subscriptionCreateInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.subscriptionListStudent]: (unsafeToken, unsafeStudentId) =>
      finance.listStudentSubscriptions(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
      ),
    [IPC_CHANNELS.subscriptionGet]: (unsafeToken, unsafeId) =>
      finance.getSubscription(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.subscriptionFreeze]: (unsafeToken, unsafeId, unsafeInput) =>
      finance.freezeSubscription(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        subscriptionFreezeInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.subscriptionUnfreeze]: (unsafeToken, unsafeId) =>
      finance.unfreezeSubscription(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.subscriptionAdjust]: (unsafeToken, unsafeId, unsafeInput) =>
      finance.adjustSubscription(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        subscriptionAdjustmentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.subscriptionCancel]: (unsafeToken, unsafeId) =>
      finance.cancelSubscription(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),

    [IPC_CHANNELS.paymentCreate]: (unsafeToken, unsafeInput) =>
      finance.createPayment(
        sessionTokenSchema.parse(unsafeToken),
        paymentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.paymentList]: (unsafeToken, unsafeQuery) =>
      finance.listPayments(
        sessionTokenSchema.parse(unsafeToken),
        paymentListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.paymentGet]: (unsafeToken, unsafeId) =>
      finance.getPayment(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.paymentCancel]: (unsafeToken, unsafeId) =>
      finance.cancelPayment(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.paymentOperationCreate]: (unsafeToken, unsafeInput) =>
      paymentOperations.create(
        sessionTokenSchema.parse(unsafeToken),
        paymentOperationCreateSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.paymentOperationGet]: (unsafeToken, unsafeId) =>
      paymentOperations.get(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.paymentOperationListStudent]: (unsafeToken, unsafeStudentId) =>
      paymentOperations.listStudent(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
      ),
    [IPC_CHANNELS.paymentOperationCancel]: (unsafeToken, unsafeId, unsafeInput) =>
      paymentOperations.cancel(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        paymentOperationReasonSchema.parse(unsafeInput).reason,
      ),
    [IPC_CHANNELS.paymentOperationSbpHealth]: async (unsafeToken) => {
      const token = await paymentManagerToken(unsafeToken);
      return process.env.ARAVA_E2E_PAYMENT_PROVIDER === 'memory'
        ? {
            configured: true,
            deviceConfigured: true,
            apiReachable: true,
            provider: 'AQSI_SBP' as const,
            selectedDeviceId: 101,
            selectedDeviceName: 'aQsi 5Ф · E2E-001',
          }
        : requireAqsiPayments().health(token);
    },
    [IPC_CHANNELS.paymentOperationSbpDevices]: async (unsafeToken) => {
      const token = sessionTokenSchema.parse(unsafeToken);
      if (process.env.ARAVA_E2E_PAYMENT_PROVIDER === 'memory') {
        const actor = await service.authenticate(token);
        if (actor.role !== 'OWNER') throw new Error('Настраивать кассу может только владелец.');
        return {
          devices: [
            {
              deviceId: 101,
              model: 'aQsi 5Ф',
              name: 'aQsi 5Ф · E2E-001',
              selected: true,
              serialNumber: 'E2E-001',
            },
          ],
          selectedDeviceId: 101,
        };
      }
      return requireIntegration().listAqsiDevices(token);
    },
    [IPC_CHANNELS.paymentOperationSbpSelectDevice]: async (unsafeToken, unsafeDeviceId) => {
      const token = sessionTokenSchema.parse(unsafeToken);
      const deviceId = Number(unsafeDeviceId);
      if (!Number.isSafeInteger(deviceId) || deviceId < 1)
        throw new Error('Некорректная касса aQsi.');
      if (process.env.ARAVA_E2E_PAYMENT_PROVIDER === 'memory') {
        const actor = await service.authenticate(token);
        if (actor.role !== 'OWNER') throw new Error('Настраивать кассу может только владелец.');
        return {
          deviceId,
          model: 'aQsi 5Ф',
          name: 'aQsi 5Ф · E2E-001',
          selected: true,
          serialNumber: 'E2E-001',
        };
      }
      return requireIntegration().selectAqsiDevice(token, deviceId);
    },
    [IPC_CHANNELS.paymentOperationStartSbp]: async (unsafeToken, unsafeId) => {
      const token = await paymentManagerToken(unsafeToken);
      const id = identifierSchema.parse(unsafeId);
      if (process.env.ARAVA_E2E_PAYMENT_PROVIDER !== 'memory')
        return requireAqsiPayments().start(token, id);
      const operation = await paymentOperations.get(token, id);
      if (operation.status === 'CREATED')
        await paymentOperations.transition(
          token,
          id,
          'WAITING_FOR_PAYMENT',
          undefined,
          `e2e-${id}`,
        );
      return {
        amountKopecks: operation.amount,
        aravaOperationId: id,
        currency: 'RUB' as const,
        deviceId: 101,
        provider: 'AQSI_SBP' as const,
        providerOperationId: `e2e-${id}`,
        status: 'WAITING' as const,
        updatedAt: new Date().toISOString(),
      };
    },
    [IPC_CHANNELS.paymentOperationRefreshSbp]: async (unsafeToken, unsafeId) => {
      const token = await paymentManagerToken(unsafeToken);
      const id = identifierSchema.parse(unsafeId);
      if (process.env.ARAVA_E2E_PAYMENT_PROVIDER !== 'memory')
        return requireAqsiPayments().refresh(token, id);
      const operation = await paymentOperations.get(token, id);
      await paymentOperations.finalizeTrusted(id, {
        paymentMethod: 'SBP',
        providerOperationId: operation.providerOperationId,
      });
      return {
        amountKopecks: operation.amount,
        aravaOperationId: id,
        currency: 'RUB' as const,
        deviceId: 101,
        provider: 'AQSI_SBP' as const,
        providerOperationId: operation.providerOperationId,
        providerResultId: `slip-${id}`,
        status: 'SUCCEEDED' as const,
        updatedAt: new Date().toISOString(),
      };
    },
    [IPC_CHANNELS.paymentOperationCancelSbp]: async (unsafeToken, unsafeId) => {
      const token = await paymentManagerToken(unsafeToken);
      const id = identifierSchema.parse(unsafeId);
      if (process.env.ARAVA_E2E_PAYMENT_PROVIDER !== 'memory')
        return requireAqsiPayments().cancel(token, id);
      const operation = await paymentOperations.get(token, id);
      if (operation.status !== 'SUCCEEDED')
        await paymentOperations.cancel(token, id, 'Ожидание оплаты отменено пользователем.');
      return {
        amountKopecks: operation.amount,
        aravaOperationId: id,
        currency: 'RUB' as const,
        deviceId: 101,
        provider: 'AQSI_SBP' as const,
        providerOperationId: operation.providerOperationId,
        status: 'CANCELLED' as const,
        updatedAt: new Date().toISOString(),
      };
    },
    [IPC_CHANNELS.paymentOperationStartAqsi]: async (unsafeToken, unsafeId) => {
      const token = await paymentManagerToken(unsafeToken);
      const id = identifierSchema.parse(unsafeId);
      if (process.env.ARAVA_E2E_PAYMENT_PROVIDER !== 'memory')
        return requireAqsiPayments().start(token, id);
      const operation = await paymentOperations.get(token, id);
      if (operation.providerType !== 'SBP' && operation.providerType !== 'ACQUIRING')
        throw new Error('Операция не предназначена для оплаты через aQsi.');
      if (operation.status === 'CREATED')
        await paymentOperations.transition(
          token,
          id,
          'WAITING_FOR_PAYMENT',
          undefined,
          `e2e-${id}`,
        );
      return {
        amountKopecks: operation.amount,
        aravaOperationId: id,
        currency: 'RUB' as const,
        deviceId: 101,
        provider:
          operation.providerType === 'ACQUIRING' ? ('AQSI_CARD' as const) : ('AQSI_SBP' as const),
        providerOperationId: `e2e-${id}`,
        status: 'WAITING' as const,
        updatedAt: new Date().toISOString(),
      };
    },
    [IPC_CHANNELS.paymentOperationRefreshAqsi]: async (unsafeToken, unsafeId) => {
      const token = await paymentManagerToken(unsafeToken);
      const id = identifierSchema.parse(unsafeId);
      if (process.env.ARAVA_E2E_PAYMENT_PROVIDER !== 'memory')
        return requireAqsiPayments().refresh(token, id);
      const operation = await paymentOperations.get(token, id);
      const isCard = operation.providerType === 'ACQUIRING';
      const fiscalCompleted = operation.status === 'SUCCEEDED';
      const fiscalError = fiscalCompleted && operation.purpose === 'Исторический чек с ошибкой';
      if (!fiscalCompleted)
        await paymentOperations.finalizeTrusted(id, {
          paymentMethod: isCard ? 'ACQUIRING' : 'SBP',
          providerOperationId: operation.providerOperationId,
          providerResultId: `slip-${id}`,
        });
      return {
        amountKopecks: operation.amount,
        aravaOperationId: id,
        currency: 'RUB' as const,
        deviceId: 101,
        fiscalReceipt: {
          canRetry: fiscalError,
          ...(fiscalCompleted && !fiscalError
            ? { fiscalDocumentNumber: 42, fiscalSign: '987654321' }
            : {}),
          ...(fiscalError ? { message: 'Тестовая временная ошибка фискализации.' } : {}),
          status: fiscalError
            ? ('ERROR' as const)
            : fiscalCompleted
              ? ('SUCCEEDED' as const)
              : ('PROCESSING' as const),
          updatedAt: new Date().toISOString(),
        },
        provider: isCard ? ('AQSI_CARD' as const) : ('AQSI_SBP' as const),
        providerOperationId: operation.providerOperationId,
        providerResultId: `slip-${id}`,
        status: 'SUCCEEDED' as const,
        updatedAt: new Date().toISOString(),
      };
    },
    [IPC_CHANNELS.paymentOperationRetryFiscalReceipt]: async (unsafeToken, unsafeId) => {
      const token = await paymentManagerToken(unsafeToken);
      const id = identifierSchema.parse(unsafeId);
      if (process.env.ARAVA_E2E_PAYMENT_PROVIDER !== 'memory')
        return requireAqsiPayments().retryFiscalReceipt(token, id);
      const operation = await paymentOperations.get(token, id);
      const isCard = operation.providerType === 'ACQUIRING';
      return {
        amountKopecks: operation.amount,
        aravaOperationId: id,
        currency: 'RUB' as const,
        deviceId: 101,
        fiscalReceipt: {
          canRetry: false,
          completedAt: new Date().toISOString(),
          fiscalDocumentNumber: 42,
          fiscalSign: '987654321',
          status: 'SUCCEEDED' as const,
          updatedAt: new Date().toISOString(),
        },
        provider: isCard ? ('AQSI_CARD' as const) : ('AQSI_SBP' as const),
        providerOperationId: operation.providerOperationId,
        providerResultId: `slip-${id}`,
        status: 'SUCCEEDED' as const,
        updatedAt: new Date().toISOString(),
      };
    },
    [IPC_CHANNELS.paymentOperationCancelAqsi]: async (unsafeToken, unsafeId) => {
      const token = await paymentManagerToken(unsafeToken);
      const id = identifierSchema.parse(unsafeId);
      if (process.env.ARAVA_E2E_PAYMENT_PROVIDER !== 'memory')
        return requireAqsiPayments().cancel(token, id);
      const operation = await paymentOperations.get(token, id);
      if (operation.status !== 'SUCCEEDED')
        await paymentOperations.cancel(token, id, 'Ожидание оплаты отменено пользователем.');
      return {
        amountKopecks: operation.amount,
        aravaOperationId: id,
        currency: 'RUB' as const,
        deviceId: 101,
        provider:
          operation.providerType === 'ACQUIRING' ? ('AQSI_CARD' as const) : ('AQSI_SBP' as const),
        providerOperationId: operation.providerOperationId,
        status: 'CANCELLED' as const,
        updatedAt: new Date().toISOString(),
      };
    },
    [IPC_CHANNELS.paymentOperationTestComplete]: async (
      unsafeToken,
      unsafeId,
      unsafePaymentMethod,
    ) => {
      if (process.env.ARAVA_E2E_PAYMENT_PROVIDER !== 'memory')
        throw new Error('Тестовый платёжный провайдер отключён.');
      const token = sessionTokenSchema.parse(unsafeToken);
      const id = identifierSchema.parse(unsafeId);
      const paymentMethod = paymentMethodSchema.parse(unsafePaymentMethod);
      if (paymentMethod !== 'ONLINE' && paymentMethod !== 'SBP' && paymentMethod !== 'ACQUIRING')
        throw new Error('Тестовый провайдер поддерживает только безналичную оплату.');
      const operation = await paymentOperations.get(token, id);
      if (operation.status === 'CREATED')
        await paymentOperations.transition(token, id, 'WAITING_FOR_PAYMENT');
      await paymentOperations.finalizeTrusted(id, { paymentMethod });
      return paymentOperations.get(token, id);
    },
    [IPC_CHANNELS.refundCreate]: (unsafeToken, unsafePaymentId, unsafeInput) =>
      finance.createRefund(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafePaymentId),
        refundInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.financeEmployees]: (unsafeToken) =>
      finance.listFinanceEmployees(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.financeStats]: (unsafeToken, unsafeBranchId) =>
      finance.financeStats(
        sessionTokenSchema.parse(unsafeToken),
        unsafeBranchId === undefined ? undefined : identifierSchema.parse(unsafeBranchId),
      ),

    [IPC_CHANNELS.expenseCategoryList]: (unsafeToken, unsafeIncludeArchived) =>
      management.listExpenseCategories(
        sessionTokenSchema.parse(unsafeToken),
        unsafeIncludeArchived === true,
      ),
    [IPC_CHANNELS.expenseCategoryCreate]: (unsafeToken, unsafeInput) =>
      management.createExpenseCategory(
        sessionTokenSchema.parse(unsafeToken),
        expenseCategoryInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.expenseCategoryUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      management.updateExpenseCategory(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        expenseCategoryInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.expenseCategoryArchive]: (unsafeToken, unsafeId) =>
      management.archiveExpenseCategory(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.expenseList]: (unsafeToken, unsafeQuery) =>
      management.listExpenses(
        sessionTokenSchema.parse(unsafeToken),
        expenseListQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.expenseCreate]: (unsafeToken, unsafeInput) =>
      management.createExpense(
        sessionTokenSchema.parse(unsafeToken),
        expenseInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.expenseUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      management.updateExpense(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        expenseInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.expenseConfirm]: (unsafeToken, unsafeId, unsafeRegisterId) =>
      management.confirmExpense(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        identifierSchema.parse(unsafeRegisterId),
      ),
    [IPC_CHANNELS.expenseCancel]: (unsafeToken, unsafeId) =>
      management.cancelExpense(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.cashRegisterList]: (unsafeToken, unsafeBranchId) =>
      management.listCashRegisters(
        sessionTokenSchema.parse(unsafeToken),
        unsafeBranchId === undefined ? undefined : identifierSchema.parse(unsafeBranchId),
      ),
    [IPC_CHANNELS.cashRegisterCreate]: (unsafeToken, unsafeInput) =>
      management.createCashRegister(
        sessionTokenSchema.parse(unsafeToken),
        cashRegisterInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cashRegisterUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      management.updateCashRegister(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        cashRegisterInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cashTransactionList]: (unsafeToken, unsafeQuery) =>
      management.listCashTransactions(
        sessionTokenSchema.parse(unsafeToken),
        cashTransactionQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.cashCorrectionCreate]: (unsafeToken, unsafeInput) =>
      management.correctCash(
        sessionTokenSchema.parse(unsafeToken),
        cashCorrectionInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.cashTransferCreate]: (unsafeToken, unsafeInput) =>
      management.transferCash(
        sessionTokenSchema.parse(unsafeToken),
        cashTransferInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollRuleList]: (unsafeToken, unsafeBranchId) =>
      management.listPayrollRules(
        sessionTokenSchema.parse(unsafeToken),
        unsafeBranchId === undefined ? undefined : identifierSchema.parse(unsafeBranchId),
      ),
    [IPC_CHANNELS.payrollRuleCreate]: (unsafeToken, unsafeInput) =>
      management.createPayrollRule(
        sessionTokenSchema.parse(unsafeToken),
        payrollRuleInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollRuleUpdate]: (unsafeToken, unsafeId, unsafeInput) =>
      management.updatePayrollRule(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        payrollRuleInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollPeriodList]: (unsafeToken, unsafeBranchId) =>
      management.listPayrollPeriods(
        sessionTokenSchema.parse(unsafeToken),
        unsafeBranchId === undefined ? undefined : identifierSchema.parse(unsafeBranchId),
      ),
    [IPC_CHANNELS.payrollPeriodCreate]: (unsafeToken, unsafeInput) =>
      management.createPayrollPeriod(
        sessionTokenSchema.parse(unsafeToken),
        payrollPeriodInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollPeriodGet]: (unsafeToken, unsafeId) =>
      management.getPayrollPeriod(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.payrollPeriodCalculate]: (unsafeToken, unsafeId) =>
      management.calculatePayrollPeriod(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.payrollPeriodApprove]: (unsafeToken, unsafeId) =>
      management.approvePayrollPeriod(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.payrollPeriodPay]: (unsafeToken, unsafeId, unsafeInput) =>
      management.payPayrollPeriod(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        payrollPaymentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollAccrualAdjust]: (unsafeToken, unsafeId, unsafeInput) =>
      management.adjustPayrollAccrual(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        payrollAdjustmentInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.payrollCoachView]: (unsafeToken, unsafeDateFrom, unsafeDateTo) =>
      management.coachPayroll(
        sessionTokenSchema.parse(unsafeToken),
        String(unsafeDateFrom),
        String(unsafeDateTo),
      ),
    [IPC_CHANNELS.analyticsGet]: (unsafeToken, unsafeQuery) =>
      management.analytics(
        sessionTokenSchema.parse(unsafeToken),
        analyticsQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.reportGet]: (unsafeToken, unsafeQuery) =>
      management.report(
        sessionTokenSchema.parse(unsafeToken),
        reportQuerySchema.parse(unsafeQuery),
      ),
    [IPC_CHANNELS.reportExportCsv]: (unsafeToken, unsafeQuery) =>
      management.exportReportCsv(
        sessionTokenSchema.parse(unsafeToken),
        reportQuerySchema.parse(unsafeQuery),
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
    [IPC_CHANNELS.studentOptions]: (unsafeToken, unsafeBranchId) =>
      service.listStudentOptions(
        sessionTokenSchema.parse(unsafeToken),
        unsafeBranchId === undefined ? undefined : identifierSchema.parse(unsafeBranchId),
      ),
    [IPC_CHANNELS.studentGet]: (unsafeToken, unsafeId) =>
      service.getStudent(sessionTokenSchema.parse(unsafeToken), identifierSchema.parse(unsafeId)),
    [IPC_CHANNELS.studentProfileGet]: (unsafeToken, unsafeId) =>
      studentProfiles.getOverview(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.trainerProfileGet]: (unsafeToken, unsafeId, unsafeMonth) =>
      trainerProfiles.getOverview(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
        z
          .string()
          .regex(/^\d{4}-\d{2}$/u, 'Укажите месяц в формате ГГГГ-ММ.')
          .parse(unsafeMonth),
      ),
    [IPC_CHANNELS.studentNoteCreate]: (unsafeToken, unsafeStudentId, unsafeInput) =>
      studentProfiles.createNote(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeStudentId),
        studentNoteInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.studentNoteUpdate]: (unsafeToken, unsafeNoteId, unsafeInput) =>
      studentProfiles.updateNote(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeNoteId),
        studentNoteInputSchema.parse(unsafeInput),
      ),
    [IPC_CHANNELS.studentNoteArchive]: (unsafeToken, unsafeNoteId) =>
      studentProfiles.archiveNote(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeNoteId),
      ),
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
      const [
        branches,
        students,
        trialStudents,
        users,
        groups,
        lessons,
        subscriptions,
        financeSummary,
      ] = await Promise.all([
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
        database.subscription.findMany({
          select: { expiresAt: true, lessonLimit: true, lessonsUsed: true },
          where: {
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
            ...(actor.role === 'COACH' ? { student: studentScope } : {}),
            status: { in: ['ACTIVE', 'FROZEN'] },
          },
        }),
        actor.role === 'COACH'
          ? Promise.resolve({ outstandingDebt: 0, revenueThisMonth: 0, revenueToday: 0 })
          : finance.financeStats(sessionTokenSchema.parse(unsafeToken)),
      ]);
      const expectedToday = lessons.reduce(
        (total, lesson) => total + lesson.group._count.enrollments,
        0,
      );
      const attendanceMarked = lessons.reduce(
        (total, lesson) => total + lesson._count.attendance,
        0,
      );
      const now = new Date();
      const expiringBoundary = new Date(now.getTime() + 5 * 86_400_000);
      const managementScope = branchIds ? { branchId: { in: branchIds } } : {};
      const [expenseToday, cashToday, payrollPendingApproval] =
        actor.role === 'COACH'
          ? [{ _sum: { amount: null } }, [], 0]
          : await Promise.all([
              database.expense.aggregate({
                _sum: { amount: true },
                where: {
                  ...managementScope,
                  spentAt: { gte: dayStart, lte: dayEnd },
                  status: 'CONFIRMED',
                },
              }),
              database.cashTransaction.findMany({
                select: { amount: true, type: true },
                where: { ...managementScope, occurredAt: { gte: dayStart, lte: dayEnd } },
              }),
              database.payrollPeriod.count({
                where: {
                  ...(branchIds ? { branchId: { in: branchIds } } : {}),
                  status: 'CALCULATED',
                },
              }),
            ]);
      const netCashFlow = cashToday.reduce(
        (sum, transaction) =>
          sum +
          (transaction.type === 'INCOME'
            ? transaction.amount
            : transaction.type === 'EXPENSE'
              ? -transaction.amount
              : transaction.amount),
        0,
      );
      return {
        activeGroups: groups.length,
        attendanceMarked,
        attendanceUnmarked: Math.max(0, expectedToday - attendanceMarked),
        branches,
        expectedToday,
        expensesToday: expenseToday._sum.amount ?? 0,
        groupsLowOccupancy: groups.filter(
          (group) => group._count.enrollments / group.capacity < 0.5,
        ).length,
        groupsWithPlaces: groups.filter((group) => group._count.enrollments < group.capacity)
          .length,
        lessonsToday: lessons.length,
        lowLessonBalance: subscriptions.filter(
          ({ lessonLimit, lessonsUsed }) =>
            lessonLimit !== null && Math.max(0, lessonLimit - lessonsUsed) <= 2,
        ).length,
        netCashFlow,
        outstandingDebt: financeSummary.outstandingDebt,
        payrollPendingApproval,
        revenueThisMonth: financeSummary.revenueThisMonth,
        revenueToday: financeSummary.revenueToday,
        students,
        subscriptionsExpiringSoon: subscriptions.filter(
          ({ expiresAt }) => expiresAt && expiresAt >= now && expiresAt <= expiringBoundary,
        ).length,
        trialStudents,
        users,
      };
    },
    [IPC_CHANNELS.attentionList]: (unsafeToken, unsafeFilters): Promise<AttentionItem[]> =>
      attention.listItems(
        sessionTokenSchema.parse(unsafeToken),
        attentionFiltersSchema.parse(unsafeFilters),
      ),
    [IPC_CHANNELS.attentionSummary]: (unsafeToken): Promise<AttentionSummary> =>
      attention.getSummary(sessionTokenSchema.parse(unsafeToken)),

    [IPC_CHANNELS.backupStatus]: (unsafeToken) =>
      backups.getStatus(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.backupList]: (unsafeToken) =>
      backups.listBackups(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.backupCreate]: (unsafeToken) =>
      backups.createManualBackup(sessionTokenSchema.parse(unsafeToken)),
    [IPC_CHANNELS.backupValidate]: (unsafeToken, unsafeId) =>
      backups.validateManagedBackup(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.backupSetAutomatic]: (unsafeToken, unsafeEnabled) =>
      backups.setAutomatic(sessionTokenSchema.parse(unsafeToken), z.boolean().parse(unsafeEnabled)),
    [IPC_CHANNELS.backupSelectFolder]: async (unsafeToken) => {
      const token = sessionTokenSchema.parse(unsafeToken);
      await backups.getStatus(token);
      const selected = backupDependencies.chooseBackupFolder
        ? await backupDependencies.chooseBackupFolder()
        : (
            await dialog.showOpenDialog({
              buttonLabel: 'Выбрать папку',
              properties: ['openDirectory', 'createDirectory'],
              title: 'Папка резервных копий',
            })
          ).filePaths[0];
      return selected ? backups.setBackupDirectory(token, selected) : undefined;
    },
    [IPC_CHANNELS.backupOpenFolder]: async (unsafeToken): Promise<void> => {
      const status = await backups.getStatus(sessionTokenSchema.parse(unsafeToken));
      if (backupDependencies.openFolder)
        await backupDependencies.openFolder(status.backupDirectory);
      else {
        const error = await shell.openPath(status.backupDirectory);
        if (error) throw new Error(`Не удалось открыть папку: ${error}`);
      }
    },
    [IPC_CHANNELS.backupExport]: async (unsafeToken) => {
      const token = sessionTokenSchema.parse(unsafeToken);
      const status = await backups.getStatus(token);
      const defaultPath = join(status.backupDirectory, 'ARAVA-CRM-backup.db');
      const selected = backupDependencies.chooseExportPath
        ? await backupDependencies.chooseExportPath(defaultPath)
        : (
            await dialog.showSaveDialog({
              buttonLabel: 'Сохранить копию',
              defaultPath,
              filters: [{ extensions: ['db'], name: 'Резервная копия ARAVA CRM' }],
              title: 'Сохранить резервную копию как',
            })
          ).filePath;
      return selected ? backups.exportBackup(token, selected) : undefined;
    },
    [IPC_CHANNELS.backupSelectManaged]: (unsafeToken, unsafeId) =>
      backups.selectManagedBackup(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeId),
      ),
    [IPC_CHANNELS.backupSelectRestoreFile]: async (unsafeToken) => {
      const token = sessionTokenSchema.parse(unsafeToken);
      await backups.getStatus(token);
      const selected = backupDependencies.chooseBackupFile
        ? await backupDependencies.chooseBackupFile()
        : (
            await dialog.showOpenDialog({
              buttonLabel: 'Выбрать копию',
              filters: [{ extensions: ['db'], name: 'Резервная копия ARAVA CRM' }],
              properties: ['openFile'],
              title: 'Выберите резервную копию',
            })
          ).filePaths[0];
      return selected ? backups.selectExternalBackup(token, selected) : undefined;
    },
    [IPC_CHANNELS.backupRestore]: async (unsafeToken, unsafeSelectionId, unsafeConfirmation) => {
      const result = await backups.restoreBackup(
        sessionTokenSchema.parse(unsafeToken),
        identifierSchema.parse(unsafeSelectionId),
        z.string().max(30).parse(unsafeConfirmation),
      );
      setTimeout(() => {
        if (backupDependencies.relaunch) backupDependencies.relaunch();
        else if (process.env.ARAVA_E2E_NO_RELAUNCH !== '1') {
          app.relaunch();
          app.exit(0);
        }
      }, 750);
      return result;
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
    [IPC_CHANNELS.auditList]: async (unsafeToken): Promise<AuditLogSummary[]> => {
      const actor = await service.authenticate(sessionTokenSchema.parse(unsafeToken));
      assertCapability(actor, 'canViewAuditLog');
      const entries = await database.auditLog.findMany({
        include: { actor: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return entries.map((entry) => ({
        action: entry.action,
        actorName: entry.actor.fullName,
        createdAt: entry.createdAt.toISOString(),
        detail: entry.detail ?? undefined,
        entityId: entry.entityId,
        entityType: entry.entityType,
        id: entry.id,
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
      if (update.key === 'general.workspaceName')
        assertCapability(actor, 'canManageSystemSettings');
      await database.appSetting.upsert({
        create: update,
        update: { value: update.value },
        where: { key: update.key },
      });
    },
    [IPC_CHANNELS.systemInformation]: async (unsafeToken): Promise<SystemInformation> => {
      await service.authenticate(sessionTokenSchema.parse(unsafeToken));
      return { ...getBuildMetadata(), databasePath, platform: process.platform };
    },
  };
}

export function registerIpcHandlers(
  database: DatabaseClient,
  databasePath: string,
  dependencies: BackupIpcDependencies & { service?: ApplicationService } = {},
): void {
  const service = dependencies.service ?? new ApplicationService(database);
  const handlers = createIpcHandlers(database, service, databasePath, dependencies);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_event, ...arguments_: unknown[]) => {
      const result = await handler(...arguments_);
      if (SYNC_RELEVANT_MUTATIONS.has(channel)) dependencies.integration?.schedule();
      return result;
    });
  }
}

const SYNC_RELEVANT_MUTATIONS = new Set<string>([
  IPC_CHANNELS.integrationResolveConflict,
  IPC_CHANNELS.attendanceSave,
  IPC_CHANNELS.branchArchive,
  IPC_CHANNELS.branchCreate,
  IPC_CHANNELS.branchUpdate,
  IPC_CHANNELS.cardArchive,
  IPC_CHANNELS.cardAssign,
  IPC_CHANNELS.cardBlock,
  IPC_CHANNELS.cardMarkLost,
  IPC_CHANNELS.cardReactivate,
  IPC_CHANNELS.cardRegister,
  IPC_CHANNELS.cardReplace,
  IPC_CHANNELS.cardUnassign,
  IPC_CHANNELS.contactCreate,
  IPC_CHANNELS.contactRemove,
  IPC_CHANNELS.contactUpdate,
  IPC_CHANNELS.enrollmentAdd,
  IPC_CHANNELS.enrollmentRemove,
  IPC_CHANNELS.groupArchive,
  IPC_CHANNELS.groupCreate,
  IPC_CHANNELS.groupUpdate,
  IPC_CHANNELS.integrationPair,
  IPC_CHANNELS.webActionApprove,
  IPC_CHANNELS.webActionReject,
  IPC_CHANNELS.lessonCancel,
  IPC_CHANNELS.lessonCopyDay,
  IPC_CHANNELS.lessonCreate,
  IPC_CHANNELS.lessonGenerate,
  IPC_CHANNELS.lessonUpdate,
  IPC_CHANNELS.publicationArchive,
  IPC_CHANNELS.publicationPublish,
  IPC_CHANNELS.publicationRetry,
  IPC_CHANNELS.publicationUpdate,
  IPC_CHANNELS.roomArchive,
  IPC_CHANNELS.roomCreate,
  IPC_CHANNELS.roomUpdate,
  IPC_CHANNELS.scheduleCreate,
  IPC_CHANNELS.scheduleDeactivate,
  IPC_CHANNELS.scheduleUpdate,
  IPC_CHANNELS.studentArchive,
  IPC_CHANNELS.studentCreate,
  IPC_CHANNELS.studentUpdate,
  IPC_CHANNELS.studentNoteArchive,
  IPC_CHANNELS.studentNoteCreate,
  IPC_CHANNELS.studentNoteUpdate,
  IPC_CHANNELS.subscriptionAdjust,
  IPC_CHANNELS.subscriptionCancel,
  IPC_CHANNELS.subscriptionCreate,
  IPC_CHANNELS.subscriptionFreeze,
  IPC_CHANNELS.subscriptionUnfreeze,
  IPC_CHANNELS.substitutionAssign,
  IPC_CHANNELS.tariffArchive,
  IPC_CHANNELS.tariffCreate,
  IPC_CHANNELS.tariffUpdate,
  IPC_CHANNELS.userCreate,
  IPC_CHANNELS.userUpdate,
]);

export function removeIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) ipcMain.removeHandler(channel);
}
