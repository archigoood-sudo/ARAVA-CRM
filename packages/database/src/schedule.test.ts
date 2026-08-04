import { describe, expect, it } from 'vitest';

import { dateRangesOverlap, scheduleWindowsOverlap, timeRangesOverlap } from './schedule';

describe('schedule conflict detection', () => {
  it('detects intersecting times but allows adjacent lessons', () => {
    expect(timeRangesOverlap('10:00', '11:30', '11:00', '12:00')).toBe(true);
    expect(timeRangesOverlap('10:00', '11:00', '11:00', '12:00')).toBe(false);
  });

  it('detects overlapping open and bounded validity periods', () => {
    expect(
      dateRangesOverlap(
        new Date('2026-08-01'),
        null,
        new Date('2026-09-01'),
        new Date('2026-10-01'),
      ),
    ).toBe(true);
    expect(
      dateRangesOverlap(
        new Date('2026-08-01'),
        new Date('2026-08-31'),
        new Date('2026-09-01'),
        null,
      ),
    ).toBe(false);
  });

  it('requires the same weekday as well as time and date intersection', () => {
    const base = {
      endTime: '19:00',
      startTime: '18:00',
      validFrom: new Date('2026-08-01'),
      validTo: null,
    };
    expect(scheduleWindowsOverlap({ ...base, weekday: 1 }, { ...base, weekday: 1 })).toBe(true);
    expect(scheduleWindowsOverlap({ ...base, weekday: 1 }, { ...base, weekday: 2 })).toBe(false);
  });
});
