import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { resolveDesktopBuildVersion, withElectronBuilderVersion } from './build-version.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const desktopRoot = resolve(projectRoot, 'apps/desktop');
const require = createRequire(import.meta.url);
const electronBuilderCli = require.resolve('electron-builder/cli.js');
const version = await resolveDesktopBuildVersion(process.env, projectRoot);
const environment = { ...process.env, ARAVA_BUILD_VERSION: version };

const metadataResult = spawnSync(
  process.execPath,
  [resolve(projectRoot, 'scripts/write-build-metadata.mjs')],
  {
    cwd: projectRoot,
    env: environment,
    stdio: 'inherit',
  },
);
if (metadataResult.status !== 0) process.exit(metadataResult.status ?? 1);

const builderResult = spawnSync(
  process.execPath,
  [electronBuilderCli, ...withElectronBuilderVersion(process.argv.slice(2), version)],
  {
    cwd: desktopRoot,
    env: environment,
    stdio: 'inherit',
  },
);
process.exit(builderResult.status ?? 1);
