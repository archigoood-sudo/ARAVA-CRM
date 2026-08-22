import type { SbpGatewayPayment } from '@arava/shared';

import type { IntegrationService } from './integration-service';
import type { PaymentOperationService } from './payment-operation-service';
import { DomainError } from './security';

export class SbpPaymentService {
  constructor(
    private readonly operations: PaymentOperationService,
    private readonly integration: IntegrationService,
  ) {}

  async health(token: string) {
    return this.integration.sbpProviderHealth(token);
  }

  async start(token: string, operationId: string): Promise<SbpGatewayPayment> {
    const operation = await this.operations.get(token, operationId);
    if (operation.providerType !== 'SBP')
      throw new DomainError('VALIDATION', 'Операция не предназначена для оплаты через СБП.');
    if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(operation.status))
      throw new DomainError('CONFLICT', 'Эту операцию оплаты нельзя запустить повторно.');
    const gateway = await this.integration.startSbpPayment(token, operation);
    await this.applyGatewayState(token, operationId, gateway);
    return gateway;
  }

  async refresh(token: string, operationId: string): Promise<SbpGatewayPayment> {
    const operation = await this.operations.get(token, operationId);
    if (operation.providerType !== 'SBP')
      throw new DomainError('VALIDATION', 'Операция не предназначена для оплаты через СБП.');
    const gateway = await this.integration.refreshSbpPayment(token, operation);
    await this.applyGatewayState(token, operationId, gateway);
    return gateway;
  }

  private async applyGatewayState(
    token: string,
    operationId: string,
    gateway: SbpGatewayPayment,
  ): Promise<void> {
    let local = await this.operations.get(token, operationId);
    if (local.status === 'SUCCEEDED') return;
    if (local.status === 'CREATED') {
      local = await this.operations.transition(
        token,
        operationId,
        'WAITING_FOR_PAYMENT',
        undefined,
        gateway.providerOperationId ?? undefined,
      );
    }
    if (gateway.status === 'PROCESSING' && local.status === 'WAITING_FOR_PAYMENT') {
      await this.operations.transition(token, operationId, 'PROCESSING');
      return;
    }
    if (gateway.status === 'SUCCEEDED') {
      await this.operations.finalizeTrusted(operationId, {
        paymentMethod: 'SBP',
        ...(gateway.providerOperationId
          ? { providerOperationId: gateway.providerOperationId }
          : {}),
      });
      return;
    }
    if (
      gateway.status === 'FAILED' &&
      ['WAITING_FOR_PAYMENT', 'PROCESSING'].includes(local.status)
    ) {
      await this.operations.failTrusted(
        operationId,
        gateway.error?.message ?? 'T‑Bank отклонил оплату.',
      );
      return;
    }
    if (
      gateway.status === 'EXPIRED' &&
      ['WAITING_FOR_PAYMENT', 'PROCESSING'].includes(local.status)
    ) {
      await this.operations.expireTrusted(operationId);
      return;
    }
    if (
      gateway.status === 'CANCELLED' &&
      ['WAITING_FOR_PAYMENT', 'PROCESSING'].includes(local.status)
    ) {
      await this.operations.cancel(token, operationId, 'Операция отменена платёжным провайдером.');
    }
  }
}
