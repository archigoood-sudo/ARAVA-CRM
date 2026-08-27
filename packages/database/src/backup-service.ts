import type {
  BackupEntry,
  BackupIntegrityStatus,
  BackupRestoreResult,
  BackupRestoreSelection,
  BackupStatus,
  BackupType,
  BackupValidationResult,
} from '@arava/shared';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  access,
  appendFile,
  copyFile,
  open,
  lstat,
  mkdir,
  readFile,
  readdir,
  mkdtemp,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join, normalize, posix, resolve } from 'node:path';

import {
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  toSqliteUrl,
  type DatabaseClient,
} from './index';
import { assertCapability } from './permissions';
import { runtimeMigrations } from './runtime-migrations';
import { DomainError } from './security';
import type { ApplicationService } from './services';

const BACKUP_PREFIX = 'ARAVA-CRM-backup';
const BACKUP_EXTENSION = '.db';
const BACKUP_ARCHIVE_GZIP = true;
const BACKUP_MANIFEST_FILE = 'manifest.json';
const BACKUP_DATABASE_FILE = 'database.db';
const BACKUP_FORMAT = 'ARAVA-CRM-BACKUP';
const BACKUP_FORMAT_VERSION = 1;
const MANAGED_MEDIA_DIRECTORIES = [
  'media/branding',
  'media/customer-display',
  'media/publications',
] as const;
const ALLOWED_MEDIA_EXTENSION = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const AUTOMATIC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SELECTION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_RETENTION_COUNT = 30;
const MINIMUM_FREE_SPACE = 10 * 1024 * 1024;
const REQUIRED_TABLES = ['AppSetting', 'Student', 'User', '_AppMigration'] as const;

const SETTINGS = {
  automaticEnabled: 'backup.automaticEnabled',
  consecutiveFailures: 'backup.consecutiveFailures',
  customDirectory: 'backup.directory',
  initializedAt: 'backup.initializedAt',
  lastAttemptAt: 'backup.lastAttemptAt',
  lastAutomaticAt: 'backup.lastAutomaticAt',
  lastError: 'backup.lastError',
  lastSuccessfulAt: 'backup.lastSuccessfulAt',
  retentionCount: 'backup.retentionCount',
  usingLocalFallback: 'backup.usingLocalFallback',
} as const;

interface BackupMetadata {
  createdAt: string;
  integrity: BackupIntegrityStatus;
  type: BackupType;
}

interface RestoreSelectionRecord {
  expiresAt: number;
  path: string;
}

interface SqliteCheckRow {
  integrity_check?: string;
  quick_check?: string;
}

interface SqliteName {
  name: string;
}

interface MigrationRow {
  id: string;
}

interface BackupManifestMediaFile {
  path: string;
  sha256: string;
  size: number;
}

interface BackupManifest {
  backupVersion: number;
  createdAt: string;
  database: {
    path: 'database.db';
    size: number;
    sha256: string;
  };
  format: string;
  media: BackupManifestMediaFile[];
  type: BackupType;
}

interface TarApi {
  create(
    options: {
      cwd: string;
      file: string;
      gzip?: boolean;
      portable?: boolean;
    },
    files: string[],
  ): Promise<void>;
  extract(options: { file: string; cwd: string; gzip?: boolean }): Promise<void>;
  list(options: {
    file: string;
    cwd: string;
    gzip?: boolean;
    onentry?: (entry: { path: string }) => void;
  }): Promise<void>;
}

const tar = (): TarApi => createRequire(import.meta.url)('tar') as TarApi;
const tarClient = tar();

export interface BackupServiceOptions {
  databasePath: string;
  defaultBackupDirectory: string;
  externalLogPath: string;
  now?: () => Date;
}

function formatTimestamp(date: Date): string {
  const part = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    part(date.getMonth() + 1),
    part(date.getDate()),
    part(date.getHours()),
    part(date.getMinutes()),
    part(date.getSeconds()),
  ].join('-');
}

function sqliteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function metadataPath(databasePath: string): string {
  return `${databasePath}.json`;
}

function backupId(path: string): string {
  return createHash('sha256').update(resolve(path)).digest('hex').slice(0, 24);
}

function backupTypeFromName(fileName: string): BackupType {
  if (fileName.includes('-automatic-')) return 'AUTOMATIC';
  if (fileName.includes('-before-restore-')) return 'RESTORE_SAFETY';
  return 'MANUAL';
}

function backupFileName(type: BackupType, date: Date): string {
  const marker =
    type === 'AUTOMATIC' ? '-automatic' : type === 'RESTORE_SAFETY' ? '-before-restore' : '';
  return `${BACKUP_PREFIX}${marker}-${formatTimestamp(date)}${BACKUP_EXTENSION}`;
}

