import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const require = createRequire(import.meta.url);
const semver = require('semver') as {
  gt: (left: string, right: string) => boolean;
  lt: (left: string, right: string) => boolean;
};

function runScript(script: string, ...arguments_: string[]): string {
  return execFileSync(process.execPath, [resolve(projectRoot, script), ...arguments_], {
    encoding: 'utf8',
  }).trim();
}

describe('Windows update channel transition', () => {
  it('routes only the stable 0.5.2 bridge to the development feed', () => {
    expect(runScript('scripts/windows-update-channel.mjs', '0.5.1')).toBe('latest');
    expect(runScript('scripts/windows-update-channel.mjs', '0.5.2')).toBe('dev');
    expect(runScript('scripts/windows-update-channel.mjs', '0.5.3')).toBe('latest');
  });

  it('keeps every transition strictly increasing for electron-updater', () => {
    const bridge = '0.5.2';
    const nextDevelopment = runScript('scripts/compute-development-version.mjs', bridge, '17');

    expect(semver.gt(bridge, '0.5.1')).toBe(true);
    expect(semver.lt('0.5.2-dev.2', bridge)).toBe(true);
    expect(nextDevelopment).toBe('0.5.3-dev.17');
    expect(semver.gt(nextDevelopment, bridge)).toBe(true);
  });
});
