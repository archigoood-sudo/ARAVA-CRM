import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function resolveBuildVersion(packageVersion, environment = process.env) {
  const version = environment.ARAVA_BUILD_VERSION?.trim() || packageVersion?.trim();
  if (!version || !VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid ARAVA build version: ${version || '<empty>'}`);
  }
  return version;
}

export function withElectronBuilderVersion(arguments_, version) {
  if (arguments_.some((argument) => argument.startsWith('--config.extraMetadata.version='))) {
    throw new Error('Electron Builder version must come from ARAVA_BUILD_VERSION.');
  }
  return [...arguments_, `--config.extraMetadata.version=${version}`];
}

export async function resolveDesktopBuildVersion(
  environment = process.env,
  projectRoot = resolve(import.meta.dirname, '..'),
) {
  const packagePath = resolve(projectRoot, 'apps/desktop/package.json');
  const packageMetadata = JSON.parse(await readFile(packagePath, 'utf8'));
  return resolveBuildVersion(packageMetadata.version, environment);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = resolveBuildVersion(process.argv[2] ?? '', process.env);
  process.stdout.write(
    `${JSON.stringify({ version, builderArguments: withElectronBuilderVersion([], version) })}\n`,
  );
}
