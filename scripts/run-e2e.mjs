import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resolveE2EMode } from './e2e-mode.mjs';

const root = resolve(import.meta.dirname, '..');
const playwright = resolve(root, 'node_modules/@playwright/test/cli.js');
const mode = resolveE2EMode(process.argv.slice(2));

for (const shard of ['1/2', '2/2']) {
  const result = spawnSync(
    process.execPath,
    [playwright, 'test', ...mode.playwrightArguments, `--shard=${shard}`],
    {
      cwd: resolve(root, 'apps/desktop'),
      env: mode.environment,
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
