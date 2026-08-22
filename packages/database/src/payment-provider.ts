import type { PaymentOperationStatus, PaymentProviderType } from '@arava/shared';

export interface ProviderPaymentRequest {
  amount: number;
  currency: 'RUB';
  idempotencyKey: string;
  operationId: string;
  purpose: string;
}

export interface ProviderPaymentState {
  providerOperationId: string;
  status: Extract<
    PaymentOperationStatus,
    'WAITING_FOR_PAYMENT' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED'
  >;
}

/** Adapter boundary for a future bank/SBP/acquiring integration. */
export interface PaymentProviderAdapter {
  readonly providerType: Exclude<PaymentProviderType, 'NONE'>;
  cancel(providerOperationId: string): Promise<ProviderPaymentState>;
  create(request: ProviderPaymentRequest): Promise<ProviderPaymentState>;
  getStatus(providerOperationId: string): Promise<ProviderPaymentState>;
}
