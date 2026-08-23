import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  invalidateAttendanceCaches,
  invalidateFinanceCaches,
  invalidateLessonCaches,
  invalidateStudentIdentityCaches,
} from './operational-cache';

function clientWith(keys: readonly (readonly unknown[])[]): QueryClient {
  const client = new QueryClient();
  for (const key of keys) client.setQueryData(key, { cached: true });
  return client;
}

function invalidated(client: QueryClient, key: readonly unknown[]): boolean {
  return client.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated ?? false;
}

describe('operational cache invalidation', () => {
  it('refreshes lists and global search after a student identity mutation', async () => {
    const client = clientWith([
      ['students', 'list', { page: 1 }],
      ['students', 'options'],
      ['student-profile', 'owner', 'student-1'],
      ['global-search', 'Иванов'],
      ['attention', 'summary'],
    ]);

    await invalidateStudentIdentityCaches(client, 'student-1');

    for (const key of [
      ['students', 'list', { page: 1 }],
      ['students', 'options'],
      ['student-profile', 'owner', 'student-1'],
      ['global-search', 'Иванов'],
      ['attention', 'summary'],
    ])
      expect(invalidated(client, key)).toBe(true);
  });

  it('refreshes payroll and derived profile statistics after attendance changes', async () => {
    const keys = [
      ['attendance', 'today', '2026-08-23'],
      ['student-profile', 'owner', 'student-1'],
      ['groups', 'detail', 'group-1'],
      ['trainers', 'profile', 'coach-1'],
      ['payroll', 'period'],
      ['dashboard', 'stats'],
      ['attention', 'summary'],
    ] as const;
    const client = clientWith(keys);

    await invalidateAttendanceCaches(client);

    for (const key of keys) expect(invalidated(client, key)).toBe(true);
  });

  it('refreshes debt attention after payments and operational metrics after lesson changes', async () => {
    const financeKeys = [
      ['payments', 'list'],
      ['students', 'finance', 'student-1'],
      ['student-profile', 'owner', 'student-1'],
      ['attention', 'summary'],
    ] as const;
    const lessonKeys = [
      ['lessons', 'list'],
      ['attendance', 'lesson-1'],
      ['groups', 'detail', 'group-1'],
      ['trainers', 'profile', 'coach-1'],
      ['payroll', 'period'],
      ['dashboard', 'stats'],
    ] as const;
    const client = clientWith([...financeKeys, ...lessonKeys]);

    await invalidateFinanceCaches(client);
    for (const key of financeKeys) expect(invalidated(client, key)).toBe(true);

    await invalidateLessonCaches(client);
    for (const key of lessonKeys) expect(invalidated(client, key)).toBe(true);
  });
});
