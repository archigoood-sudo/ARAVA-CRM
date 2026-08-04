import { z } from 'zod';

import {
  ATTENDANCE_STATUSES,
  ENROLLMENT_STATUSES,
  GENDERS,
  GROUP_STATUSES,
  LESSON_STATUSES,
  STUDENT_STATUSES,
  USER_ROLES,
  type BranchInput,
  type AttendanceEntryInput,
  type EnrollmentInput,
  type GroupInput,
  type GroupListQuery,
  type LessonCancelInput,
  type LessonGenerateInput,
  type LessonInput,
  type LessonListQuery,
  type LoginCredentials,
  type PasswordChangeInput,
  type StudentContactInput,
  type StudentInput,
  type StudentListQuery,
  type UserCreateInput,
  type UserUpdateInput,
  type WeeklyScheduleInput,
  type WeeklyScheduleQuery,
} from './channels';
import { t } from './i18n';

const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => (value?.length ? value : undefined));

export const passwordSchema = z
  .string()
  .min(12, t('validation.password.tooShort'))
  .max(200)
  .regex(/[a-z]/u, t('validation.password.lowercase'))
  .regex(/[A-Z]/u, t('validation.password.uppercase'))
  .regex(/[0-9]/u, t('validation.password.number'))
  .regex(/[^A-Za-z0-9]/u, t('validation.password.symbol'));

export const loginCredentialsSchema: z.ZodType<LoginCredentials> = z.object({
  email: z.string().trim().toLowerCase().email(t('validation.email')).max(254),
  password: z.string().min(1, t('validation.password.required')).max(200),
});

export const passwordChangeSchema: z.ZodType<PasswordChangeInput> = z
  .object({
    currentPassword: z.string().min(1, t('validation.currentPasswordRequired')).max(200),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: t('validation.newPasswordDifferent'),
    path: ['newPassword'],
  });

export const userRoleSchema = z.enum(USER_ROLES);
export const studentStatusSchema = z.enum(STUDENT_STATUSES);
export const genderSchema = z.enum(GENDERS);
export const groupStatusSchema = z.enum(GROUP_STATUSES);
export const enrollmentStatusSchema = z.enum(ENROLLMENT_STATUSES);
export const lessonStatusSchema = z.enum(LESSON_STATUSES);
export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

export const userCreateSchema: z.ZodType<UserCreateInput> = z.object({
  branchIds: z.array(z.string().min(1)).max(100),
  email: z.string().trim().toLowerCase().email(t('validation.email')).max(254),
  fullName: z.string().trim().min(2, t('validation.required')).max(120),
  password: passwordSchema,
  role: userRoleSchema,
});

export const userUpdateSchema: z.ZodType<UserUpdateInput> = z.object({
  branchIds: z.array(z.string().min(1)).max(100),
  fullName: z.string().trim().min(2, t('validation.required')).max(120),
  isActive: z.boolean(),
  role: userRoleSchema,
});

export const branchInputSchema: z.ZodType<BranchInput> = z.object({
  address: z.string().trim().min(2, t('validation.required')).max(240),
  description: optionalText(1000),
  name: z.string().trim().min(2, t('validation.required')).max(120),
  phone: z.string().trim().min(5, t('validation.phone')).max(40),
});

export const studentInputSchema: z.ZodType<StudentInput> = z.object({
  birthDate: z.string().date().optional(),
  branchId: z.string().min(1, t('validation.required')),
  email: z
    .string()
    .trim()
    .email(t('validation.email'))
    .max(254)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  firstName: z.string().trim().min(1, t('validation.firstName')).max(80),
  gender: genderSchema.optional(),
  lastName: z.string().trim().min(1, t('validation.lastName')).max(80),
  middleName: optionalText(80),
  notes: optionalText(4000),
  phone: optionalText(40),
  status: studentStatusSchema,
});

export const studentListQuerySchema: z.ZodType<StudentListQuery> = z.object({
  branchId: z.string().min(1).optional(),
  page: z.number().int().min(1).max(100_000),
  pageSize: z.number().int().min(5).max(100),
  search: optionalText(120),
  sortBy: z.enum(['name', 'birthDate', 'createdAt', 'status']),
  sortDirection: z.enum(['asc', 'desc']),
  status: studentStatusSchema.optional(),
});

export const studentContactInputSchema: z.ZodType<StudentContactInput> = z.object({
  email: z
    .string()
    .trim()
    .email(t('validation.email'))
    .max(254)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  fullName: z.string().trim().min(1, t('validation.contactName')).max(120),
  isPrimary: z.boolean(),
  notes: optionalText(2000),
  phone: z.string().trim().min(5, t('validation.phone')).max(40),
  relationship: z.string().trim().min(1, t('validation.relationship')).max(80),
  secondaryPhone: optionalText(40),
  telegram: optionalText(80),
  whatsapp: z.boolean(),
});

