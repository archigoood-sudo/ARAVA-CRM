import { describe, expect, it } from 'vitest';

import { paymentOperationSubscriptionId, paymentSubmitLabel } from './payment-dialog-model';

describe('подтверждение оплаты в ежедневном сценарии', () => {
  it('называет полную и частичную продажу по результату действия', () => {
    expect(
      paymentSubmitLabel({
        amount: 400_000,
        attendancePayment: false,
        subscriptionPayment: false,
        subscriptionSale: true,
        subscriptionSalePrice: 400_000,
      }),
    ).toBe('Оплатить и выдать');
    expect(
      paymentSubmitLabel({
        amount: 200_000,
        attendancePayment: false,
        subscriptionPayment: false,
        subscriptionSale: true,
        subscriptionSalePrice: 400_000,
      }),
    ).toBe('Принять 2 000 ₽ и выдать');
  });

  it('различает оплату посещения и доплату по абонементу', () => {
    expect(
      paymentSubmitLabel({
        amount: 1_500,
        attendancePayment: true,
        subscriptionPayment: false,
        subscriptionSale: false,
      }),
    ).toBe('Оплатить посещение');
    expect(
      paymentSubmitLabel({
        amount: 3_000,
        attendancePayment: false,
        subscriptionPayment: true,
        subscriptionSale: false,
      }),
    ).toBe('Принять оплату');
  });

  it('не переносит выбранный старый абонемент в продажу нового', () => {
    expect(
      paymentOperationSubscriptionId({
        subscriptionId: 'existing-subscription',
        subscriptionSale: true,
      }),
    ).toBeUndefined();
    expect(
      paymentOperationSubscriptionId({
        subscriptionId: 'existing-subscription',
        subscriptionSale: false,
      }),
    ).toBe('existing-subscription');
  });
});
