import { existsSync, readFileSync } from 'node:fs';
import { app } from 'electron';
import { join, resolve } from 'node:path';

export interface BuildMetadata {
  appVersion: string;
  buildCommit: string;
  buildDate: string;
}

export type DesktopUpdateChannel = 'dev' | 'latest';

function getFallbackDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveMetadataPath(): string {
  const explicitPath = process.env.ARAVA_BUILD_METADATA_PATH;
  if (explicitPath) return explicitPath;

  if (app.isPackaged) return join(process.resourcesPath, 'app-metadata.json');

  return resolve(app.getAppPath(), 'build', 'app-metadata.json');
}

function readMetadataFile(path: string): Record<string, unknown> | null | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const content = readFileSync(path, 'utf8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function getBuildMetadata(): BuildMetadata {
  const fallbackVersion = app.getVersion();
  const fallbackMetadata: BuildMetadata = {
    appVersion: fallbackVersion,
    buildCommit: 'локальная сборка',
    buildDate: getFallbackDate(),
  };

  const rawMetadata = readMetadataFile(resolveMetadataPath());
  if (!rawMetadata) return fallbackMetadata;

  const metadata = rawMetadata as unknown as BuildMetadata;
  return {
    appVersion:
      typeof metadata.appVersion === 'string' && metadata.appVersion
        ? metadata.appVersion
        : fallbackVersion,
    buildCommit:
      typeof metadata.buildCommit === 'string' && metadata.buildCommit
        ? metadata.buildCommit
        : 'локальная сборка',
    buildDate:
      typeof metadata.buildDate === 'string' && metadata.buildDate
        ? metadata.buildDate
        : getFallbackDate(),
  };
}

export function getDesktopUpdateChannel(): DesktopUpdateChannel {
  return readMetadataFile(resolveMetadataPath())?.updateChannel === 'dev' ? 'dev' : 'latest';
}
