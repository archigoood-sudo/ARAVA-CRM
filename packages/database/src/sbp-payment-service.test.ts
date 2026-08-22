import type { AqsiGatewayPayment, PaymentOperationSummary } from '@arava/shared';
import { describe, expect, it, vi } from 'vitest';

import type { IntegrationService } from './integration-service';
import type { PaymentOperationService } from './payment-operation-service';
import { AqsiPaymentService } from './sbp-payment-service';

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

function gateway(
  status: AqsiGatewayPayment['status'],
  provider: AqsiGatewayPayment['provider'] = 'AQSI_SBP',
): AqsiGatewayPayment {
  return {
    amountKopecks: operation.amount,
    aravaOperationId: operation.id,
    currency: 'RUB',
    provider,
    providerOperationId: 'aqsi-100',
    providerResultId: status === 'SUCCEEDED' ? 'slip-100' : null,
    qrPayload: null,
    status,
    updatedAt: '2026-08-22T10:01:00.000Z',
  };
}

function setup(
  remoteStatus: AqsiGatewayPayment['status'],
  currentOperation: PaymentOperationSummary = operation,
) {
  let current = currentOperation;
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
    cancelAqsiPayment: vi.fn(() => Promise.resolve(gateway(remoteStatus))),
    refreshAqsiPayment: vi.fn(() =>
      Promise.resolve(
        gateway(remoteStatus, current.providerType === 'ACQUIRING' ? 'AQSI_CARD' : 'AQSI_SBP'),
      ),
    ),
    sbpProviderHealth: vi.fn(() =>
      Promise.resolve({
        apiReachable: true,
        configured: true,
        deviceConfigured: true,
        provider: 'AQSI_SBP' as const,
      }),
    ),
    startAqsiPayment: vi.fn(() =>
      Promise.resolve(
        gateway(remoteStatus, current.providerType === 'ACQUIRING' ? 'AQSI_CARD' : 'AQSI_SBP'),
      ),
    ),
  };
  return {
    integration,
    operations,
    service: new AqsiPaymentService(
      operations as unknown as PaymentOperationService,
      integration as unknown as IntegrationService,
    ),
  };
}

describe('AqsiPaymentService', () => {
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

  it('finalizes a confirmed card purchase as acquiring exactly once', async () => {
    const cardOperation: PaymentOperationSummary = {
      ...operation,
      id: 'operation-card-1',
      idempotencyKey: 'attempt-card-1',
      providerType: 'ACQUIRING',
    };
    const { integration, operations, service } = setup('SUCCEEDED', cardOperation);
    const result = await service.start('session', cardOperation.id);
    expect(integration.startAqsiPayment).toHaveBeenCalledOnce();
    expect(result.provider).toBe('AQSI_CARD');
    expect(operations.finalizeTrusted).toHaveBeenCalledWith(cardOperation.id, {
      paymentMethod: 'ACQUIRING',
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
