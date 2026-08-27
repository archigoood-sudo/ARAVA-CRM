export type FinancePeriodPreset =
  'TODAY' | 'YESTERDAY' | 'SEVEN_DAYS' | 'THIRTY_DAYS' | 'THIS_MONTH' | 'PREVIOUS_MONTH' | 'CUSTOM';

export function localDateValue(value: Date): string {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function financePeriodRange(
  preset: Exclude<FinancePeriodPreset, 'CUSTOM'>,
  now = new Date(),
): { dateFrom: string; dateTo: string } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  if (preset === 'YESTERDAY') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === 'SEVEN_DAYS') start.setDate(start.getDate() - 6);
  else if (preset === 'THIRTY_DAYS') start.setDate(start.getDate() - 29);
  else if (preset === 'THIS_MONTH') start.setDate(1);
  else if (preset === 'PREVIOUS_MONTH') {
    start.setMonth(start.getMonth() - 1, 1);
    end.setDate(0);
  }
  return { dateFrom: localDateValue(start), dateTo: localDateValue(end) };
}

export function journalPageLabel(page: number, totalPages: number): string {
  return `Страница ${String(page)} из ${String(Math.max(1, totalPages))}`;
}
