import { readFile } from 'node:fs/promises';

const desktopPackage = JSON.parse(
  await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'),
);
const expectedTag = `v${desktopPackage.version}`;
const actualTag = process.env.RELEASE_TAG;

if (actualTag !== expectedTag) {
  throw new Error(`Release tag ${actualTag ?? '(missing)'} must match ${expectedTag}`);
}

console.log(`Release tag ${actualTag} matches application version ${desktopPackage.version}.`);
