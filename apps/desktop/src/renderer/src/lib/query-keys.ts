import type {
  GroupListQuery,
  LessonListQuery,
  StudentListQuery,
  WeeklyScheduleQuery,
} from '@arava/shared';

export const queryKeys = {
  activity: ['activity'] as const,
  branches: (includeArchived = false) => ['branches', { includeArchived }] as const,
  dashboard: ['dashboard', 'stats'] as const,
  group: (id: string) => ['groups', 'detail', id] as const,
  groups: (query: GroupListQuery) => ['groups', 'list', query] as const,
  attendance: (lessonId: string) => ['attendance', lessonId] as const,
  lesson: (id: string) => ['lessons', 'detail', id] as const,
  lessons: (query: LessonListQuery) => ['lessons', 'list', query] as const,
  schedules: (query: WeeklyScheduleQuery) => ['schedules', 'list', query] as const,
  setting: (key: string) => ['settings', key] as const,
  student: (id: string) => ['students', 'detail', id] as const,
  students: (query: StudentListQuery) => ['students', 'list', query] as const,
  system: ['system', 'information'] as const,
  staffOptions: ['users', 'staff-options'] as const,
  users: ['users'] as const,
};
