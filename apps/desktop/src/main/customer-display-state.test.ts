import type { CustomerDisplayStudent } from '@arava/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustomerDisplayStateController } from './customer-display-state';

const student = (firstName: string): CustomerDisplayStudent => ({
  firstName,
  groups: [],
  subscriptionStatus: 'NONE',
});

describe('таймер экрана клиента', () => {
  afterEach(() => vi.useRealTimers());

  it('возвращает рекламу после тайм-аута', () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const controller = new CustomerDisplayStateController(
      { mode: 'PROMO', settings: { showLastName: false, slideSeconds: 8 }, slides: [] },
      (state) => states.push(state.mode),
    );
    controller.showStudent(student('Анна'), 15);
    vi.advanceTimersByTime(15_000);
    expect(states).toEqual(['STUDENT', 'PROMO']);
  });

  it('новая и повторная карта заменяют клиента и перезапускают таймер', () => {
    vi.useFakeTimers();
    const controller = new CustomerDisplayStateController(
      { mode: 'PROMO', settings: { showLastName: false, slideSeconds: 8 }, slides: [] },
      () => undefined,
    );
    controller.showStudent(student('Анна'), 15);
    vi.advanceTimersByTime(5_000);
    controller.showStudent(student('Борис'), 15);
    vi.advanceTimersByTime(10_001);
    expect(controller.getState().student?.firstName).toBe('Борис');
    controller.showStudent(student('Борис'), 15);
    vi.advanceTimersByTime(14_999);
    expect(controller.getState().mode).toBe('STUDENT');
    vi.advanceTimersByTime(1);
    expect(controller.getState().mode).toBe('PROMO');
  });
});
