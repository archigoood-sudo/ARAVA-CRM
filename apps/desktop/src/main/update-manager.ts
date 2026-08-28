import type { DesktopUpdateState, UserRole } from '@arava/shared';
import type { AppUpdater } from 'electron-updater';

const STARTUP_CHECK_DELAY_MS = 15_000;
const PERIODIC_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

interface UpdateActor {
  role: UserRole;
}

export interface UpdateAuthorization {
  authenticate: (token: string) => Promise<UpdateActor>;
}

export interface UpdateController {
  check: (token: string) => Promise<DesktopUpdateState>;
  download: (token: string) => Promise<DesktopUpdateState>;
  getState: (token: string) => Promise<DesktopUpdateState>;
  install: (token: string) => Promise<void>;
}

interface UpdateManagerOptions {
  channel?: 'dev' | 'latest';
  currentVersion: string;
  intervalMs?: number;
  now?: () => Date;
  openExternal: (url: string) => Promise<void>;
  platform: NodeJS.Platform;
  prepareForInstall: () => Promise<void>;
  startupDelayMs?: number;
  supported: boolean;
}

const MAC_RELEASE_DOWNLOAD_BASE = 'https://github.com/archigoood-sudo/ARAVA-CRM/releases/download/';
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export function createMacReleaseDownloadUrl(version: string): string {
  if (!SEMVER_PATTERN.test(version)) throw new Error('Некорректная версия обновления.');
  const tag = encodeURIComponent(`v${version}`);
  const fileName = encodeURIComponent(`ARAVA-CRM-${version}-universal.dmg`);
  return new URL(`${tag}/${fileName}`, MAC_RELEASE_DOWNLOAD_BASE).toString();
}

export function isDesktopUpdateSupported(
  isPackaged: boolean,
  platform: NodeJS.Platform,
  disabled = false,
): boolean {
  return isPackaged && !disabled && (platform === 'win32' || platform === 'darwin');
}

export class UpdateManager implements UpdateController {
  private checkPromise: Promise<DesktopUpdateState> | undefined;
  private downloadPromise: Promise<DesktopUpdateState> | undefined;
  private initialized = false;
  private readonly listeners = new Set<(state: DesktopUpdateState) => void>();
  private periodicTimer: ReturnType<typeof setInterval> | undefined;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private state: DesktopUpdateState;

  public constructor(
    private readonly authorization: UpdateAuthorization,
    private readonly updater: AppUpdater,
    private readonly options: UpdateManagerOptions,
  ) {
    this.state = options.supported
      ? {
          currentVersion: options.currentVersion,
          installMode: options.platform === 'darwin' ? 'MANUAL' : 'AUTOMATIC',
          message: 'Обновления проверяются автоматически',
          status: 'IDLE',
        }
      : {
          currentVersion: options.currentVersion,
          installMode: 'UNSUPPORTED',
          message: 'Автоматическое обновление доступно в установленной версии для Windows и macOS',
          status: 'UNSUPPORTED',
        };
  }

