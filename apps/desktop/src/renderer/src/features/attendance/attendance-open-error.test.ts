import { describe, expect, it } from 'vitest';
import { attendanceOpenError } from './attendance-open-error';

describe('attendance opening error', () => {
  it.each([
    'У группы уже есть занятие в это время.',
    'Тренер уже занят в это время.',
    'Зал уже занят другим занятием в это время.',
    'В это время зал занят арендой.',
    'Расписание изменилось. Обновите список и выберите занятие повторно.',
  ])('preserves the actual service reason: %s', (reason) => {
    expect(attendanceOpenError(new Error(reason))).toBe(reason);
    expect(
      attendanceOpenError(
        new Error(`Error invoking remote method 'attendance:open-occurrence': Error: ${reason}`),
      ),
    ).toBe(reason);
  });
  it('does not guess a conflict when no reason was received', () => {
    expect(attendanceOpenError(undefined)).toContain('Причина не получена');
    expect(attendanceOpenError(new Error(' '))).toContain('Причина не получена');
  });
});
