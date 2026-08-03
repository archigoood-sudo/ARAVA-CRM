import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const generatedDirectories = [
  'apps/desktop/.packaging',
  'apps/desktop/.tsbuild',
  'apps/desktop/out',
  'apps/desktop/release',
  'packages/config/dist',
  'packages/database/dist',
  'packages/shared/dist',
  'packages/ui/dist',
  'coverage',
  'playwright-report',
  'test-results',
];

await Promise.all(
  generatedDirectories.map((directory) =>
    rm(resolve(projectRoot, directory), { force: true, recursive: true }),
  ),
);
