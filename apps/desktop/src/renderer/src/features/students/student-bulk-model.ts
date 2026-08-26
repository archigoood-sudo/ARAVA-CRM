export function isStaleBulkPreviewError(message: string): boolean {
  return message.includes('Данные изменились после проверки');
}
