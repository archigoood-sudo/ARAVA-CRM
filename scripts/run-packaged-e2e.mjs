import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const candidates =
  process.platform === 'darwin'
    ? [
        resolve(root, 'apps/desktop/release/mac-arm64/ARAVA CRM.app/Contents/MacOS/ARAVA CRM'),
        resolve(root, 'apps/desktop/release/mac/ARAVA CRM.app/Contents/MacOS/ARAVA CRM'),
      ]
    : process.platform === 'win32'
      ? [resolve(root, 'apps/desktop/release/win-unpacked/ARAVA CRM.exe')]
      : [resolve(root, 'apps/desktop/release/linux-unpacked/arava-crm')];
const executablePath = process.env.ARAVA_E2E_EXECUTABLE ?? candidates.find(existsSync);
if (!executablePath) throw new Error('Packaged ARAVA CRM executable was not found');

const playwright = resolve(root, 'node_modules/@playwright/test/cli.js');
const result = spawnSync(process.execPath, [playwright, 'test'], {
  cwd: resolve(root, 'apps/desktop'),
  env: { ...process.env, ARAVA_E2E_EXECUTABLE: executablePath },
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
