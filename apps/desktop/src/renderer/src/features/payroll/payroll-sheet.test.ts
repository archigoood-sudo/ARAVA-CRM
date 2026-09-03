import { describe, expect, it } from 'vitest';
import type { PayrollAccrualSummary } from '@arava/shared';

import { buildTrainerPayrollSheets } from './payroll-sheet';

const row = (
  id: string,
  coachId: string,
  coachName: string,
  finalAmount: number,
  payoutMode: PayrollAccrualSummary['payoutMode'] = 'FIXED_PER_LESSON',
): PayrollAccrualSummary => ({
  baseAmount: finalAmount,
  branchId: 'branch',
  branchName: 'Центр',
  calculatedAmount: finalAmount,
  coachId,
  coachName,
  finalAmount,
  id,
  manualAdjustment: 0,
  payoutCategory: 'REGULAR_ATTENDANCE',
  payoutMode,
  type: 'FIXED_PER_LESSON',
});

describe('trainer payroll calculation sheets', () => {
  it('separates trainers, preserves zero NO_PAYOUT rows, and totals canonical accruals', () => {
    const sheets = buildTrainerPayrollSheets([
      row('a-regular', 'a', 'Анна', 4_000),
      row('b-regular', 'b', 'Борис', 7_000),
      row('a-free', 'a', 'Анна', 0, 'NO_PAYOUT'),
    ]);

    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toMatchObject({ coachId: 'a', total: 4_000 });
    expect(sheets[0]?.rows.map(({ id }) => id)).toEqual(['a-regular', 'a-free']);
    expect(sheets[0]?.rows[1]).toMatchObject({ finalAmount: 0, payoutMode: 'NO_PAYOUT' });
    expect(sheets[1]).toMatchObject({ coachId: 'b', total: 7_000 });
    expect(sheets[1]?.rows.map(({ coachId }) => coachId)).toEqual(['b']);
  });
});
