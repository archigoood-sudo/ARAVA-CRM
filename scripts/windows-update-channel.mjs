export const WINDOWS_DEVELOPMENT_BRIDGE_VERSION = '0.5.2';

export function getWindowsUpdateChannel(version) {
  return version === WINDOWS_DEVELOPMENT_BRIDGE_VERSION ? 'dev' : 'latest';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${getWindowsUpdateChannel(process.argv[2] ?? '')}\n`);
}
import { pathToFileURL } from 'node:url';
