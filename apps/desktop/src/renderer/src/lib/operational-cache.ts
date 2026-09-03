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
    client.invalidateQueries({ queryKey: ['attendance'] }),
    client.invalidateQueries({ queryKey: ['groups', 'detail'] }),
    client.invalidateQueries({ queryKey: ['groups', 'roster'] }),
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
    client.invalidateQueries({ queryKey: ['groups', 'roster'] }),
    client.invalidateQueries({ queryKey: ['trainers', 'profile'] }),
    client.invalidateQueries({ queryKey: ['payroll-period'] }),
    client.invalidateQueries({ queryKey: ['payroll-periods'] }),
    client.invalidateQueries({ queryKey: ['payroll-rules'] }),
    client.invalidateQueries({ queryKey: ['payroll-coach'] }),
    client.invalidateQueries({ queryKey: ['dashboard'] }),
    client.invalidateQueries({ queryKey: ['attention'] }),
    client.invalidateQueries({ queryKey: ['trials'] }),
  ]);
}

export async function invalidateTrialCaches(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['trials'] }),
    client.invalidateQueries({ queryKey: ['trial-occurrences'] }),
    client.invalidateQueries({ queryKey: ['attendance'] }),
    client.invalidateQueries({ queryKey: ['groups', 'detail'] }),
    client.invalidateQueries({ queryKey: ['groups', 'roster'] }),
    client.invalidateQueries({ queryKey: ['student-profile'] }),
    client.invalidateQueries({ queryKey: ['dashboard'] }),
    client.invalidateQueries({ queryKey: ['attention'] }),
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
    client.invalidateQueries({ queryKey: ['groups', 'detail'] }),
    client.invalidateQueries({ queryKey: ['groups', 'roster'] }),
  ]);
}

export async function invalidateLessonCaches(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['lessons'] }),
    client.invalidateQueries({ queryKey: ['attendance'] }),
    client.invalidateQueries({ queryKey: ['student-profile'] }),
    client.invalidateQueries({ queryKey: ['groups', 'detail'] }),
    client.invalidateQueries({ queryKey: ['trainers', 'profile'] }),
    client.invalidateQueries({ queryKey: ['payroll-period'] }),
    client.invalidateQueries({ queryKey: ['payroll-periods'] }),
    client.invalidateQueries({ queryKey: ['payroll-rules'] }),
    client.invalidateQueries({ queryKey: ['payroll-coach'] }),
    client.invalidateQueries({ queryKey: ['dashboard'] }),
    client.invalidateQueries({ queryKey: ['attention'] }),
    client.invalidateQueries({ queryKey: ['trial-occurrences'] }),
  ]);
}

export async function invalidateSyncedEntityCaches(
  client: QueryClient,
  entityType: string,
): Promise<void> {
  if (entityType === 'TRIAL_APPOINTMENT') return invalidateTrialCaches(client);
  if (entityType === 'ATTENDANCE') return invalidateAttendanceCaches(client);
  if (entityType === 'SUBSCRIPTION' || entityType === 'SUBSCRIPTION_LEDGER')
    return invalidateFinanceCaches(client);
  if (entityType === 'LESSON' || entityType === 'SCHEDULE') return invalidateLessonCaches(client);
  if (
    entityType === 'STUDENT_IDENTITY' ||
    entityType === 'STUDENT_CONTACT' ||
    entityType === 'STUDENT_NOTE' ||
    entityType === 'GROUP_MEMBERSHIP' ||
    entityType === 'GROUP'
  )
    return invalidateStudentIdentityCaches(client);
}
