import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const sourceDirectory = resolve(projectRoot, 'node_modules/.prisma/client');
const destinationDirectory = resolve(
  projectRoot,
  'apps/desktop/.packaging/node_modules/.prisma/client',
);
const requestedTarget = process.argv[2] ?? 'native';

const nativeEngineNames = {
  darwin: 'libquery_engine-darwin.dylib.node',
  linux: 'libquery_engine-linux',
  win32: 'query_engine-windows.dll.node',
};

const targetEngine =
  requestedTarget === 'windows'
    ? 'query_engine-windows.dll.node'
    : nativeEngineNames[process.platform];

if (!targetEngine) {
  throw new Error(`Packaging Prisma is not configured for ${process.platform}.`);
}

await rm(destinationDirectory, { force: true, recursive: true });
await mkdir(destinationDirectory, { recursive: true });
await cp(sourceDirectory, destinationDirectory, { recursive: true });

const files = await readdir(destinationDirectory);
for (const file of files) {
  const isNativeEngine =
    file.startsWith('libquery_engine-') || file === 'query_engine-windows.dll.node';
  if (isNativeEngine && !file.startsWith(targetEngine)) {
    await rm(resolve(destinationDirectory, file));
  }
}

if (!files.some((file) => file.startsWith(targetEngine))) {
  throw new Error(
    `Prisma engine ${targetEngine} was not generated. Check schema.prisma binaryTargets.`,
  );
}

console.log(`Prepared Prisma ${requestedTarget} engine for Electron Builder.`);
