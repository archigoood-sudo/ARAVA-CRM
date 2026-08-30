export function paymentOperationSubscriptionId({
  subscriptionId,
  subscriptionSale,
}: {
  subscriptionId?: string | undefined;
  subscriptionSale: boolean;
}): string | undefined {
  if (subscriptionSale || !subscriptionId) return undefined;
  return subscriptionId;
}

export function paymentSubmitLabel({
  attendancePayment,
  subscriptionPayment,
  subscriptionSale,
  subscriptionRenewal,
}: {
  amount: number;
  attendancePayment: boolean;
  subscriptionPayment: boolean;
  subscriptionSale: boolean;
  subscriptionRenewal?: boolean | undefined;
  subscriptionSalePrice?: number | undefined;
}): string {
  if (attendancePayment) return 'Оплатить посещение';
  if (subscriptionRenewal) return 'Оплатить и продлить';
  if (subscriptionSale) return 'Оплатить и выдать';
  if (subscriptionPayment) return 'Принять оплату';
  return 'Сохранить платёж';
}
