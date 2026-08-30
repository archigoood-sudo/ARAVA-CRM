import { describe, expect, it } from 'vitest';

import { paymentOperationSubscriptionId, paymentSubmitLabel } from './payment-dialog-model';

describe('подтверждение оплаты в ежедневном сценарии', () => {
  it('называет только полную продажу действием оплаты и выдачи', () => {
    expect(
      paymentSubmitLabel({
        amount: 400_000,
        attendancePayment: false,
        subscriptionPayment: false,
        subscriptionSale: true,
        subscriptionSalePrice: 400_000,
      }),
    ).toBe('Оплатить и выдать');
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

  it('показывает отдельный CTA для оплаченного продления', () => {
    expect(
      paymentSubmitLabel({
        amount: 330_000,
        attendancePayment: false,
        subscriptionPayment: false,
        subscriptionSale: true,
        subscriptionRenewal: true,
        subscriptionSalePrice: 330_000,
      }),
    ).toBe('Оплатить и продлить');
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
