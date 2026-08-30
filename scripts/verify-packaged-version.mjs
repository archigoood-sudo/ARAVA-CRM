import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const [expectedVersion, metadataPath, asarPath, plistPath] = process.argv.slice(2);
if (!expectedVersion || !metadataPath || !asarPath) {
  throw new Error(
    'Usage: verify-packaged-version.mjs <version> <app-metadata.json> <app.asar> [Info.plist]',
  );
}

const require = createRequire(import.meta.url);
const { extractFile } = require('@electron/asar');
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
const packagedMetadata = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'));

if (metadata.appVersion !== expectedVersion) {
  throw new Error(`About metadata version mismatch: ${metadata.appVersion} != ${expectedVersion}`);
}
if (packagedMetadata.version !== expectedVersion) {
  throw new Error(
    `Electron package version mismatch: ${packagedMetadata.version} != ${expectedVersion}`,
  );
}

if (plistPath) {
  const plist = require('plist').parse(await readFile(plistPath, 'utf8'));
  if (plist.CFBundleShortVersionString !== expectedVersion) {
    throw new Error(
      `macOS bundle version mismatch: ${plist.CFBundleShortVersionString} != ${expectedVersion}`,
    );
  }
}

console.log(`Packaged version is consistent: ${expectedVersion}`);
