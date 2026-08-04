import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, formatDate, getLocale, ru, SUPPORTED_LOCALES, t } from './index';

describe('Russian localization', () => {
  it('uses Russian as the default and fallback-ready locale', () => {
    expect(DEFAULT_LOCALE).toBe('ru');
    expect(getLocale()).toBe('ru');
    expect(SUPPORTED_LOCALES).toContain('ru');
    expect(t('nav.dashboard')).toBe('Главная');
    expect(Object.keys(ru).length).toBeGreaterThan(200);
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
