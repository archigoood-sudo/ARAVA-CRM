import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutomaticBackupManager } from './automatic-backup-manager';

describe('automatic backup manager', () => {
  afterEach(() => vi.useRealTimers());

  it('checks at startup and periodically without overlapping runs', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const runAutomaticBackup = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          release = () => resolve(undefined);
        }),
    );
    const manager = new AutomaticBackupManager({ runAutomaticBackup }, { checkIntervalMs: 1_000 });

    const initializing = manager.initialize();
    expect(runAutomaticBackup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runAutomaticBackup).toHaveBeenCalledTimes(1);
    release?.();
    await initializing;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runAutomaticBackup).toHaveBeenCalledTimes(2);
    release?.();
    vi.runAllTicks();
    manager.shutdown();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runAutomaticBackup).toHaveBeenCalledTimes(2);
  });
});
