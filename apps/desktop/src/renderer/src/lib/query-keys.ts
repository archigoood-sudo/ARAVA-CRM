import type { StudentListQuery } from '@arava/shared';

export const queryKeys = {
  activity: ['activity'] as const,
  branches: (includeArchived = false) => ['branches', { includeArchived }] as const,
  dashboard: ['dashboard', 'stats'] as const,
  setting: (key: string) => ['settings', key] as const,
  student: (id: string) => ['students', 'detail', id] as const,
  students: (query: StudentListQuery) => ['students', 'list', query] as const,
  system: ['system', 'information'] as const,
  users: ['users'] as const,
};
