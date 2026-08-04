import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const legacyEnglishPhrases = [
  'Add contact',
  'Add student',
  'All branches',
  'Create branch',
  'Current password',
  'Email address',
  'No contacts yet',
  'No students yet',
  'Save changes',
  'Sign in to ARAVA',
  'Sign out',
  'Try again',
  'Users & access',
];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return ['.ts', '.tsx'].includes(extname(path)) && !path.endsWith('localization.test.ts')
        ? [path]
        : [];
    }),
  );
  return nested.flat();
}

describe('renderer localization boundary', () => {
  it('declares Russian as the document language', async () => {
    const currentDirectory = dirname(fileURLToPath(import.meta.url));
    const html = await readFile(resolve(currentDirectory, '../index.html'), 'utf8');
    expect(html).toContain('<html lang="ru">');
  });

  it('does not retain legacy English interface phrases', async () => {
    const currentDirectory = dirname(fileURLToPath(import.meta.url));
    const files = await sourceFiles(currentDirectory);
    const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')));
    const rendererSource = sources.join('\n');
    for (const phrase of legacyEnglishPhrases) expect(rendererSource).not.toContain(phrase);
  });
});
