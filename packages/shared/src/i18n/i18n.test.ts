import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, formatDate, getLocale, ru, SUPPORTED_LOCALES, t } from './index';

describe('Russian localization', () => {
  it('uses Russian as the default and fallback-ready locale', () => {
    expect(DEFAULT_LOCALE).toBe('ru');
    expect(getLocale()).toBe('ru');
    expect(SUPPORTED_LOCALES).toContain('ru');
    expect(t('nav.dashboard')).toBe('Главная');
    expect(t('nav.groups')).toBe('Группы');
    expect(t('nav.schedule')).toBe('Расписание');
    expect(t('attendance.action.allPresent')).toBe('Отметить всех присутствующими');
    expect(t('nav.tariffs')).toBe('Тарифы');
    expect(t('nav.finance')).toBe('Финансы');
    expect(t('subscription.action.issue')).toBe('Выдать абонемент');
    expect(t('refund.action')).toBe('Оформить возврат');
    expect(Object.keys(ru).length).toBeGreaterThan(500);
  });

  it('interpolates variables and formats dates in Russian', () => {
    expect(t('student.total', { count: 12 })).toBe('Всего: 12');
    expect(
      formatDate('2026-08-04T12:00:00.000Z', {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }),
    ).toBe('4 августа');
  });
});
