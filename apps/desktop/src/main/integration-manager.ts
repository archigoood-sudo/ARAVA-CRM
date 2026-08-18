import type { IntegrationCredentialStore, IntegrationService } from '@arava/database';
import { safeStorage } from 'electron';
import log from 'electron-log/main';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface StoredCredential {
  deviceId: string;
  encryptedToken?: string;
}

export class ElectronIntegrationCredentialStore implements IntegrationCredentialStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, 'integration', 'device.json');
  }

  private async read(): Promise<StoredCredential> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'deviceId' in parsed &&
        typeof parsed.deviceId === 'string'
      ) {
        return {
          deviceId: parsed.deviceId,
          ...('encryptedToken' in parsed && typeof parsed.encryptedToken === 'string'
            ? { encryptedToken: parsed.encryptedToken }
            : {}),
        };
      }
    } catch {
      // A missing or incomplete file is initialized below.
    }
    const value = { deviceId: randomUUID() };
    await this.write(value);
    return value;
  }

  private async write(value: StoredCredential): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  async getDeviceId(): Promise<string> {
    return (await this.read()).deviceId;
  }

  async getToken(): Promise<string | undefined> {
    const stored = await this.read();
    if (!stored.encryptedToken) return undefined;
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(stored.encryptedToken, 'base64'));
    } catch {
      return undefined;
    }
  }

  async saveToken(token: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Безопасное хранилище операционной системы недоступно.');
    }
    const stored = await this.read();
    await this.write({
      deviceId: stored.deviceId,
      encryptedToken: safeStorage.encryptString(token).toString('base64'),
    });
  }

  async clearToken(): Promise<void> {
    const stored = await this.read();
    await this.write({ deviceId: stored.deviceId });
  }
}

export class IntegrationManager {
  private interval: ReturnType<typeof setInterval> | undefined;

  constructor(readonly service: IntegrationService) {}

  async initialize(): Promise<void> {
    await this.service.initialize();
    this.interval = setInterval(() => {
      void this.service.processPending().catch((error: unknown) => {
        log.warn('Background integration sync failed', {
          message: error instanceof Error ? error.message : 'unknown error',
        });
      });
    }, 60_000);
    this.interval.unref();
    void this.service.processPending().catch((error: unknown) => {
      log.warn('Startup integration sync deferred', {
        message: error instanceof Error ? error.message : 'unknown error',
      });
    });
  }

  schedule(): void {
    setTimeout(() => {
      void this.service.processPending().catch((error: unknown) => {
        log.warn('Scheduled integration sync failed', {
          message: error instanceof Error ? error.message : 'unknown error',
        });
      });
    }, 500).unref();
  }

  shutdown(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
  }
}
