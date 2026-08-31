import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ExpenseAttachmentManager } from './expense-attachment-manager';

describe('expense attachment manager', () => {
  it('copies selected files into managed media and discards only uncommitted selections', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arava-expense-media-'));
    const source = join(directory, 'кассовый чек.pdf');
    await writeFile(source, 'receipt');
    const manager = new ExpenseAttachmentManager(directory);

    const first = await manager.store(source);
    expect(first).toMatchObject({ fileName: 'кассовый чек.pdf' });
    expect(first.reference).toMatch(/^media\/expenses\/[\da-f-]+\.pdf$/u);
    expect(await readFile(manager.resolve(first.reference), 'utf8')).toBe('receipt');
    await manager.discard(first.reference);
    await expect(access(manager.resolve(first.reference))).rejects.toThrow();

    const committed = await manager.store(source);
    manager.commit(committed.reference);
    await manager.discard(committed.reference);
    await expect(access(manager.resolve(committed.reference))).resolves.toBeUndefined();
  });

  it('keeps historical absolute attachment paths readable without treating them as managed', () => {
    const manager = new ExpenseAttachmentManager('/tmp/arava-expense-media');
    expect(manager.isManaged('/Users/example/old-receipt.pdf')).toBe(false);
    expect(manager.resolve('/Users/example/old-receipt.pdf')).toBe(
      '/Users/example/old-receipt.pdf',
    );
    expect(() => manager.resolve('media/expenses/../../secret.pdf')).toThrow('Недопустимая ссылка');
  });
});
