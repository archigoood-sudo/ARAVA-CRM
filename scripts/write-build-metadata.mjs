import { mkdir, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { resolveDesktopBuildVersion } from './build-version.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const metadataPath = resolve(projectRoot, 'apps/desktop/build/app-metadata.json');
const version = await resolveDesktopBuildVersion(process.env, projectRoot);
const updateChannel = process.env.ARAVA_UPDATE_CHANNEL?.trim() === 'dev' ? 'dev' : 'latest';

function getCommit() {
  const envCommit =
    process.env.ARAVA_BUILD_COMMIT?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.GITHUB_SHA1?.trim();
  if (envCommit) return envCommit.slice(0, 7);

  try {
    return execSync('git rev-parse --short HEAD', { cwd: projectRoot }).toString().trim();
  } catch {
    return 'локальная сборка';
  }
}

function getDate() {
  return (process.env.ARAVA_BUILD_DATE?.trim() || new Date().toISOString()).slice(0, 10);
}

const metadata = {
  appVersion: version,
  buildCommit: getCommit(),
  buildDate: getDate(),
  updateChannel,
};

await mkdir(join(projectRoot, 'apps/desktop/build'), { recursive: true });
await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

console.log(`Wrote ARAVA build metadata to ${metadataPath}`);
