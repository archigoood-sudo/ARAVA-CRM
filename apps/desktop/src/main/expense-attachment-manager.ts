import type { ExpenseAttachmentSelection } from '@arava/shared';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';

const MANAGED_PREFIX = 'media/expenses/';
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
const MANAGED_REFERENCE = /^media\/expenses\/[\da-f-]+\.(?:jpe?g|png|webp|pdf)$/iu;

export class ExpenseAttachmentManager {
  private readonly directory: string;
  private readonly pending = new Set<string>();

  constructor(userDataPath: string) {
    this.directory = join(userDataPath, 'media', 'expenses');
  }

  async store(source: string): Promise<ExpenseAttachmentSelection> {
    const extension = extname(source).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension))
      throw new Error('Выберите PDF, JPG, PNG или WEBP файл.');
    await mkdir(this.directory, { recursive: true });
    const reference = `${MANAGED_PREFIX}${randomUUID()}${extension}`;
    await copyFile(source, this.resolveManaged(reference));
    this.pending.add(reference);
    return { fileName: basename(source), reference };
  }

  commit(reference: string | undefined): void {
    if (reference) this.pending.delete(reference);
  }

  async discard(reference: string): Promise<void> {
    if (!this.pending.delete(reference)) return;
    await rm(this.resolveManaged(reference), { force: true });
  }

  resolve(reference: string): string {
    if (reference.startsWith(MANAGED_PREFIX)) return this.resolveManaged(reference);
    return reference;
  }

  isManaged(reference: string): boolean {
    return MANAGED_REFERENCE.test(reference);
  }

  private resolveManaged(reference: string): string {
    if (!this.isManaged(reference)) throw new Error('Недопустимая ссылка на документ расхода.');
    const target = resolve(this.directory, basename(reference));
    const relativePath = relative(resolve(this.directory), target);
    if (relativePath.startsWith('..') || isAbsolute(relativePath))
      throw new Error('Недопустимая ссылка на документ расхода.');
    return target;
  }
}