  public initialize(): void {
    if (!this.options.supported || this.initialized) return;
    this.initialized = true;

    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    const developmentChannel = this.options.channel === 'dev';
    this.updater.allowPrerelease = developmentChannel;
    if (developmentChannel) this.updater.channel = 'dev';
    // electron-updater enables allowDowngrade when channel is assigned. Keep the
    // development feed monotonic so a stable bridge can never install an older
    // prerelease from the same patch line.
    this.updater.allowDowngrade = false;
    this.bindUpdaterEvents();

    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      void this.checkForUpdates().catch(() => undefined);
    }, this.options.startupDelayMs ?? STARTUP_CHECK_DELAY_MS);
    this.periodicTimer = setInterval(() => {
      void this.checkForUpdates().catch(() => undefined);
    }, this.options.intervalMs ?? PERIODIC_CHECK_INTERVAL_MS);
  }

  public shutdown(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    this.startupTimer = undefined;
    this.periodicTimer = undefined;
    this.listeners.clear();
  }

  public subscribe(listener: (state: DesktopUpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async getState(token: string): Promise<DesktopUpdateState> {
    await this.authorization.authenticate(token);
    return this.snapshot();
  }

  public async check(token: string): Promise<DesktopUpdateState> {
    await this.assertOwner(token);
    return this.checkForUpdates();
  }

  public async download(token: string): Promise<DesktopUpdateState> {
    await this.assertOwner(token);
    if (!this.options.supported) return this.snapshot();
    if (this.options.platform === 'darwin') {
      if (this.state.status !== 'AVAILABLE' || !this.state.availableVersion) {
        throw new Error('Сначала проверьте наличие обновления.');
      }
      try {
        await this.options.openExternal(createMacReleaseDownloadUrl(this.state.availableVersion));
      } catch {
        this.setError('Не удалось открыть загрузку. Проверьте интернет и повторите попытку.');
      }
      return this.snapshot();
    }
    if (this.state.status === 'DOWNLOADED') return this.snapshot();
    if (this.state.status !== 'AVAILABLE' && this.state.status !== 'ERROR') {
      throw new Error('Сначала проверьте наличие обновления.');
    }
    if (this.downloadPromise) return this.downloadPromise;

    this.setState({
      ...this.state,
      message: 'Загрузка обновления',
      progress: 0,
      status: 'DOWNLOADING',
    });
    this.downloadPromise = this.updater
      .downloadUpdate()
      .then(() => this.snapshot())
      .catch(() => {
        this.setError('Не удалось скачать обновление. Проверьте интернет и повторите попытку.');
        return this.snapshot();
      })
      .finally(() => {
        this.downloadPromise = undefined;
      });
    return this.downloadPromise;
  }

  public async install(token: string): Promise<void> {
    await this.assertOwner(token);
    if (this.options.platform === 'darwin') {
      throw new Error('Автоматическая установка на macOS недоступна.');
    }
    if (!this.options.supported || this.state.status !== 'DOWNLOADED') {
      throw new Error('Обновление ещё не готово к установке.');
    }
    await this.options.prepareForInstall();
    this.updater.quitAndInstall(false, true);
  }

  private bindUpdaterEvents(): void {
    this.updater.on('checking-for-update', () => {
      this.setState({
        currentVersion: this.options.currentVersion,
        installMode: this.state.installMode,
        message: 'Проверка обновлений…',
        status: 'CHECKING',
      });
    });
    this.updater.on('update-not-available', () => {
      this.setState({
        checkedAt: this.nowIso(),
        currentVersion: this.options.currentVersion,
        installMode: this.state.installMode,
        message: 'Установлена актуальная версия',
        status: 'CURRENT',
      });
    });
    this.updater.on('update-available', (information) => {
      this.setState({
        availableVersion: information.version,
        checkedAt: this.nowIso(),
        currentVersion: this.options.currentVersion,
        installMode: this.state.installMode,
        message: `Доступна версия ${information.version}`,
        status: 'AVAILABLE',
      });
    });
    this.updater.on('download-progress', (progress) => {
      if (this.options.platform === 'darwin') return;
      this.setState({
        ...this.state,
        message: 'Загрузка обновления',
        progress: Math.max(0, Math.min(100, Math.round(progress.percent))),
        status: 'DOWNLOADING',
      });
    });
    this.updater.on('update-downloaded', (information) => {
      if (this.options.platform === 'darwin') return;
      this.setState({
        availableVersion: information.version,
        checkedAt: this.state.checkedAt,
        currentVersion: this.options.currentVersion,
        installMode: this.state.installMode,
        message: 'Обновление готово',
        progress: 100,
        status: 'DOWNLOADED',
      });
    });
    this.updater.on('error', (error) => {
      if (/404|latest(?:-mac)?\.yml|no published versions?/iu.test(error.message)) {
        this.setState({
          checkedAt: this.nowIso(),
          currentVersion: this.options.currentVersion,
          installMode: this.state.installMode,
          message: 'Установлена актуальная версия',
          status: 'CURRENT',
        });
        return;
      }
      this.setError('Ошибка обновления. Текущая версия продолжит работать.');
    });
  }

  private checkForUpdates(): Promise<DesktopUpdateState> {
    if (!this.options.supported) return Promise.resolve(this.snapshot());
    if (this.checkPromise) return this.checkPromise;
    if (this.state.status === 'DOWNLOADING' || this.state.status === 'DOWNLOADED') {
      return Promise.resolve(this.snapshot());
    }

    this.setState({
      currentVersion: this.options.currentVersion,
      installMode: this.state.installMode,
      message: 'Проверка обновлений…',
      status: 'CHECKING',
    });
    this.checkPromise = this.updater
      .checkForUpdates()
      .then(() => this.snapshot())
      .catch(() => {
        if (this.state.status === 'CHECKING') {
          this.setError('Не удалось проверить обновления. Проверьте интернет и повторите попытку.');
        }
        return this.snapshot();
      })
      .finally(() => {
        this.checkPromise = undefined;
      });
    return this.checkPromise;
  }

  private async assertOwner(token: string): Promise<void> {
    const actor = await this.authorization.authenticate(token);
    if (actor.role !== 'OWNER') throw new Error('Управлять обновлениями может только владелец.');
  }

  private nowIso(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }

  private setError(message: string): void {
    this.setState({
      availableVersion: this.state.availableVersion,
      checkedAt: this.nowIso(),
      currentVersion: this.options.currentVersion,
      installMode: this.state.installMode,
      message,
      status: 'ERROR',
    });
  }

  private setState(state: DesktopUpdateState): void {
    this.state = state;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private snapshot(): DesktopUpdateState {
    return { ...this.state };
  }
}
