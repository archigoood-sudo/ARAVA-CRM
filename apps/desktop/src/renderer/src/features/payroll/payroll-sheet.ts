import type { PayrollAccrualSummary } from '@arava/shared';

export interface TrainerPayrollSheet {
  coachId: string;
  coachName: string;
  rows: PayrollAccrualSummary[];
  total: number;
}

export function buildTrainerPayrollSheets(
  accruals: PayrollAccrualSummary[],
): TrainerPayrollSheet[] {
  const sheets = new Map<string, TrainerPayrollSheet>();
  for (const accrual of accruals) {
    const sheet = sheets.get(accrual.coachId) ?? {
      coachId: accrual.coachId,
      coachName: accrual.coachName,
      rows: [],
      total: 0,
    };
    sheet.rows.push(accrual);
    sheet.total += accrual.finalAmount;
    sheets.set(accrual.coachId, sheet);
  }
  return [...sheets.values()].sort((left, right) =>
    left.coachName.localeCompare(right.coachName, 'ru'),
  );
}
