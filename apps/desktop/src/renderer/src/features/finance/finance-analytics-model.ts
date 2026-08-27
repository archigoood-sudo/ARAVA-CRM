export type FinanceAnalyticsPreset =
  'SEVEN_DAYS' | 'THIRTY_DAYS' | 'THIS_MONTH' | 'PREVIOUS_MONTH' | 'THREE_MONTHS' | 'CUSTOM';

function dateKey(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function shifted(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

export function financeAnalyticsPeriod(
  preset: Exclude<FinanceAnalyticsPreset, 'CUSTOM'>,
  now = new Date(),
): { dateFrom: string; dateTo: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'SEVEN_DAYS')
    return { dateFrom: dateKey(shifted(today, -6)), dateTo: dateKey(today) };
  if (preset === 'THIRTY_DAYS')
    return { dateFrom: dateKey(shifted(today, -29)), dateTo: dateKey(today) };
  if (preset === 'THIS_MONTH')
    return {
      dateFrom: dateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
      dateTo: dateKey(today),
    };
  if (preset === 'PREVIOUS_MONTH') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { dateFrom: dateKey(start), dateTo: dateKey(end) };
  }
  return {
    dateFrom: dateKey(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
    dateTo: dateKey(today),
  };
}

export function financeAnalyticsChange(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}