const optionalIdentifier = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => (value?.length ? value : undefined));
const isoDate = z.string().date(t('validation.date'));
const optionalIsoDate = isoDate.optional().or(z.literal('').transform(() => undefined));
const isoDateTime = z.string().datetime({ message: t('validation.dateTime'), offset: true });
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, t('validation.time'));

export const groupInputSchema: z.ZodType<GroupInput> = z
  .object({
    ageFrom: z.number().int().min(0).max(100).optional(),
    ageTo: z.number().int().min(0).max(100).optional(),
    assistantCoachId: optionalIdentifier,
    branchId: z.string().min(1, t('validation.required')).max(100),
    capacity: z.number().int().min(1, t('validation.capacity')).max(1000),
    coachId: optionalIdentifier,
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/u, t('validation.color'))
      .optional(),
    description: optionalText(2000),
    direction: z.string().trim().min(1, t('validation.required')).max(120),
    name: z.string().trim().min(2, t('validation.required')).max(120),
    status: groupStatusSchema,
  })
  .refine(
    (input) =>
      input.ageFrom === undefined || input.ageTo === undefined || input.ageFrom <= input.ageTo,
    {
      message: t('validation.ageRange'),
      path: ['ageTo'],
    },
  )
  .refine((input) => !input.coachId || input.coachId !== input.assistantCoachId, {
    message: t('validation.coachesDifferent'),
    path: ['assistantCoachId'],
  });

export const groupListQuerySchema: z.ZodType<GroupListQuery> = z.object({
  branchId: optionalIdentifier,
  coachId: optionalIdentifier,
  direction: optionalText(120),
  search: optionalText(120),
  status: groupStatusSchema.optional(),
});

export const enrollmentInputSchema: z.ZodType<EnrollmentInput> = z.object({
  joinedAt: isoDate,
  notes: optionalText(2000),
  overrideCapacity: z.boolean(),
  status: enrollmentStatusSchema,
  studentId: z.string().min(1).max(100),
});

export const weeklyScheduleInputSchema: z.ZodType<WeeklyScheduleInput> = z
  .object({
    branchId: z.string().min(1).max(100),
    coachId: optionalIdentifier,
    endTime: clockTime,
    groupId: z.string().min(1).max(100),
    isActive: z.boolean(),
    room: optionalText(120),
    startTime: clockTime,
    validFrom: isoDate,
    validTo: optionalIsoDate,
    weekday: z.number().int().min(1).max(7),
  })
  .refine((input) => input.startTime < input.endTime, {
    message: t('validation.timeRange'),
    path: ['endTime'],
  })
  .refine((input) => !input.validTo || input.validFrom <= input.validTo, {
    message: t('validation.dateRange'),
    path: ['validTo'],
  });

export const weeklyScheduleQuerySchema: z.ZodType<WeeklyScheduleQuery> = z.object({
  branchId: optionalIdentifier,
  coachId: optionalIdentifier,
  groupId: optionalIdentifier,
  includeInactive: z.boolean().optional(),
});

export const lessonInputSchema: z.ZodType<LessonInput> = z
  .object({
    coachId: optionalIdentifier,
    endsAt: isoDateTime,
    groupId: z.string().min(1).max(100),
    notes: optionalText(2000),
    room: optionalText(120),
    startsAt: isoDateTime,
  })
  .refine((input) => input.startsAt < input.endsAt, {
    message: t('validation.timeRange'),
    path: ['endsAt'],
  });

export const lessonListQuerySchema: z.ZodType<LessonListQuery> = z
  .object({
    branchId: optionalIdentifier,
    coachId: optionalIdentifier,
    dateFrom: isoDateTime,
    dateTo: isoDateTime,
    groupId: optionalIdentifier,
  })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const lessonGenerateInputSchema: z.ZodType<LessonGenerateInput> = z
  .object({ dateFrom: isoDate, dateTo: isoDate })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const lessonCancelInputSchema: z.ZodType<LessonCancelInput> = z.object({
  cancellationReason: z.string().trim().min(2, t('validation.required')).max(500),
});

export const attendanceEntryInputSchema: z.ZodType<AttendanceEntryInput> = z.object({
  comment: optionalText(500),
  status: attendanceStatusSchema,
  studentId: z.string().min(1).max(100),
});

export const attendanceEntriesSchema = z.array(attendanceEntryInputSchema).max(1000);

export const identifierSchema = z.string().min(1).max(100);
export const sessionTokenSchema = z.string().min(32).max(256);
