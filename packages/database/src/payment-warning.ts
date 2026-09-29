// Warning acknowledgement is deliberately independent of financial operation status.
export interface WarningState {
  status: string;
  paymentId: string | null;
  completedAt: Date | null;
  saleFinalizationError: string | null;
  providerType: string;
  providerOutcome: string | null;
  providerPaymentConfirmedAt: Date | null;
}
export function paymentWarningBlock(state: WarningState): string | undefined {
  if (!['FAILED', 'EXPIRED'].includes(state.status)) return 'OPERATION_NOT_TERMINAL_FAILURE';
  if (
    state.saleFinalizationError !== null ||
    state.paymentId ||
    state.completedAt ||
    state.providerPaymentConfirmedAt
  )
    return 'PAYMENT_OR_FINALIZATION_REQUIRES_RECONCILIATION';
  if (
    state.providerType !== 'NONE' &&
    !['FAILED', 'EXPIRED', 'CANCELLED'].includes(state.providerOutcome ?? '')
  )
    return 'PROVIDER_OUTCOME_UNCERTAIN';
  return undefined;
}
