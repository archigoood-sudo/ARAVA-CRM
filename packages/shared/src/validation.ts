import { z } from 'zod';

import {
  GENDERS,
  STUDENT_STATUSES,
  USER_ROLES,
  type BranchInput,
  type LoginCredentials,
  type PasswordChangeInput,
  type StudentContactInput,
  type StudentInput,
  type StudentListQuery,
  type UserCreateInput,
  type UserUpdateInput,
} from './channels';

const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => (value?.length ? value : undefined));

export const passwordSchema = z
  .string()
  .min(12, 'Password must contain at least 12 characters')
  .max(200)
  .regex(/[a-z]/u, 'Password must include a lowercase letter')
  .regex(/[A-Z]/u, 'Password must include an uppercase letter')
  .regex(/[0-9]/u, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/u, 'Password must include a symbol');

export const loginCredentialsSchema: z.ZodType<LoginCredentials> = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  password: z.string().min(1, 'Enter your password').max(200),
});

export const passwordChangeSchema: z.ZodType<PasswordChangeInput> = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'Choose a password different from the current password',
    path: ['newPassword'],
  });

export const userRoleSchema = z.enum(USER_ROLES);
export const studentStatusSchema = z.enum(STUDENT_STATUSES);
export const genderSchema = z.enum(GENDERS);

export const userCreateSchema: z.ZodType<UserCreateInput> = z.object({
  branchIds: z.array(z.string().min(1)).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(2).max(120),
  password: passwordSchema,
  role: userRoleSchema,
});

export const userUpdateSchema: z.ZodType<UserUpdateInput> = z.object({
  branchIds: z.array(z.string().min(1)).max(100),
  fullName: z.string().trim().min(2).max(120),
  isActive: z.boolean(),
  role: userRoleSchema,
});

export const branchInputSchema: z.ZodType<BranchInput> = z.object({
  address: z.string().trim().min(2).max(240),
  description: optionalText(1000),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(5).max(40),
});

export const studentInputSchema: z.ZodType<StudentInput> = z.object({
  birthDate: z.string().date().optional(),
  branchId: z.string().min(1),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  firstName: z.string().trim().min(1).max(80),
  gender: genderSchema.optional(),
  lastName: z.string().trim().min(1).max(80),
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
    .email()
    .max(254)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  fullName: z.string().trim().min(1, 'Contact name is required').max(120),
  isPrimary: z.boolean(),
  notes: optionalText(2000),
  phone: z.string().trim().min(5, 'Phone number is required').max(40),
  relationship: z.string().trim().min(1).max(80),
  secondaryPhone: optionalText(40),
  telegram: optionalText(80),
  whatsapp: z.boolean(),
});

export const identifierSchema = z.string().min(1).max(100);
export const sessionTokenSchema = z.string().min(32).max(256);
