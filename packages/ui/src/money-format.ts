export function formatMoney(amount: number, currency = 'RUB'): string {
  return new Intl.NumberFormat('ru-RU', {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: 'currency',
  }).format(amount / 100);
}
