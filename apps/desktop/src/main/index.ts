import { APP_ID, createApplicationConfig } from '@arava/config';
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
import { app } from 'electron';
import log from 'electron-log/main';
import { join } from 'node:path';

import { registerIpcHandlers, removeIpcHandlers } from './ipc';
import { CustomerDisplayManager } from './customer-display-manager';
import { createMainWindow, getMainWindow } from './window';
import { createIntegrationCredentialStore, IntegrationManager } from './integration-manager';

const config = createApplicationConfig({
  environment: app.isPackaged ? 'production' : 'development',
  logLevel: app.isPackaged ? 'info' : 'debug',
});

let database: DatabaseClient | undefined;
let customerDisplay: CustomerDisplayManager | undefined;
let integration: IntegrationManager | undefined;

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
    ),
  );
  await integration.initialize();
  const automaticBackup = await backups.runAutomaticBackup();
  if (automaticBackup) log.info('Automatic backup created', { file: automaticBackup.fileName });
  customerDisplay = new CustomerDisplayManager(database, service);
  await customerDisplay.initialize();
  registerIpcHandlers(database, databasePath, {
    backup: backups,
    customerDisplay,
    integration,
    service,
  });
  await customerDisplay.reopenIfEnabled();
  const mainWindow = createMainWindow();
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
  removeIpcHandlers();
  customerDisplay?.shutdown();
  integration?.shutdown();
  if (database) await closeDatabase(database);
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

  app.on('will-quit', () => {
    app.releaseSingleInstanceLock();
    void shutdown().catch((error: unknown) => {
      log.error('Failed to close application services', error);
    });
  });

  void bootstrap().catch((error: unknown) => {
    log.error('Application bootstrap failed', error);
    app.exit(1);
  });
}
