import type { AqsiFiscalReceipt, AqsiGatewayPayment, PaymentOperationSummary } from '@arava/shared';

export function fiscalReceiptLabel(receipt?: AqsiFiscalReceipt | null): string {
  if (receipt?.status === 'SUCCEEDED') return 'Чек сформирован';
  if (receipt?.status === 'ERROR' || receipt?.status === 'UNKNOWN')
    return 'Ошибка формирования чека';
  return 'Чек формируется';
}

export function canCheckFiscalReceipt(
  operation: PaymentOperationSummary,
  gateway?: AqsiGatewayPayment,
): boolean {
  if (!['SBP', 'ACQUIRING'].includes(operation.providerType)) return false;
  if (gateway?.fiscalReceipt?.status === 'SUCCEEDED') return false;
  return (
    operation.status === 'SUCCEEDED' ||
    operation.status === 'WAITING_FOR_PAYMENT' ||
    operation.status === 'PROCESSING'
  );
}
