import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../../..');

function resolveVersion(packageVersion: string, buildVersion?: string) {
  const environment = { ...process.env };
  delete environment.ARAVA_BUILD_VERSION;
  if (buildVersion) environment.ARAVA_BUILD_VERSION = buildVersion;

  return JSON.parse(
    execFileSync(
      process.execPath,
      [resolve(projectRoot, 'scripts/build-version.mjs'), packageVersion],
      {
        encoding: 'utf8',
        env: environment,
      },
    ),
  ) as { version: string; builderArguments: string[] };
}

describe('build version pipeline', () => {
  it('uses the package version for a stable build', () => {
    expect(resolveVersion('0.5.2')).toEqual({
      version: '0.5.2',
      builderArguments: ['--config.extraMetadata.version=0.5.2'],
    });
  });

  it('passes the development version to Electron Builder from one source', () => {
    expect(resolveVersion('0.5.2', '0.5.3-dev.42')).toEqual({
      version: '0.5.3-dev.42',
      builderArguments: ['--config.extraMetadata.version=0.5.3-dev.42'],
    });
  });

  it('rejects an invalid development version', () => {
    expect(() => resolveVersion('0.5.2', 'dev latest')).toThrow();
  });
});
