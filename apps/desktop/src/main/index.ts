import { APP_ID, createApplicationConfig } from '@arava/config';
import {
  ApplicationService,
  BackupService,
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  toSqliteUrl,
  type DatabaseClient,
} from '@arava/database';
import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { join } from 'node:path';

import { registerIpcHandlers, removeIpcHandlers } from './ipc';
import { createMainWindow } from './window';

const config = createApplicationConfig({
  environment: app.isPackaged ? 'production' : 'development',
  logLevel: app.isPackaged ? 'info' : 'debug',
});

let database: DatabaseClient | undefined;

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
  const automaticBackup = await backups.runAutomaticBackup();
  if (automaticBackup) log.info('Automatic backup created', { file: automaticBackup.fileName });
  registerIpcHandlers(database, databasePath, { backup: backups, service });
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}

async function shutdown(): Promise<void> {
  removeIpcHandlers();
  if (database) await closeDatabase(database);
}

app.setAppUserModelId(APP_ID);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    void shutdown().catch((error: unknown) => {
      log.error('Failed to close application services', error);
    });
  });

  void bootstrap().catch((error: unknown) => {
    log.error('Application bootstrap failed', error);
    app.exit(1);
  });
}
