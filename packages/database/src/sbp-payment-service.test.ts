import type { PaymentOperationSummary, SbpGatewayPayment } from '@arava/shared';
import { describe, expect, it, vi } from 'vitest';

import type { IntegrationService } from './integration-service';
import type { PaymentOperationService } from './payment-operation-service';
import { SbpPaymentService } from './sbp-payment-service';

const operation: PaymentOperationSummary = {
  amount: 150_000,
  branchId: 'branch-1',
  createdAt: '2026-08-22T10:00:00.000Z',
  createdByName: 'Владелец',
  currency: 'RUB',
  id: 'operation-1',
  idempotencyKey: 'attempt-1',
  providerType: 'SBP',
  purpose: 'Абонемент',
  status: 'CREATED',
  studentId: 'student-1',
  studentName: 'Иванова Анна',
  updatedAt: '2026-08-22T10:00:00.000Z',
};

function gateway(status: SbpGatewayPayment['status']): SbpGatewayPayment {
  return {
    amountKopecks: operation.amount,
    aravaOperationId: operation.id,
    currency: 'RUB',
    provider: 'AQSI_SBP',
    providerOperationId: 'aqsi-100',
    providerResultId: status === 'SUCCEEDED' ? 'slip-100' : null,
    qrPayload: null,
    status,
    updatedAt: '2026-08-22T10:01:00.000Z',
  };
}

function setup(remoteStatus: SbpGatewayPayment['status']) {
  let current = operation;
  const operations = {
    cancel: vi.fn(),
    expireTrusted: vi.fn(),
    failTrusted: vi.fn(),
    finalizeTrusted: vi.fn(),
    get: vi.fn(() => Promise.resolve(current)),
    transition: vi.fn(
      (
        _token: string,
        _id: string,
        status: PaymentOperationSummary['status'],
        _reason?: string,
        providerOperationId?: string,
      ) => {
        current = { ...current, providerOperationId, status };
        return Promise.resolve(current);
      },
    ),
  };
  const integration = {
    refreshSbpPayment: vi.fn(() => Promise.resolve(gateway(remoteStatus))),
    sbpProviderHealth: vi.fn(() =>
      Promise.resolve({
        apiReachable: true,
        configured: true,
        deviceConfigured: true,
        provider: 'AQSI_SBP' as const,
      }),
    ),
    startSbpPayment: vi.fn(() => Promise.resolve(gateway(remoteStatus))),
  };
  return {
    integration,
    operations,
    service: new SbpPaymentService(
      operations as unknown as PaymentOperationService,
      integration as unknown as IntegrationService,
    ),
  };
}

describe('SbpPaymentService', () => {
  it('starts a waiting operation without creating a canonical payment', async () => {
    const { operations, service } = setup('WAITING');
    const result = await service.start('session', operation.id);
    expect(result.qrPayload).toBeNull();
    expect(operations.transition).toHaveBeenCalledWith(
      'session',
      operation.id,
      'WAITING_FOR_PAYMENT',
      undefined,
      'aqsi-100',
    );
    expect(operations.finalizeTrusted).not.toHaveBeenCalled();
  });

  it('finalizes only a confirmed provider state through existing payment logic', async () => {
    const { operations, service } = setup('SUCCEEDED');
    await service.start('session', operation.id);
    expect(operations.finalizeTrusted).toHaveBeenCalledWith(operation.id, {
      paymentMethod: 'SBP',
      providerOperationId: 'aqsi-100',
      providerResultId: 'slip-100',
    });
  });

  it('maps failed and expired provider states without payment creation', async () => {
    const failed = setup('FAILED');
    await failed.service.start('session', operation.id);
    expect(failed.operations.failTrusted).toHaveBeenCalledOnce();
    expect(failed.operations.finalizeTrusted).not.toHaveBeenCalled();

    const expired = setup('EXPIRED');
    await expired.service.start('session', operation.id);
    expect(expired.operations.expireTrusted).toHaveBeenCalledOnce();
    expect(expired.operations.finalizeTrusted).not.toHaveBeenCalled();
  });
});
