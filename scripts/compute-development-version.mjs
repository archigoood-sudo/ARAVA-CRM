const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const BUILD_NUMBER_PATTERN = /^[1-9]\d*$/u;

export function computeDevelopmentVersion(stableVersion, buildNumber) {
  const match = STABLE_VERSION_PATTERN.exec(stableVersion);
  if (!match) throw new Error(`Expected a stable SemVer, received: ${stableVersion}`);
  if (!BUILD_NUMBER_PATTERN.test(String(buildNumber))) {
    throw new Error(`Expected a positive build number, received: ${buildNumber}`);
  }

  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}-dev.${buildNumber}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(
    `${computeDevelopmentVersion(process.argv[2] ?? '', process.argv[3] ?? '')}\n`,
  );
}
import { pathToFileURL } from 'node:url';
