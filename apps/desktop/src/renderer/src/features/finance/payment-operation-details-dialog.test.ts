import type { AqsiGatewayPayment, PaymentOperationSummary } from '@arava/shared';
import { describe, expect, it } from 'vitest';

import { canCheckFiscalReceipt, fiscalReceiptLabel } from './payment-operation-details';

const operation: PaymentOperationSummary = {
  amount: 25_000,
  branchId: 'branch-1',
  completedAt: '2026-08-23T10:00:00.000Z',
  createdAt: '2026-08-23T09:59:00.000Z',
  createdByName: 'Владелец',
  currency: 'RUB',
  id: 'operation-1',
  idempotencyKey: 'attempt-1',
  paymentId: 'payment-1',
  providerType: 'SBP',
  purpose: 'Абонемент',
  status: 'SUCCEEDED',
  studentId: 'student-1',
  studentName: 'Иванова Анна',
  updatedAt: '2026-08-23T10:00:00.000Z',
};

function gateway(status: NonNullable<AqsiGatewayPayment['fiscalReceipt']>['status']) {
  return {
    amountKopecks: operation.amount,
    aravaOperationId: operation.id,
    currency: 'RUB' as const,
    fiscalReceipt: {
      canRetry: status === 'ERROR',
      status,
      updatedAt: operation.updatedAt,
    },
    provider: 'AQSI_SBP' as const,
    status: 'SUCCEEDED' as const,
    updatedAt: operation.updatedAt,
  };
}

describe('исторический кассовый чек', () => {
  it('разрешает проверку существующей ошибочной операции', () => {
    expect(fiscalReceiptLabel(gateway('ERROR').fiscalReceipt)).toBe('Ошибка формирования чека');
    expect(canCheckFiscalReceipt(operation, gateway('ERROR'))).toBe(true);
  });

  it('показывает ожидание для незавершённого чека', () => {
    expect(fiscalReceiptLabel(gateway('PROCESSING').fiscalReceipt)).toBe('Чек формируется');
    expect(canCheckFiscalReceipt(operation, gateway('PROCESSING'))).toBe(true);
  });

  it('не допускает повторную фискализацию готового чека', () => {
    expect(fiscalReceiptLabel(gateway('SUCCEEDED').fiscalReceipt)).toBe('Чек сформирован');
    expect(canCheckFiscalReceipt(operation, gateway('SUCCEEDED'))).toBe(false);
  });

  it('не предлагает кассовую проверку для ручного платежа', () => {
    expect(canCheckFiscalReceipt({ ...operation, providerType: 'NONE' }, undefined)).toBe(false);
  });
});
