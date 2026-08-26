import { describe, expect, it } from 'vitest';

import { isStaleBulkPreviewError } from './student-bulk-model';

describe('student bulk preview state', () => {
  it('recognizes a stale preflight without exposing technical hash language', () => {
    expect(
      isStaleBulkPreviewError(
        'Данные изменились после проверки. Обновите предварительный просмотр.',
      ),
    ).toBe(true);
    expect(isStaleBulkPreviewError('В группе нет свободных мест.')).toBe(false);
  });
});
