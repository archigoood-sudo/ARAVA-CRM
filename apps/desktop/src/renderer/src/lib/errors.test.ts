import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './errors';

describe('безопасные сообщения об ошибках', () => {
  it('сохраняет понятную доменную ошибку без IPC-префикса', () => {
    expect(
      getErrorMessage(
        new Error(
          "Error invoking remote method 'subscriptions:create': Error: Стоимость тарифа изменилась. Выберите тариф заново.",
        ),
        'Операция не выполнена.',
      ),
    ).toBe('Стоимость тарифа изменилась. Выберите тариф заново.');
  });

  it.each([
    'PrismaClientKnownRequestError: Unique constraint failed',
    'SQLITE_BUSY: database is locked',
    'Invalid `prisma.payment.create()` invocation',
    'Ошибка\n    at PaymentService.create (/app/index.js:42:7)',
  ])('не показывает техническую ошибку: %s', (message) => {
    expect(getErrorMessage(new Error(message), 'Не удалось выполнить операцию.')).toBe(
      'Не удалось выполнить операцию.',
    );
  });
});
