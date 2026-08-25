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
  linux: 'libquery_engine-',
  win32: 'query_engine-windows.dll.node',
};

const targetEngine =
  requestedTarget === 'windows'
    ? 'query_engine-windows.dll.node'
    : requestedTarget === 'mac-universal'
      ? ['libquery_engine-darwin.dylib.node', 'libquery_engine-darwin-arm64.dylib.node']
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
  const requiredEngines = Array.isArray(targetEngine) ? targetEngine : [targetEngine];
  if (isNativeEngine && !requiredEngines.some((engine) => file.startsWith(engine))) {
    await rm(resolve(destinationDirectory, file));
  }
}

const requiredEngines = Array.isArray(targetEngine) ? targetEngine : [targetEngine];
if (!requiredEngines.every((engine) => files.some((file) => file.startsWith(engine)))) {
  throw new Error(
    `Prisma engine ${requiredEngines.join(', ')} was not generated. Check schema.prisma binaryTargets.`,
  );
}

console.log(`Prepared Prisma ${requestedTarget} engine for Electron Builder.`);
