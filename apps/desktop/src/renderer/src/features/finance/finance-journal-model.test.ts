import { describe, expect, it } from 'vitest';

import { financePeriodRange, journalPageLabel } from './finance-journal-model';

describe('finance journal model', () => {
  const now = new Date(2026, 7, 27, 12);

  it('builds inclusive local calendar presets across month boundaries', () => {
    expect(financePeriodRange('TODAY', now)).toEqual({
      dateFrom: '2026-08-27',
      dateTo: '2026-08-27',
    });
    expect(financePeriodRange('SEVEN_DAYS', new Date(2026, 8, 3, 12))).toEqual({
      dateFrom: '2026-08-28',
      dateTo: '2026-09-03',
    });
    expect(financePeriodRange('PREVIOUS_MONTH', new Date(2026, 0, 15, 12))).toEqual({
      dateFrom: '2025-12-01',
      dateTo: '2025-12-31',
    });
  });

  it('keeps pagination labels stable for an empty result', () => {
    expect(journalPageLabel(1, 0)).toBe('Страница 1 из 1');
    expect(journalPageLabel(2, 5)).toBe('Страница 2 из 5');
  });
});
