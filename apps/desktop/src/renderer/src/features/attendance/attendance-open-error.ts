/** Preserve the service reason instead of suggesting refresh for every kind of failure. */
export function attendanceOpenError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message) return 'Причина не получена от приложения. Передайте это сообщение в поддержку.';
  return message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/u, '')
    .replace(/^(?:Error|DomainError):\s*/u, '')
    .slice(0, 1200);
}