function friendlyFileError(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  const code =
    typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined;
  if (code === 'ENOSPC') return 'Недостаточно свободного места для резервной копии.';
  if (code === 'EACCES' || code === 'EPERM') return 'Нет доступа к папке резервных копий.';
  if (code === 'ENOENT') return 'Папка резервных копий недоступна.';
  if (code === 'EBUSY') return 'Диск или файл сейчас занят. Повторите попытку.';
  return 'Не удалось выполнить операцию с файлом.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBackupType(value: string): value is BackupType {
  return ['AUTOMATIC', 'MANUAL', 'RESTORE_SAFETY'].includes(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isSafeManifestPath(path: string): boolean {
  if (!path || path.includes('\\')) return false;
  const normalized = posix
    .normalize(path)
    .replace(/^\.\//u, '')
    .replace(/\/+$|^\.+$/u, '')
    .replace(/^\/+/u, '');
  return (
    normalized.length > 0 &&
    !posix.isAbsolute(normalized) &&
    !normalized.includes('/../') &&
    !normalized.startsWith('../') &&
    !normalized.includes('..')
  );
}

function isAllowedMediaPath(path: string): boolean {
  if (!isSafeManifestPath(path)) return false;
  if (!path.startsWith('media/')) return false;
  const segments = path.split('/');
  if (segments.length !== 3) return false;
  const [directoryRoot, directoryLeaf, fileName] = segments;
  if (!directoryRoot || !directoryLeaf || !fileName) return false;
  if (
    !MANAGED_MEDIA_DIRECTORIES.includes(
      `${directoryRoot}/${directoryLeaf}` as (typeof MANAGED_MEDIA_DIRECTORIES)[number],
    )
  )
    return false;
  const extension = extname(fileName).toLowerCase();
  return ALLOWED_MEDIA_EXTENSION.has(extension);
}

async function fileHashSha256(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

async function getFileStats(path: string): Promise<{ size: number; sha256: string }> {
  const [info, sha256] = await Promise.all([stat(path), fileHashSha256(path)]);
  return { size: info.size, sha256 };
}

async function removeSqliteSidecars(databasePath: string): Promise<void> {
  await Promise.all([
    rm(`${databasePath}-wal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
  ]);
}

export class BackupService {
  private readonly databasePath: string;
  private readonly defaultBackupDirectory: string;
  private readonly externalLogPath: string;
  private readonly now: () => Date;
  private readonly restoreSelections = new Map<string, RestoreSelectionRecord>();

  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
    options: BackupServiceOptions,
  ) {
    this.databasePath = resolve(options.databasePath);
    this.defaultBackupDirectory = resolve(options.defaultBackupDirectory);
    this.externalLogPath = resolve(options.externalLogPath);
    this.now = options.now ?? (() => new Date());
  }

  async initializePreferences(): Promise<void> {
    const defaults = [
      [SETTINGS.automaticEnabled, 'true'],
      [SETTINGS.consecutiveFailures, '0'],
      [SETTINGS.initializedAt, this.now().toISOString()],
      [SETTINGS.retentionCount, String(DEFAULT_RETENTION_COUNT)],
      [SETTINGS.usingLocalFallback, 'false'],
    ] as const;
    for (const [key, value] of defaults) {
      await this.database.appSetting.upsert({ create: { key, value }, update: {}, where: { key } });
    }
    await mkdir(this.defaultBackupDirectory, { recursive: true });
  }

  async getStatus(token: string): Promise<BackupStatus> {
    await this.owner(token);
    return this.status();
  }

  async listBackups(token: string): Promise<BackupEntry[]> {
    await this.owner(token);
    return this.listEntries();
  }

  async setAutomatic(token: string, enabled: boolean): Promise<BackupStatus> {
    const actor = await this.owner(token);
    await this.setSetting(SETTINGS.automaticEnabled, String(enabled));
    await this.audit(
      actor.id,
      'BACKUP_SETTINGS_UPDATED',
      `Автоматические копии: ${enabled ? 'включены' : 'выключены'}.`,
    );
    return this.status();
  }

  async setBackupDirectory(token: string, path: string): Promise<BackupStatus> {
    const actor = await this.owner(token);
    const directory = resolve(path);
    await this.ensureWritableDirectory(directory);
    await this.setSetting(SETTINGS.customDirectory, directory);
    await this.setSetting(SETTINGS.usingLocalFallback, 'false');
    await this.audit(actor.id, 'BACKUP_SETTINGS_UPDATED', 'Изменена папка резервных копий.');
    return this.status();
  }

  async createManualBackup(token: string): Promise<BackupEntry> {
    const actor = await this.owner(token);
    const entry = await this.createManagedBackup('MANUAL');
    await this.audit(actor.id, 'BACKUP_CREATED', `Создана ручная копия ${entry.fileName}.`);
    return entry;
  }

  async exportBackup(token: string, destination: string): Promise<BackupEntry> {
    const actor = await this.owner(token);
    const path = resolve(destination);
    if (!path.toLowerCase().endsWith(BACKUP_EXTENSION))
      throw new DomainError('VALIDATION', 'Файл резервной копии должен иметь расширение .db.');
    if (normalize(path) === normalize(this.databasePath))
      throw new DomainError('VALIDATION', 'Нельзя заменить рабочую базу резервной копией.');
    const entry = await this.createSnapshot(path, 'MANUAL');
    await this.audit(actor.id, 'BACKUP_EXPORTED', `Копия сохранена как ${entry.fileName}.`);
    return entry;
  }

  async validateManagedBackup(token: string, id: string): Promise<BackupValidationResult> {
    await this.owner(token);
    const entry = (await this.listEntries()).find((item) => item.id === id);
    if (!entry) throw new DomainError('NOT_FOUND', 'Резервная копия не найдена.');
    const result = await this.validatePath(entry.location, true, entry.type);
    await this.refreshLastSuccessfulAt();
    return result;
  }

  async selectManagedBackup(token: string, id: string): Promise<BackupRestoreSelection> {
    await this.owner(token);
    const entry = (await this.listEntries()).find((item) => item.id === id);
    if (!entry) throw new DomainError('NOT_FOUND', 'Резервная копия не найдена.');
    return this.registerRestoreSelection(entry.location, entry.type);
  }

  async selectExternalBackup(token: string, path: string): Promise<BackupRestoreSelection> {
    await this.owner(token);
    const source = resolve(path);
    if (!source.toLowerCase().endsWith(BACKUP_EXTENSION))
      throw new DomainError('VALIDATION', 'Выберите резервную копию с расширением .db.');
    return this.registerRestoreSelection(source, backupTypeFromName(basename(source)));
  }

  async restoreBackup(
    token: string,
    selectionId: string,
    confirmation: string,
  ): Promise<BackupRestoreResult> {
    const actor = await this.owner(token);
    if (confirmation !== 'ВОССТАНОВИТЬ')
      throw new DomainError('VALIDATION', 'Введите ВОССТАНОВИТЬ для подтверждения.');
    const selected = this.restoreSelections.get(selectionId);
    if (!selected || selected.expiresAt < this.now().getTime()) {
      this.restoreSelections.delete(selectionId);
      throw new DomainError('VALIDATION', 'Выберите и проверьте резервную копию ещё раз.');
    }

    const validation = await this.validatePath(selected.path, false);
    if (!validation.canRestore) throw new DomainError('VALIDATION', validation.message);

    const restoreDirectory = await mkdtemp(join(dirname(this.databasePath), '.arava-restore-'));
    const stagedDatabasePath = join(restoreDirectory, BACKUP_DATABASE_FILE);
    const rollbackPath = join(dirname(this.databasePath), `.arava-rollback-${randomUUID()}.db`);
    const mediaRollbackRoot = join(restoreDirectory, 'media-rollback');
    let activeDatabaseClosed = false;
    let productionMoved = false;
    let replacementInstalled = false;
    let mediaRollbackPrepared = false;
    let restoredManifest: BackupManifest | undefined;
    let restoredMediaWarnings: string | undefined;
    let safetyBackup: BackupEntry | undefined;

    await this.audit(
      actor.id,
      'DATABASE_RESTORE_INITIATED',
      `Выбрана копия ${basename(selected.path)}.`,
    );
    await this.writeExternalLog('Восстановление начато', actor.id, selected.path);

    try {
      const header = await readFile(selected.path, { encoding: 'latin1' });
      const isLegacyDatabase = header.startsWith('SQLite format 3\0');

      if (isLegacyDatabase) {
        await copyFile(selected.path, stagedDatabasePath);
      } else {
        const prepared = await this.extractArchivedBackupForRestore(
          selected.path,
          restoreDirectory,
        );
        restoredManifest = prepared.manifest;
        restoredMediaWarnings = prepared.warnings.length
          ? `В архиве обнаружены предупреждения по медиафайлам: ${prepared.warnings.join(' ')}`
          : undefined;
        const extractedDatabase = join(restoreDirectory, BACKUP_DATABASE_FILE);
        await copyFile(extractedDatabase, stagedDatabasePath);
      }

      const stagedDatabase = createDatabaseClient(
        `${toSqliteUrl(stagedDatabasePath)}?connection_limit=1`,
      );
      try {
        await initializeDatabase(stagedDatabase);
        await this.assertIntegrity(stagedDatabase, 'integrity_check');
      } finally {
        await closeDatabase(stagedDatabase);
      }

      safetyBackup = await this.createManagedBackup('RESTORE_SAFETY', this.defaultBackupDirectory);
      await closeDatabase(this.database);
      activeDatabaseClosed = true;
      await removeSqliteSidecars(this.databasePath);
      if (restoredManifest) {
        await this.backupManagedMedia(mediaRollbackRoot);
        mediaRollbackPrepared = true;
      }
      await rename(this.databasePath, rollbackPath);
      productionMoved = true;
      await rename(stagedDatabasePath, this.databasePath);
      replacementInstalled = true;
      if (restoredManifest)
        await this.restoreManagedMedia(restoreDirectory, restoredManifest.media);

      await initializeDatabase(this.database);
      activeDatabaseClosed = false;
      await this.assertIntegrity(this.database, 'quick_check');
      if (restoredMediaWarnings)
        await this.writeExternalLog(restoredMediaWarnings, actor.id, selected.path);
      await rm(rollbackPath, { force: true });
      await rm(mediaRollbackRoot, { force: true, recursive: true });
      mediaRollbackPrepared = false;
      productionMoved = false;
      this.restoreSelections.delete(selectionId);
      await this.writeExternalLog('Восстановление завершено', actor.id, selected.path);
      return { safetyBackup, success: true };
    } catch (error) {
      if (activeDatabaseClosed || replacementInstalled) {
        await closeDatabase(this.database).catch(() => undefined);
        if (replacementInstalled) await rm(this.databasePath, { force: true });
        if (productionMoved && (await pathExists(rollbackPath)))
          await rename(rollbackPath, this.databasePath);
        if (mediaRollbackPrepared) {
          await this.restoreManagedMediaRollback(mediaRollbackRoot);
        }
        await initializeDatabase(this.database).catch(() => undefined);
      }
      await this.writeExternalLog(
        `Ошибка восстановления: ${friendlyFileError(error)}`,
        actor.id,
        selected.path,
      );
      throw new DomainError(
        'CONFLICT',
        `Восстановление не выполнено. Текущие данные сохранены. ${friendlyFileError(error)}`,
      );
    } finally {
      await rm(restoreDirectory, { force: true, recursive: true });
      if (!productionMoved) await rm(rollbackPath, { force: true });
    }
  }

  private async extractArchivedBackupForRestore(
    path: string,
    restoreDirectory: string,
  ): Promise<{ manifest: BackupManifest; warnings: string[] }> {
    const preview = await this.validateArchiveBackup(
      path,
      false,
      backupTypeFromName(basename(path)),
    );
    if (!preview.canRestore) {
      throw new Error(preview.message);
    }
    await tarClient.extract({
      file: path,
      cwd: restoreDirectory,
      gzip: BACKUP_ARCHIVE_GZIP,
    });
    const manifest = await this.readArchiveManifest(join(restoreDirectory, BACKUP_MANIFEST_FILE));
    const warnings = preview.message.startsWith('Копия проверена с предупреждениями:')
      ? [preview.message]
      : [];
    return { manifest, warnings };
  }

  private async collectManagedMedia(mediaRoot: string): Promise<BackupManifestMediaFile[]> {
    const result: BackupManifestMediaFile[] = [];
    const seen = new Set<string>();
    for (const directory of MANAGED_MEDIA_DIRECTORIES) {
      const collectFromDirectory = async (relativeDirectory: string): Promise<void> => {
        const absoluteDirectory = join(mediaRoot, relativeDirectory);
        const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(
          () => undefined,
        );
        if (!entries) return;
        for (const entry of entries) {
          const relativePath = posix.join(relativeDirectory, entry.name);
          if (entry.isDirectory()) {
            await collectFromDirectory(relativePath);
            continue;
          }
          if (!entry.isFile()) continue;
          if (!isSafeManifestPath(relativePath) || !isAllowedMediaPath(relativePath)) continue;
          if (seen.has(relativePath))
            throw new Error(`Обнаружен дубликат файла в резервной копии: ${relativePath}`);
          seen.add(relativePath);
          const absolutePath = join(mediaRoot, relativePath);
          const stats = await getFileStats(absolutePath);
          result.push({
            path: relativePath,
            sha256: stats.sha256,
            size: stats.size,
          });
        }
      };
      await collectFromDirectory(directory);
    }
    return result;
  }

  private async copyManagedMediaToStage(
    stagingDirectory: string,
    relativePath: string,
    sourceMediaRoot: string,
  ): Promise<void> {
    const source = join(sourceMediaRoot, relativePath);
    const target = join(stagingDirectory, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }

  private async readArchiveManifest(path: string): Promise<BackupManifest> {
    const value = await readFile(path, 'utf8');
    const unknownManifest = JSON.parse(value) as unknown;
    if (!isRecord(unknownManifest)) throw new Error('Некорректный манифест резервной копии.');
    const { format, backupVersion, createdAt, database, media, type } = unknownManifest;

    if (typeof format !== 'string' || format !== BACKUP_FORMAT) {
      throw new Error('Некорректный манифест резервной копии.');
    }
    if (typeof backupVersion !== 'number' || backupVersion !== BACKUP_FORMAT_VERSION) {
      throw new Error('Некорректный манифест резервной копии.');
    }
    if (typeof createdAt !== 'string') {
      throw new Error('Некорректный манифест резервной копии.');
    }
    if (!isRecord(database)) {
      throw new Error('Некорректный манифест резервной копии.');
    }
    if (
      typeof database.path !== 'string' ||
      database.path !== BACKUP_DATABASE_FILE ||
      typeof database.sha256 !== 'string' ||
      typeof database.size !== 'number'
    ) {
      throw new Error('Некорректный манифест резервной копии.');
    }
    if (typeof type !== 'string' || !isBackupType(type)) {
      throw new Error('Некорректный манифест резервной копии.');
    }
    if (!Array.isArray(media)) {
      throw new Error('Некорректный манифест резервной копии.');
    }

    const normalizedMedia = media.map((item: unknown) => {
      if (!isRecord(item)) {
        throw new Error('Некорректные данные media в манифесте.');
      }
      if (
        typeof item.path !== 'string' ||
        typeof item.sha256 !== 'string' ||
        typeof item.size !== 'number'
      ) {
        throw new Error('Некорректные данные media в манифесте.');
      }
      if (!isAllowedMediaPath(item.path)) throw new Error(`Недопустимый путь media: ${item.path}`);
      return {
        path: item.path,
        sha256: item.sha256,
        size: item.size,
      };
    });

    const mediaEntries = new Set<string>();
    for (const mediaItem of normalizedMedia) {
      if (mediaEntries.has(mediaItem.path))
        throw new Error(`Дублирующийся путь media в манифесте: ${mediaItem.path}`);
      mediaEntries.add(mediaItem.path);
    }

    return {
      backupVersion,
      createdAt,
      database: {
        path: database.path,
        sha256: database.sha256,
        size: database.size,
      },
      format,
      media: normalizedMedia,
      type,
    };
  }

  private async backupManagedMedia(mediaRollbackRoot: string): Promise<void> {
    const staging = join(mediaRollbackRoot, 'managed-media');
    await rm(staging, { force: true, recursive: true });
    const sourceMediaRoot = dirname(this.databasePath);
    await mkdir(staging, { recursive: true });
    const mediaFiles = await this.collectManagedMedia(sourceMediaRoot);
    for (const file of mediaFiles)
      await this.copyManagedMediaToStage(staging, file.path, sourceMediaRoot);
  }

  private async restoreManagedMedia(
    restoreDirectory: string,
    media: BackupManifestMediaFile[],
  ): Promise<void> {
    const sourceRoot = restoreDirectory;
    const destinationRoot = dirname(this.databasePath);
    for (const file of media) {
      const source = join(sourceRoot, file.path);
      const target = join(destinationRoot, file.path);
      const info = await getFileStats(source).catch(() => undefined);
      if (!info) throw new Error(`Не найден медиафайл для восстановления: ${file.path}`);
      if (info.size !== file.size || info.sha256 !== file.sha256)
        throw new Error(`Контрольная сумма медиафайла не совпала: ${file.path}`);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
  }

  private async restoreManagedMediaRollback(mediaRollbackRoot: string): Promise<void> {
    const destinationRoot = join(mediaRollbackRoot, 'managed-media');
    for (const directory of MANAGED_MEDIA_DIRECTORIES) {
      const target = join(dirname(this.databasePath), directory);
      await rm(target, { force: true, recursive: true });
      const source = join(destinationRoot, directory);
      await mkdir(target, { recursive: true });
      const files = await readdir(source, { withFileTypes: true }).catch(() => []);
      for (const entry of files) {
        if (!entry.isFile()) continue;
        const relativePath = join(directory, entry.name);
        const sourcePath = join(source, entry.name);
        const targetPath = join(dirname(this.databasePath), relativePath);
        await copyFile(sourcePath, targetPath);
      }
    }
  }

  private async listArchiveEntries(path: string): Promise<string[]> {
    const workspace = await mkdtemp(join(dirname(path), '.arava-restore-'));
    try {
      const entries: string[] = [];
      const invalidEntries: string[] = [];
      await tarClient.list({
        file: path,
        cwd: workspace,
        gzip: BACKUP_ARCHIVE_GZIP,
        onentry: (entry: { path: string }) => {
          const normalized = posix.normalize(entry.path);
          if (!isSafeManifestPath(normalized) && !normalized.endsWith('/')) {
            invalidEntries.push(normalized);
            return;
          }
          entries.push(normalized);
        },
      });
      if (invalidEntries.length > 0) {
        throw new Error('Найдено недопустимое имя файла в архиве резервной копии.');
      }
      return entries;
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }

  async runAutomaticBackup(): Promise<BackupEntry | undefined> {
    await this.initializePreferences();
    const validBackupExists = (await this.listEntries()).some(
      ({ integrity }) => integrity === 'VALID',
    );
    if (!validBackupExists) await this.setSetting(SETTINGS.lastSuccessfulAt, '');
    if ((await this.getSetting(SETTINGS.automaticEnabled)) === 'false') return undefined;
    const last = await this.getSetting(SETTINGS.lastAutomaticAt);
    if (
      validBackupExists &&
      last &&
      this.now().getTime() - new Date(last).getTime() < AUTOMATIC_INTERVAL_MS
    )
      return undefined;

    await this.setSetting(SETTINGS.lastAttemptAt, this.now().toISOString());
    const configured = await this.configuredDirectory();
    try {
      const entry = await this.createManagedBackup('AUTOMATIC', configured);
      await this.recordAutomaticSuccess(entry, false);
      return entry;
    } catch (primaryError) {
      if (configured !== this.defaultBackupDirectory) {
        try {
          const fallback = await this.createManagedBackup('AUTOMATIC', this.defaultBackupDirectory);
          await this.recordAutomaticFailure(primaryError, true);
          await this.setSetting(SETTINGS.lastAutomaticAt, fallback.createdAt);
          await this.setSetting(SETTINGS.lastSuccessfulAt, fallback.createdAt);
          return fallback;
        } catch (fallbackError) {
          await this.recordAutomaticFailure(fallbackError, false);
          return undefined;
        }
      }
      await this.recordAutomaticFailure(primaryError, false);
      return undefined;
    }
  }

  private async createManagedBackup(type: BackupType, directory?: string): Promise<BackupEntry> {
    const targetDirectory = directory ?? (await this.configuredDirectory());
    await this.ensureWritableDirectory(targetDirectory);
    let path = join(targetDirectory, backupFileName(type, this.now()));
    let suffix = 2;
    while (await pathExists(path)) {
      path = join(
        targetDirectory,
        backupFileName(type, this.now()).replace(BACKUP_EXTENSION, `-${String(suffix)}.db`),
      );
      suffix += 1;
    }
    const entry = await this.createSnapshot(path, type);
    if (type === 'AUTOMATIC') await this.applyRetention(targetDirectory);
    return entry;
  }

  private async createSnapshot(path: string, type: BackupType): Promise<BackupEntry> {
    await this.ensureWritableDirectory(dirname(path));
    await this.ensureDiskSpace(dirname(path));
    if (await pathExists(path))
      throw new DomainError('CONFLICT', 'Файл с таким именем уже существует.');

    const stagingDirectory = await mkdtemp(join(dirname(path), '.arava-backup-'));
    const stagedDatabase = join(stagingDirectory, BACKUP_DATABASE_FILE);
    try {
      await this.database.$queryRawUnsafe('PRAGMA wal_checkpoint(PASSIVE)');
      await this.database.$executeRawUnsafe(`VACUUM INTO ${sqliteString(stagedDatabase)}`);
      await this.assertDatabaseFile(stagedDatabase);
      const sourceMediaRoot = dirname(this.databasePath);
      const mediaFiles = await this.collectManagedMedia(sourceMediaRoot);
      for (const file of mediaFiles) {
        await this.copyManagedMediaToStage(stagingDirectory, file.path, sourceMediaRoot);
      }
      const { size: databaseSize, sha256 } = await getFileStats(stagedDatabase);
      const manifest: BackupManifest = {
        backupVersion: BACKUP_FORMAT_VERSION,
        createdAt: this.now().toISOString(),
        database: {
          path: BACKUP_DATABASE_FILE,
          sha256,
          size: databaseSize,
        },
        format: BACKUP_FORMAT,
        media: mediaFiles,
        type,
      };
      await writeFile(
        join(stagingDirectory, BACKUP_MANIFEST_FILE),
        JSON.stringify(manifest),
        'utf8',
      );
      await tarClient.create(
        {
          cwd: stagingDirectory,
          file: path,
          gzip: BACKUP_ARCHIVE_GZIP,
          portable: true,
        },
        ['.'],
      );
      const validation = await this.validateArchiveBackup(path, true, type);
      if (!validation.canRestore)
        throw new Error('Созданная копия не прошла проверку целостности.');
      const entry = await this.entryForPath(path, {
        createdAt: this.now().toISOString(),
        integrity: 'VALID',
        type,
      });
      await this.writeMetadata(path, {
        createdAt: entry.createdAt,
        integrity: 'VALID',
        type,
      });
      if (type !== 'RESTORE_SAFETY')
        await this.setSetting(SETTINGS.lastSuccessfulAt, entry.createdAt);
      return entry;
    } catch (error) {
      await rm(path, { force: true });
      await rm(metadataPath(path), { force: true });
      if (error instanceof DomainError) throw error;
      throw new DomainError('CONFLICT', friendlyFileError(error));
    } finally {
      await rm(stagingDirectory, { force: true, recursive: true });
    }
  }

  private async validatePath(
    path: string,
    updateMetadata: boolean,
    type = backupTypeFromName(basename(path)),
  ): Promise<BackupValidationResult> {
    let database: DatabaseClient | undefined;
    try {
      const header = await readFile(path, { encoding: 'latin1' });
      if (header.startsWith('SQLite format 3\0')) {
        return await this.validateLegacyBackup(path, updateMetadata, type);
      }
      return await this.validateArchiveBackup(path, updateMetadata, type);
    } catch (error) {
      if (updateMetadata) {
        const existing = await this.readMetadata(path);
        if (existing)
          await this.writeMetadata(path, { ...existing, integrity: 'INVALID' }).catch(
            () => undefined,
          );
      }
      if (error instanceof DomainError) throw error;
      return {
        canRestore: false,
        integrity: 'INVALID',
        message: `Файл повреждён. Восстановление заблокировано. ${friendlyFileError(error)}`,
      };
    } finally {
      if (database) await closeDatabase(database).catch(() => undefined);
    }
  }

  private async validateLegacyBackup(
    path: string,
    updateMetadata: boolean,
    type: BackupType,
  ): Promise<BackupValidationResult> {
    let database: DatabaseClient | undefined;
    try {
      await this.assertDatabaseFile(path);
      database = createDatabaseClient(`${toSqliteUrl(path)}?connection_limit=1`);
      await database.$connect();
      await this.assertIntegrity(database, updateMetadata ? 'integrity_check' : 'quick_check');
      const tables = await database.$queryRawUnsafe<SqliteName[]>(
        `SELECT name FROM sqlite_master WHERE type = 'table'`,
      );
      const names = new Set(tables.map(({ name }) => name));
      if (REQUIRED_TABLES.some((name) => !names.has(name)))
        return {
          canRestore: false,
          integrity: 'INVALID',
          message: 'Файл не является резервной копией ARAVA CRM.',
        };

      const migrations = await database.$queryRawUnsafe<MigrationRow[]>(
        'SELECT "id" FROM "_AppMigration" ORDER BY "id"',
      );
      const supported = new Set(runtimeMigrations.map(({ id }) => id));
      if (migrations.some(({ id }) => !supported.has(id)))
        return {
          canRestore: false,
          integrity: 'VALID',
          message:
            'Эта резервная копия создана в более новой версии ARAVA CRM. Обновите приложение перед восстановлением.',
          migrationLevel: migrations.at(-1)?.id,
        };

      const backupMetadata = await this.readMetadata(path);
      const entry = await this.entryForPath(path, {
        createdAt: backupMetadata?.createdAt ?? (await stat(path)).mtime.toISOString(),
        integrity: backupMetadata?.integrity ?? 'VALID',
        type,
      });
      if (updateMetadata)
        await this.writeMetadata(path, {
          createdAt: entry.createdAt,
          integrity: 'VALID',
          type: entry.type,
        }).catch(() => undefined);
      return {
        backup: entry,
        canRestore: true,
        integrity: 'VALID',
        message:
          'Резервная копия исправна и может быть восстановлена. Медиафайлы не были включены в этот формат, для новых данных используйте актуальную копию.',
        migrationLevel: migrations.at(-1)?.id ?? 'Не определён',
      };
    } catch (error) {
      if (updateMetadata) {
        const existing = await this.readMetadata(path);
        if (existing)
          await this.writeMetadata(path, { ...existing, integrity: 'INVALID' }).catch(
            () => undefined,
          );
      }
      return {
        canRestore: false,
        integrity: 'INVALID',
        message: `Файл повреждён. Восстановление заблокировано. ${friendlyFileError(error)}`,
      };
    } finally {
      if (database) await closeDatabase(database).catch(() => undefined);
    }
  }

  private async validateArchiveBackup(
    path: string,
    updateMetadata: boolean,
    type: BackupType,
  ): Promise<BackupValidationResult> {
    const workspace = await mkdtemp(join(dirname(path), '.arava-restore-'));
    let database: DatabaseClient | undefined;
    let migrations: MigrationRow[] = [];
    try {
      const listedEntries = await this.listArchiveEntries(path);
      if (!listedEntries.includes(BACKUP_MANIFEST_FILE))
        return {
          canRestore: false,
          integrity: 'INVALID',
          message: 'В архиве отсутствует файл манифеста резервной копии.',
        };
      if (!listedEntries.includes(BACKUP_DATABASE_FILE))
        return {
          canRestore: false,
          integrity: 'INVALID',
          message: 'В архиве отсутствует файл базы данных.',
        };

      await tarClient.extract({
        file: path,
        cwd: workspace,
        gzip: BACKUP_ARCHIVE_GZIP,
      });

      const manifest = await this.readArchiveManifest(join(workspace, BACKUP_MANIFEST_FILE));
      if (manifest.format !== BACKUP_FORMAT || manifest.backupVersion !== BACKUP_FORMAT_VERSION)
        return {
          canRestore: false,
          integrity: 'INVALID',
          message: `Неподдерживаемая версия формата резервной копии: ${String(manifest.backupVersion)}.`,
        };
      const databaseFile = join(workspace, BACKUP_DATABASE_FILE);
      await this.assertDatabaseFile(databaseFile);
      database = createDatabaseClient(`${toSqliteUrl(databaseFile)}?connection_limit=1`);
      try {
        await database.$connect();
        await this.assertIntegrity(database, 'quick_check');
        const tables = await database.$queryRawUnsafe<SqliteName[]>(
          `SELECT name FROM sqlite_master WHERE type = 'table'`,
        );
        const names = new Set(tables.map(({ name }) => name));
        if (REQUIRED_TABLES.some((name) => !names.has(name)))
          return {
            canRestore: false,
            integrity: 'INVALID',
            message: 'Архив не является резервной копией ARAVA CRM.',
          };

        migrations = await database.$queryRawUnsafe<MigrationRow[]>(
          'SELECT "id" FROM "_AppMigration" ORDER BY "id"',
        );
        const supported = new Set(runtimeMigrations.map(({ id }) => id));
        if (migrations.some(({ id }) => !supported.has(id)))
          return {
            canRestore: false,
            integrity: 'VALID',
            message:
              'Эта резервная копия создана в более новой версии ARAVA CRM. Обновите приложение перед восстановлением.',
            migrationLevel: migrations.at(-1)?.id,
          };
      } finally {
        await closeDatabase(database).catch(() => undefined);
        database = undefined;
      }

      const listed = new Set(listedEntries);
      const manifestMedia = new Set(manifest.media.map(({ path }) => path));
      for (const entry of listedEntries) {
        if (entry.endsWith('/')) continue;
        if (!isSafeManifestPath(entry)) {
          return {
            canRestore: false,
            integrity: 'INVALID',
            message: `Архив содержит недопустимое имя: ${entry}.`,
          };
        }
        if (entry !== BACKUP_MANIFEST_FILE && entry !== BACKUP_DATABASE_FILE) {
          if (!manifestMedia.has(entry) || !isAllowedMediaPath(entry)) {
            return {
              canRestore: false,
              integrity: 'INVALID',
              message: `Архив содержит неподдерживаемый файл: ${entry}.`,
            };
          }
        }
      }
      for (const mediaPath of manifest.media.map(({ path }) => path)) {
        if (!listed.has(mediaPath))
          return {
            canRestore: false,
            integrity: 'INVALID',
            message: `Файл медиа, объявленный в манифесте, отсутствует в архиве: ${mediaPath}.`,
          };
      }

      const warnings: string[] = [];
      for (const media of manifest.media) {
        const staged = join(workspace, media.path);
        try {
          const actual = await getFileStats(staged);
          if (actual.size !== media.size || actual.sha256 !== media.sha256) {
            warnings.push(`Файл media повреждён или изменился: ${media.path}`);
          }
        } catch {
          warnings.push(`Файл media отсутствует в архиве: ${media.path}`);
        }
      }

      const entry = await this.entryForPath(path, {
        createdAt: manifest.createdAt,
        integrity: warnings.length > 0 ? 'VALID' : 'VALID',
        type,
      });
      if (updateMetadata)
        await this.writeMetadata(path, {
          createdAt: entry.createdAt,
          integrity: warnings.length > 0 ? 'VALID' : 'VALID',
          type: entry.type,
        }).catch(() => undefined);
      return {
        backup: entry,
        canRestore: true,
        integrity: warnings.length > 0 ? 'VALID' : 'VALID',
        message:
          warnings.length > 0
            ? `Копия проверена с предупреждениями: ${warnings.join(' ')}`
            : 'Резервная копия исправна и может быть восстановлена.',
        migrationLevel: migrations.at(-1)?.id ?? 'Не определён',
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('недопустимое имя')) {
        return {
          canRestore: false,
          integrity: 'INVALID',
          message: error.message,
        };
      }
      if (updateMetadata) {
        await this.writeMetadata(path, {
          createdAt: this.now().toISOString(),
          integrity: 'INVALID',
          type: backupTypeFromName(basename(path)),
        }).catch(() => undefined);
      }
      return {
        canRestore: false,
        integrity: 'INVALID',
        message: `Файл повреждён. Восстановление заблокировано. ${friendlyFileError(error)}`,
      };
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }

  private async registerRestoreSelection(
    path: string,
    type: BackupType,
  ): Promise<BackupRestoreSelection> {
    const validation = await this.validatePath(path, false, type);
    const selectionId = randomUUID();
    if (validation.canRestore)
      this.restoreSelections.set(selectionId, {
        expiresAt: this.now().getTime() + SELECTION_TTL_MS,
        path,
      });
    return { ...validation, displayPath: path, selectionId };
  }

  private async assertDatabaseFile(path: string, requireActive?: boolean): Promise<void> {
    if (normalize(resolve(path)) === normalize(this.databasePath))
      throw new Error('Рабочую базу нельзя использовать как файл восстановления.');
    const information = await lstat(path);
    if (!information.isFile() || information.size < 100)
      throw new Error('Файл пуст или имеет неверный формат.');
    const handle = await open(path, requireActive ? 'r+' : 'r');
    try {
      const header = Buffer.alloc(16);
      await handle.read(header, 0, header.length, 0);
      if (header.toString('utf8') !== 'SQLite format 3\0')
        throw new Error('Файл не является базой SQLite.');
    } finally {
      await handle.close();
    }
  }

  private async assertIntegrity(
    database: DatabaseClient,
    mode: 'integrity_check' | 'quick_check',
  ): Promise<void> {
    const rows = await database.$queryRawUnsafe<SqliteCheckRow[]>(`PRAGMA ${mode}`);
    const values = rows.map((row) => row[mode]);
    if (values.length !== 1 || values[0] !== 'ok')
      throw new Error(values.filter(Boolean).join('; ') || 'Проверка SQLite не пройдена.');
  }

  private async listEntries(): Promise<BackupEntry[]> {
    const directories = new Set([this.defaultBackupDirectory, await this.configuredDirectory()]);
    const entries: BackupEntry[] = [];
    for (const directory of directories) {
      let names: string[];
      try {
        names = await readdir(directory);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.startsWith(BACKUP_PREFIX) || !name.toLowerCase().endsWith(BACKUP_EXTENSION))
          continue;
        const path = join(directory, name);
        try {
          const metadata = await this.readMetadata(path);
          entries.push(
            await this.entryForPath(path, {
              createdAt: metadata?.createdAt ?? (await stat(path)).mtime.toISOString(),
              integrity: metadata?.integrity ?? 'UNCHECKED',
              type: metadata?.type ?? backupTypeFromName(name),
            }),
          );
        } catch {
          // A disconnected drive or concurrently removed file is omitted from the current view.
        }
      }
    }
    return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private async entryForPath(path: string, metadata: BackupMetadata): Promise<BackupEntry> {
    return {
      ...metadata,
      fileName: basename(path),
      id: backupId(path),
      location: path,
      size: (await stat(path)).size,
    };
  }

  private async readMetadata(path: string): Promise<BackupMetadata | undefined> {
    try {
      const value = JSON.parse(
        await readFile(metadataPath(path), 'utf8'),
      ) as Partial<BackupMetadata>;
      if (
        typeof value.createdAt !== 'string' ||
        !['VALID', 'INVALID', 'UNCHECKED'].includes(value.integrity ?? '') ||
        !['AUTOMATIC', 'MANUAL', 'RESTORE_SAFETY'].includes(value.type ?? '')
      )
        return undefined;
      return value as BackupMetadata;
    } catch {
      return undefined;
    }
  }

  private async writeMetadata(path: string, metadata: BackupMetadata): Promise<void> {
    const target = metadataPath(path);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(metadata, undefined, 2)}\n`, { flag: 'wx' });
    await rename(temporary, target);
  }

  private async ensureWritableDirectory(path: string): Promise<void> {
    try {
      await mkdir(path, { recursive: true });
      await access(path, constants.R_OK | constants.W_OK);
    } catch (error) {
      throw new DomainError('VALIDATION', friendlyFileError(error));
    }
  }

  private async ensureDiskSpace(directory: string): Promise<void> {
    const [space, source] = await Promise.all([statfs(directory), stat(this.databasePath)]);
    const available = space.bavail * space.bsize;
    if (available < Math.max(MINIMUM_FREE_SPACE, source.size * 2))
      throw new DomainError('CONFLICT', 'Недостаточно свободного места для резервной копии.');
  }

  private async applyRetention(directory: string): Promise<void> {
    const retention = Number(await this.getSetting(SETTINGS.retentionCount));
    const keep = Number.isInteger(retention) && retention > 0 ? retention : DEFAULT_RETENTION_COUNT;
    const automatic = (await this.listEntries())
      .filter((entry) => entry.type === 'AUTOMATIC' && dirname(entry.location) === directory)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    for (const entry of automatic.slice(keep)) {
      await rm(entry.location, { force: true });
      await rm(metadataPath(entry.location), { force: true });
    }
  }

  private async status(): Promise<BackupStatus> {
    const entries = await this.listEntries();
    const failureValue = Number(await this.getSetting(SETTINGS.consecutiveFailures));
    const lastError = await this.getSetting(SETTINGS.lastError);
    const retentionValue = Number(await this.getSetting(SETTINGS.retentionCount));
    return {
      automaticEnabled: (await this.getSetting(SETTINGS.automaticEnabled)) !== 'false',
      backupDirectory: await this.configuredDirectory(),
      consecutiveFailures: Number.isFinite(failureValue) ? failureValue : 0,
      count: entries.length,
      lastAttemptAt: (await this.getSetting(SETTINGS.lastAttemptAt)) ?? undefined,
      lastError: lastError?.length ? lastError : undefined,
      lastSuccessfulAt: (await this.getSetting(SETTINGS.lastSuccessfulAt)) ?? undefined,
      retentionCount: retentionValue > 0 ? retentionValue : DEFAULT_RETENTION_COUNT,
      totalSize: entries.reduce((sum, entry) => sum + entry.size, 0),
      usingLocalFallback: (await this.getSetting(SETTINGS.usingLocalFallback)) === 'true',
    };
  }

  private async refreshLastSuccessfulAt(): Promise<void> {
    const latest = (await this.listEntries()).find(({ integrity }) => integrity === 'VALID');
    await this.setSetting(SETTINGS.lastSuccessfulAt, latest?.createdAt ?? '');
  }

  private async configuredDirectory(): Promise<string> {
    return resolve(
      (await this.getSetting(SETTINGS.customDirectory)) ?? this.defaultBackupDirectory,
    );
  }

  private async recordAutomaticSuccess(entry: BackupEntry, fallback: boolean): Promise<void> {
    await Promise.all([
      this.setSetting(SETTINGS.consecutiveFailures, '0'),
      this.setSetting(SETTINGS.lastAutomaticAt, entry.createdAt),
      this.setSetting(SETTINGS.lastError, ''),
      this.setSetting(SETTINGS.lastSuccessfulAt, entry.createdAt),
      this.setSetting(SETTINGS.usingLocalFallback, String(fallback)),
    ]);
  }

  private async recordAutomaticFailure(error: unknown, fallback: boolean): Promise<void> {
    const failures = Number(await this.getSetting(SETTINGS.consecutiveFailures)) || 0;
    await Promise.all([
      this.setSetting(SETTINGS.consecutiveFailures, String(failures + 1)),
      this.setSetting(SETTINGS.lastError, friendlyFileError(error)),
      this.setSetting(SETTINGS.usingLocalFallback, String(fallback)),
    ]);
  }

  private async getSetting(key: string): Promise<string | null> {
    return (await this.database.appSetting.findUnique({ where: { key } }))?.value ?? null;
  }

  private async setSetting(key: string, value: string): Promise<void> {
    await this.database.appSetting.upsert({
      create: { key, value },
      update: { value },
      where: { key },
    });
  }

  private async owner(token: string) {
    const actor = await this.application.authenticate(token);
    assertCapability(actor, 'canManageBackups');
    return actor;
  }

  private async audit(actorUserId: string, action: string, detail: string): Promise<void> {
    await this.database.auditLog.create({
      data: {
        action,
        actorUserId,
        detail,
        entityId: 'local-backup',
        entityType: 'Backup',
      },
    });
  }

  private async writeExternalLog(message: string, actorId: string, source: string): Promise<void> {
    await mkdir(dirname(this.externalLogPath), { recursive: true });
    await appendFile(
      this.externalLogPath,
      `${this.now().toISOString()}\t${message}\tOWNER=${actorId}\tSOURCE=${basename(source)}\n`,
      'utf8',
    ).catch(() => undefined);
  }
}
