import type { QueryClient } from '@tanstack/react-query';

export async function invalidateGlobalSearchCache(client: QueryClient): Promise<void> {
  await client.invalidateQueries({ queryKey: ['global-search'] });
}

export async function invalidateStudentIdentityCaches(
  client: QueryClient,
  studentId?: string,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['students'] }),
    client.invalidateQueries({ queryKey: ['student-profile'] }),
    invalidateGlobalSearchCache(client),
    client.invalidateQueries({ queryKey: ['dashboard'] }),
    client.invalidateQueries({ queryKey: ['attention'] }),
    client.invalidateQueries({ queryKey: ['trials'] }),
    ...(studentId
      ? [client.invalidateQueries({ queryKey: ['groups', 'eligible-for-student', studentId] })]
      : []),
  ]);
}

export async function invalidateAttendanceCaches(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['attendance', 'today'] }),
    client.invalidateQueries({ queryKey: ['subscriptions'] }),
    client.invalidateQueries({ queryKey: ['students', 'finance'] }),
    client.invalidateQueries({ queryKey: ['student-profile'] }),
    client.invalidateQueries({ queryKey: ['groups', 'detail'] }),
    client.invalidateQueries({ queryKey: ['trainers', 'profile'] }),
    client.invalidateQueries({ queryKey: ['payroll'] }),
    client.invalidateQueries({ queryKey: ['dashboard'] }),
    client.invalidateQueries({ queryKey: ['attention'] }),
    client.invalidateQueries({ queryKey: ['trials'] }),
  ]);
}

export async function invalidateFinanceCaches(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['payments'] }),
    client.invalidateQueries({ queryKey: ['finance'] }),
    client.invalidateQueries({ queryKey: ['students', 'finance'] }),
    client.invalidateQueries({ queryKey: ['student-profile'] }),
    client.invalidateQueries({ queryKey: ['dashboard'] }),
    client.invalidateQueries({ queryKey: ['attention'] }),
    client.invalidateQueries({ queryKey: ['trials'] }),
  ]);
}

export async function invalidateLessonCaches(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['lessons'] }),
    client.invalidateQueries({ queryKey: ['attendance'] }),
    client.invalidateQueries({ queryKey: ['student-profile'] }),
    client.invalidateQueries({ queryKey: ['groups', 'detail'] }),
    client.invalidateQueries({ queryKey: ['trainers', 'profile'] }),
    client.invalidateQueries({ queryKey: ['payroll'] }),
    client.invalidateQueries({ queryKey: ['dashboard'] }),
    client.invalidateQueries({ queryKey: ['attention'] }),
    client.invalidateQueries({ queryKey: ['trial-occurrences'] }),
  ]);
}
