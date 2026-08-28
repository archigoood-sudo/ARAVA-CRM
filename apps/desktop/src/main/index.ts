import { APP_ID, createApplicationConfig } from '@arava/config';
import { IPC_CHANNELS } from '@arava/shared';
import {
  ApplicationService,
  BackupService,
  IntegrationService,
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  toSqliteUrl,
  type DatabaseClient,
} from '@arava/database';
import { app, shell } from 'electron';
import log from 'electron-log/main';
import electronUpdater from 'electron-updater';
import { join } from 'node:path';

import { registerIpcHandlers, removeIpcHandlers } from './ipc';
import { CustomerDisplayManager } from './customer-display-manager';
import { createMainWindow, getMainWindow } from './window';
import { createIntegrationCredentialStore, IntegrationManager } from './integration-manager';
import { isDesktopUpdateSupported, UpdateManager } from './update-manager';
import { getDesktopUpdateChannel } from './build-metadata';

const { autoUpdater } = electronUpdater;

const config = createApplicationConfig({
  environment: app.isPackaged ? 'production' : 'development',
  logLevel: app.isPackaged ? 'info' : 'debug',
});

let database: DatabaseClient | undefined;
let customerDisplay: CustomerDisplayManager | undefined;
let integration: IntegrationManager | undefined;
let updates: UpdateManager | undefined;
let shutdownPromise: Promise<void> | undefined;
let shutdownComplete = false;

function configureLogging(): void {
  log.initialize();
  log.transports.console.level = config.logLevel;
  log.transports.file.level = config.logLevel;
  log.transports.file.fileName = 'arava-crm.log';
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  configureLogging();

  const databasePath = join(app.getPath('userData'), 'arava.db');
  database = createDatabaseClient(toSqliteUrl(databasePath));

  log.info('Starting ARAVA CRM', {
    environment: config.environment,
    version: app.getVersion(),
  });

  await initializeDatabase(database);
  const service = new ApplicationService(database);
  const backups = new BackupService(database, service, {
    databasePath,
    defaultBackupDirectory: join(app.getPath('userData'), 'backups'),
    externalLogPath: join(app.getPath('userData'), 'backup-restore.log'),
  });
  integration = new IntegrationManager(
    new IntegrationService(
      database,
      service,
      createIntegrationCredentialStore(app.getPath('userData')),
      undefined,
      undefined,
      (token) => backups.createManualBackup(token),
      (entityType) =>
        getMainWindow()?.webContents.send(IPC_CHANNELS.integrationDataChanged, entityType),
    ),
  );
  await integration.initialize();
  const automaticBackup = await backups.runAutomaticBackup();
  if (automaticBackup) log.info('Automatic backup created', { file: automaticBackup.fileName });
  customerDisplay = new CustomerDisplayManager(database, service);
  await customerDisplay.initialize();
  updates = new UpdateManager(service, autoUpdater, {
    channel: getDesktopUpdateChannel(),
    currentVersion: app.getVersion(),
    openExternal: (url) => shell.openExternal(url),
    platform: process.platform,
    prepareForInstall: async () => {
      await shutdown();
      shutdownComplete = true;
    },
    supported: isDesktopUpdateSupported(
      app.isPackaged,
      process.platform,
      process.env.ARAVA_E2E_DISABLE_UPDATES === '1',
    ),
  });
  autoUpdater.logger = log;
  registerIpcHandlers(database, databasePath, {
    backup: backups,
    customerDisplay,
    integration,
    service,
    updates,
  });
  await customerDisplay.reopenIfEnabled();
  const mainWindow = createMainWindow();
  updates.subscribe((state) => {
    getMainWindow()?.webContents.send(IPC_CHANNELS.updateStateChanged, state);
  });
  updates.initialize();
  mainWindow.on('closed', () => customerDisplay?.closeForMainWindow());
  mainWindow.on('focus', () => integration?.schedule());

  app.on('activate', () => {
    if (!getMainWindow()) {
      const window = createMainWindow();
      window.on('closed', () => customerDisplay?.closeForMainWindow());
      window.on('focus', () => integration?.schedule());
      void customerDisplay?.reopenIfEnabled();
    }
  });
}

async function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    removeIpcHandlers();
    updates?.shutdown();
    customerDisplay?.shutdown();
    integration?.shutdown();
    if (database) await closeDatabase(database);
    database = undefined;
  })();
  return shutdownPromise;
}

app.setAppUserModelId(APP_ID);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    void shutdown()
      .catch((error: unknown) => {
        log.error('Failed to close application services', error);
      })
      .finally(() => {
        shutdownComplete = true;
        app.releaseSingleInstanceLock();
        app.exit(0);
      });
  });

  app.on('will-quit', () => {
    app.releaseSingleInstanceLock();
  });

  void bootstrap().catch((error: unknown) => {
    log.error('Application bootstrap failed', error);
    app.exit(1);
  });
}
