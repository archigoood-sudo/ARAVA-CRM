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
}: {
  amount: number;
  attendancePayment: boolean;
  subscriptionPayment: boolean;
  subscriptionSale: boolean;
  subscriptionSalePrice?: number | undefined;
}): string {
  if (attendancePayment) return 'Оплатить посещение';
  if (subscriptionSale) return 'Оплатить и выдать';
  if (subscriptionPayment) return 'Принять оплату';
  return 'Сохранить платёж';
}
