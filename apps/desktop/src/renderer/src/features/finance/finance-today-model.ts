import type { FinanceTodayOperation, FinanceTodayOverview } from '@arava/shared';

export function hasFinanceTodayActivity(overview: FinanceTodayOverview | undefined): boolean {
  return Boolean(overview?.recentOperations.length);
}

export function financeTodayOperationTone(operation: FinanceTodayOperation): 'positive' | 'refund' {
  return operation.kind === 'REFUND' ? 'refund' : 'positive';
}

export function financeTodayProblemCount(overview: FinanceTodayOverview | undefined): number {
  return (overview?.failedCount ?? 0) + (overview?.recoveryCount ?? 0);
}
