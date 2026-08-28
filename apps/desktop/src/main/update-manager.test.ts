import type { UserRole } from '@arava/shared';
import type { AppUpdater } from 'electron-updater';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMacReleaseDownloadUrl,
  isDesktopUpdateSupported,
  UpdateManager,
} from './update-manager';

class MockUpdater extends EventEmitter {
  private configuredChannel: string | null | undefined;

  public allowDowngrade = true;
  public allowPrerelease = true;
  public autoDownload = true;
  public autoInstallOnAppQuit = true;
  public checkForUpdates = vi.fn(() => Promise.resolve(null));
  public downloadUpdate = vi.fn(() => Promise.resolve([] as string[]));
  public quitAndInstall = vi.fn();

  public get channel(): string | null | undefined {
    return this.configuredChannel;
  }

  public set channel(value: string | null | undefined) {
    this.configuredChannel = value;
    // Match electron-updater: assigning a channel enables downgrade unless the
    // application explicitly disables it afterwards.
    this.allowDowngrade = true;
  }
}

function createManager(
  role: UserRole = 'OWNER',
  overrides: {
    openExternal?: (url: string) => Promise<void>;
    platform?: NodeJS.Platform;
    prepareForInstall?: () => Promise<void>;
    supported?: boolean;
    channel?: 'dev' | 'latest';
  } = {},
) {
  const updater = new MockUpdater();
  const authorization = {
    authenticate: vi.fn(() => Promise.resolve({ role })),
  };
  const platform = overrides.platform ?? 'darwin';
  const openExternal = overrides.openExternal ?? vi.fn(() => Promise.resolve());
  const manager = new UpdateManager(authorization, updater as unknown as AppUpdater, {
    ...(overrides.channel ? { channel: overrides.channel } : {}),
    currentVersion: '0.4.6',
    now: () => new Date('2026-08-25T10:00:00.000Z'),
    openExternal,
    platform,
    prepareForInstall: overrides.prepareForInstall ?? vi.fn(() => Promise.resolve()),
    startupDelayMs: 10,
    supported: overrides.supported ?? isDesktopUpdateSupported(true, platform),
  });
  manager.initialize();
  return { authorization, manager, openExternal, updater };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('UpdateManager', () => {
  it.each(['win32', 'darwin'] satisfies NodeJS.Platform[])(
    'supports installed %s applications and keeps development builds disabled',
    (platform) => {
      expect(isDesktopUpdateSupported(true, platform)).toBe(true);
      expect(isDesktopUpdateSupported(false, platform)).toBe(false);
      expect(isDesktopUpdateSupported(true, platform, true)).toBe(false);
    },
  );

  it('opens only the safe GitHub DMG for a macOS update and never self-installs', async () => {
    const prepareForInstall = vi.fn(() => Promise.resolve());
    const openExternal = vi.fn(() => Promise.resolve());
    const { manager, updater } = createManager('OWNER', {
      openExternal,
      platform: 'darwin',
      prepareForInstall,
    });
    updater.checkForUpdates.mockImplementationOnce(() => {
      updater.emit('update-available', { version: '0.4.7' });
      return Promise.resolve(null);
    });

    await expect(manager.check('owner-token')).resolves.toMatchObject({
      installMode: 'MANUAL',
      status: 'AVAILABLE',
    });
    const downloadState = await manager.download('owner-token');
    expect(downloadState).toMatchObject({
      installMode: 'MANUAL',
      status: 'AVAILABLE',
    });
    await expect(manager.install('owner-token')).rejects.toThrow(
      'Автоматическая установка на macOS недоступна',
    );

    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/archigoood-sudo/ARAVA-CRM/releases/download/v0.4.7/ARAVA-CRM-0.4.7-universal.dmg',
    );
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(prepareForInstall).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(JSON.stringify(downloadState)).not.toContain('github.com');
    expect(JSON.stringify(downloadState)).not.toContain('.dmg');
    expect(JSON.stringify(downloadState)).not.toContain('/Users/');
    manager.shutdown();
  });

  it('rejects unsafe versions before opening an external macOS URL', () => {
    expect(() => createMacReleaseDownloadUrl('../latest')).toThrow('Некорректная версия');
  });

  it('reports that the installed version is current', async () => {
    const { manager, updater } = createManager();
    updater.checkForUpdates.mockImplementationOnce(() => {
      updater.emit('update-not-available', { version: '0.4.6' });
      return Promise.resolve(null);
    });

    await expect(manager.check('owner-token')).resolves.toMatchObject({
      currentVersion: '0.4.6',
      installMode: 'MANUAL',
      status: 'CURRENT',
    });
    manager.shutdown();
  });

  it('reports an available update without downloading it automatically', async () => {
    const { manager, updater } = createManager('OWNER', { platform: 'win32' });
    updater.checkForUpdates.mockImplementationOnce(() => {
      updater.emit('update-available', { version: '0.4.7' });
      return Promise.resolve(null);
    });

    await expect(manager.check('owner-token')).resolves.toMatchObject({
      availableVersion: '0.4.7',
      installMode: 'AUTOMATIC',
      status: 'AVAILABLE',
    });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    manager.shutdown();
  });

  it('uses the isolated prerelease feed only for an explicitly built development client', () => {
    const stable = createManager('OWNER', { platform: 'win32' });
    expect(stable.updater.allowPrerelease).toBe(false);
    expect(stable.updater.channel).toBeUndefined();
    stable.manager.shutdown();

    const development = createManager('OWNER', { channel: 'dev', platform: 'win32' });
    expect(development.updater.allowPrerelease).toBe(true);
    expect(development.updater.channel).toBe('dev');
    expect(development.updater.allowDowngrade).toBe(false);
    development.manager.shutdown();
  });

  it('publishes download progress and the downloaded state', async () => {
    const { manager, updater } = createManager('OWNER', { platform: 'win32' });
    updater.emit('update-available', { version: '0.4.7' });
    updater.downloadUpdate.mockImplementationOnce(() => {
      updater.emit('download-progress', { percent: 53.7 });
      updater.emit('update-downloaded', { version: '0.4.7' });
      return Promise.resolve([]);
    });

    await expect(manager.download('owner-token')).resolves.toMatchObject({
      progress: 100,
      installMode: 'AUTOMATIC',
      status: 'DOWNLOADED',
    });
    manager.shutdown();
  });

  it('closes application services before an explicitly requested installation', async () => {
    const prepareForInstall = vi.fn(() => Promise.resolve());
    const { manager, updater } = createManager('OWNER', {
      platform: 'win32',
      prepareForInstall,
    });
    updater.emit('update-available', { version: '0.4.7' });
    updater.emit('update-downloaded', { version: '0.4.7' });

    await manager.install('owner-token');

    expect(prepareForInstall).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(prepareForInstall.mock.invocationCallOrder[0]).toBeLessThan(
      updater.quitAndInstall.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    manager.shutdown();
  });

  it('keeps a safe retryable state after a provider failure', async () => {
    const { manager, updater } = createManager();
    updater.checkForUpdates.mockImplementationOnce(() => {
      const error = new Error('request failed with token super-secret at /Users/admin/update.exe');
      updater.emit('error', error);
      return Promise.reject(error);
    });

    const state = await manager.check('owner-token');

    expect(state.status).toBe('ERROR');
    expect(JSON.stringify(state)).not.toContain('super-secret');
    expect(JSON.stringify(state)).not.toContain('/Users/admin');
    manager.shutdown();
  });

  it('treats a missing macOS release channel as no available update', async () => {
    const { manager, updater } = createManager();
    updater.checkForUpdates.mockImplementationOnce(() => {
      const error = new Error('Cannot find latest-mac.yml in the latest release artifacts');
      updater.emit('error', error);
      return Promise.reject(error);
    });

    await expect(manager.check('owner-token')).resolves.toMatchObject({ status: 'CURRENT' });
    manager.shutdown();
  });

  it('deduplicates concurrent checks', async () => {
    const { manager, updater } = createManager();
    let resolveCheck: (() => void) | undefined;
    updater.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCheck = () => resolve(null);
        }),
    );

    const first = manager.check('owner-token');
    const second = manager.check('owner-token');
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce());
    resolveCheck?.();
    await Promise.all([first, second]);

    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    manager.shutdown();
  });

  it('checks shortly after startup and periodically without duplicate initialization', async () => {
    vi.useFakeTimers();
    const { manager, updater } = createManager();
    manager.initialize();

    await vi.advanceTimersByTimeAsync(10);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    manager.shutdown();
  });

  it.each(['ADMIN', 'COACH'] satisfies UserRole[])('denies update controls to %s', async (role) => {
    const { manager, updater } = createManager(role);

    await expect(manager.check('token')).rejects.toThrow('только владелец');
    await expect(manager.download('token')).rejects.toThrow('только владелец');
    await expect(manager.install('token')).rejects.toThrow('только владелец');
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    manager.shutdown();
  });

  it('lets authenticated staff see only the safe updater state', async () => {
    const { manager } = createManager('COACH');

    await expect(manager.getState('coach-token')).resolves.toEqual({
      currentVersion: '0.4.6',
      installMode: 'MANUAL',
      message: 'Обновления проверяются автоматически',
      status: 'IDLE',
    });
    manager.shutdown();
  });

  it('does not initialize the provider in unsupported local or Linux builds', async () => {
    const { manager, updater } = createManager('OWNER', { supported: false });

    await expect(manager.check('owner-token')).resolves.toMatchObject({ status: 'UNSUPPORTED' });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    manager.shutdown();
  });
});
