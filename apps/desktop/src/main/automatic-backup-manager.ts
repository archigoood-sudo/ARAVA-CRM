import type { BackupEntry } from '@arava/shared';

const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface AutomaticBackupRunner {
  runAutomaticBackup(): Promise<BackupEntry | undefined>;
}

export interface AutomaticBackupManagerOptions {
  checkIntervalMs?: number;
  onCreated?: (entry: BackupEntry) => void;
  onError?: (error: unknown) => void;
}

export class AutomaticBackupManager {
  private interval: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;

  constructor(
    private readonly runner: AutomaticBackupRunner,
    private readonly options: AutomaticBackupManagerOptions = {},
  ) {}

  async initialize(): Promise<void> {
    await this.run();
    this.interval = setInterval(
      () => void this.run(),
      this.options.checkIntervalMs ?? BACKUP_CHECK_INTERVAL_MS,
    );
    this.interval.unref();
  }

  shutdown(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
  }

  private run(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.runner
      .runAutomaticBackup()
      .then((entry) => {
        if (entry) this.options.onCreated?.(entry);
      })
      .catch((error: unknown) => this.options.onError?.(error))
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
}
