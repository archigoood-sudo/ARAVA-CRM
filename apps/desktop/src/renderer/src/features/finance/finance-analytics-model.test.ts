import { describe, expect, it } from 'vitest';

import { financeAnalyticsChange, financeAnalyticsPeriod } from './finance-analytics-model';

describe('finance analytics model', () => {
  const now = new Date(2026, 7, 27, 12);

  it('builds local preset ranges without a UTC shift', () => {
    expect(financeAnalyticsPeriod('SEVEN_DAYS', now)).toEqual({
      dateFrom: '2026-08-21',
      dateTo: '2026-08-27',
    });
    expect(financeAnalyticsPeriod('PREVIOUS_MONTH', now)).toEqual({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
  });

  it('does not render an infinite comparison for an empty previous period', () => {
    expect(financeAnalyticsChange(1000, 0)).toBeUndefined();
    expect(financeAnalyticsChange(1200, 1000)).toBe(20);
    expect(financeAnalyticsChange(800, 1000)).toBe(-20);
  });
});
