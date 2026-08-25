import { formatMoney } from '@arava/ui';

export function paymentSubmitLabel({
  amount,
  attendancePayment,
  subscriptionPayment,
  subscriptionSale,
  subscriptionSalePrice,
}: {
  amount: number;
  attendancePayment: boolean;
  subscriptionPayment: boolean;
  subscriptionSale: boolean;
  subscriptionSalePrice?: number | undefined;
}): string {
  if (attendancePayment) return 'Оплатить посещение';
  if (subscriptionSale) {
    if (amount === subscriptionSalePrice) return 'Оплатить и выдать';
    return `Принять ${formatMoney(amount)} и выдать`;
  }
  if (subscriptionPayment) return 'Принять оплату';
  return 'Сохранить платёж';
}
