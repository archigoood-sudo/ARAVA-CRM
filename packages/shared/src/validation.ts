import { z } from 'zod';

import {
  ATTENDANCE_STATUSES,
  CASH_REGISTER_TYPES,
  CALENDAR_EXCEPTION_TYPES,
  MEMBERSHIP_CARD_STATUSES,
  ENROLLMENT_STATUSES,
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_STATUSES,
  FINANCE_DEBT_SORTS,
  FINANCE_DEBT_TYPES,
  FINANCE_JOURNAL_EVENT_TYPES,
  GENDERS,
  GROUP_STATUSES,
  LESSON_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_PROVIDER_TYPES,
  PAYMENT_STATUSES,
  PAYROLL_PERIOD_STATUSES,
  PAYROLL_TYPES,
  PUBLICATION_AUDIENCES,
  PUBLICATION_TYPES,
  REPORT_KINDS,
  STUDENT_STATUSES,
  TARIFF_TYPES,
  TRIAL_OUTCOMES,
  USER_ROLES,
  type BranchInput,
  type CalendarExceptionInput,
  type CalendarRangeQuery,
  type CardActionInput,
  type CardAssignInput,
  type CardListQuery,
  type CardRegisterInput,
  type CardReplaceInput,
  type CopyDayInput,
  type AnalyticsQuery,
  type AttentionFilters,
  type AttendanceEntryInput,
  type EnrollmentInput,
  type CashCorrectionInput,
  type CashRegisterInput,
  type CashTransactionQuery,
  type CashTransferInput,
  type ExpenseCategoryInput,
  type ExpenseInput,
  type ExpenseListQuery,
  type FinanceAnalyticsQuery,
  type FinanceTodayQuery,
  type FinanceDebtQuery,
  type FinanceJournalFilter,
  type FinanceJournalQuery,
  type GroupInput,
  type GroupListQuery,
  type LessonCancelInput,
  type LessonGenerateInput,
  type LessonInput,
  type LessonListQuery,
  type LeadCreateInput,
  type LeadListQuery,
  type TrialListQuery,
  type TrialOccurrenceQuery,
  type TrialScheduleInput,
  type RoomClosureInput,
  type RoomInput,
  type RoomRentalInput,
  type TrainerSubstitutionInput,
  type LoginCredentials,
  type ForcedPasswordChangeInput,
  type OwnerRecoveryInput,
  type PasswordChangeInput,
  type PaymentInput,
  type PaymentOperationCreateInput,
  type PaymentOperationReasonInput,
  type PaymentListQuery,
  type RefundInput,
  type PayrollAdjustmentInput,
  type PayrollPaymentInput,
  type PayrollPeriodInput,
  type PayrollRuleInput,
  type ReportQuery,
  type StudentContactInput,
  type StudentBulkAddToGroupInput,
  type StudentBulkChangeStatusInput,
  type StudentBulkMoveToGroupInput,
  type StudentBulkRemoveFromGroupInput,
  type StudentInput,
  type StudentDocumentInput,
  type StudentDocumentPackInput,
  type StudentDocumentStatusInput,
  type StudentNoteInput,
  type StudentListQuery,
  type SubscriptionAdjustmentInput,
  type SubscriptionCreateInput,
  type SubscriptionUpdateInput,
  type SubscriptionFreezeInput,
  type TariffInput,
  type TariffListQuery,
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

export const forcedPasswordChangeSchema: z.ZodType<ForcedPasswordChangeInput> = z.object({
  newPassword: passwordSchema,
});

export const ownerRecoverySchema: z.ZodType<OwnerRecoveryInput> = z.object({
  email: z.string().trim().toLowerCase().email(t('validation.email')).max(254),
  newPassword: passwordSchema,
  recoveryCode: z.string().trim().min(16, t('validation.required')).max(200),
});

export const userRoleSchema = z.enum(USER_ROLES);
export const studentStatusSchema = z.enum(STUDENT_STATUSES);
export const genderSchema = z.enum(GENDERS);
export const groupStatusSchema = z.enum(GROUP_STATUSES);
export const enrollmentStatusSchema = z.enum(ENROLLMENT_STATUSES);
export const lessonStatusSchema = z.enum(LESSON_STATUSES);
export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);
export const tariffTypeSchema = z.enum(TARIFF_TYPES);
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export const paymentProviderTypeSchema = z.enum(PAYMENT_PROVIDER_TYPES);
export const expensePaymentMethodSchema = z.enum(EXPENSE_PAYMENT_METHODS);
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);
export const cashRegisterTypeSchema = z.enum(CASH_REGISTER_TYPES);
export const payrollTypeSchema = z.enum(PAYROLL_TYPES);
export const payrollPeriodStatusSchema = z.enum(PAYROLL_PERIOD_STATUSES);
export const reportKindSchema = z.enum(REPORT_KINDS);

export const userCreateSchema: z.ZodType<UserCreateInput> = z.object({
  branchIds: z.array(z.string().min(1)).max(100),
  email: z.string().trim().toLowerCase().email(t('validation.email')).max(254),
  fullName: z.string().trim().min(2, t('validation.required')).max(120),
  phone: optionalText(40),
  role: userRoleSchema,
  trainerDescription: optionalText(1200),
});

export const userUpdateSchema: z.ZodType<UserUpdateInput> = z.object({
  branchIds: z.array(z.string().min(1)).max(100),
  fullName: z.string().trim().min(2, t('validation.required')).max(120),
  isActive: z.boolean(),
  phone: optionalText(40),
  role: userRoleSchema,
  trainerDescription: optionalText(1200),
});

export const branchInputSchema: z.ZodType<BranchInput> = z.object({
  address: optionalText(240),
  description: optionalText(1000),
  name: z.string().trim().min(2, t('validation.required')).max(120),
  phone: optionalText(40),
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

export const studentNoteInputSchema: z.ZodType<StudentNoteInput> = z.object({
  text: z.string().trim().min(1, 'Введите текст заметки.').max(4000),
});

const studentDocumentTypeSchema = z.enum(['CONTRACT', 'PERSONAL_DATA_CONSENT', 'MEDIA_CONSENT']);
const studentDocumentStatusSchema = z.enum([
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'CONSENTED',
  'REVOKED',
  'NOT_PROVIDED',
  'ALLOWED',
  'NOT_ALLOWED',
]);
const studentDocumentAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mediaId: z.string().regex(/^[\da-f-]+\.(?:pdf|jpe?g|png)$/iu),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
});

export const studentDocumentInputSchema: z.ZodType<StudentDocumentInput> = z
  .object({
    attachment: studentDocumentAttachmentSchema.optional(),
    contractNumber: optionalText(40),
    documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Укажите дату документа.'),
    documentType: studentDocumentTypeSchema,
    note: optionalText(2000),
    representativeContactId: z.string().min(1).max(100).optional(),
    source: z.enum(['GENERATED', 'EXISTING']),
    status: studentDocumentStatusSchema,
  })
  .superRefine((input, context) => {
    const allowedStatuses: Record<StudentDocumentInput['documentType'], readonly string[]> = {
      CONTRACT: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
      MEDIA_CONSENT: ['ALLOWED', 'NOT_ALLOWED', 'REVOKED', 'NOT_PROVIDED'],
      PERSONAL_DATA_CONSENT: ['CONSENTED', 'REVOKED', 'NOT_PROVIDED'],
    };
    if (!allowedStatuses[input.documentType].includes(input.status)) {
      context.addIssue({
        code: 'custom',
        message: 'Некорректное состояние документа.',
        path: ['status'],
      });
    }
    if (input.documentType !== 'CONTRACT' && input.contractNumber) {
      context.addIssue({
        code: 'custom',
        message: 'Номер доступен только для договора.',
        path: ['contractNumber'],
      });
    }
    if (input.documentType === 'CONTRACT' && input.source === 'EXISTING' && !input.contractNumber) {
      context.addIssue({
        code: 'custom',
        message: 'Укажите номер существующего договора.',
        path: ['contractNumber'],
      });
    }
    if (input.source === 'GENERATED' && input.documentType !== 'CONTRACT') {
      context.addIssue({
        code: 'custom',
        message: 'Генерация согласий пока недоступна.',
        path: ['source'],
      });
    }
  });

export const studentDocumentStatusInputSchema: z.ZodType<StudentDocumentStatusInput> = z.object({
  status: studentDocumentStatusSchema,
});
export const studentDocumentPackInputSchema: z.ZodType<StudentDocumentPackInput> = z
  .object({
    attachToStudent: z.boolean().optional(),
    editSessionId: z.string().uuid().optional(),
    representativeContactId: z.string().min(1).max(100).optional(),
  })
  .strict();

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

export const barcodeSchema = z
  .string()
  .trim()
  .min(4, 'Штрихкод должен содержать не менее 4 символов.')
  .max(128, 'Штрихкод слишком длинный.')
  .regex(/^[!-~]+$/u, 'Штрихкод содержит недопустимые символы.');

export const cardRegisterInputSchema: z.ZodType<CardRegisterInput> = z.object({
  barcode: barcodeSchema,
  notes: optionalText(2000),
});

export const cardAssignInputSchema: z.ZodType<CardAssignInput> = z.object({
  barcode: barcodeSchema,
  notes: optionalText(2000),
  registerIfUnknown: z.boolean(),
  studentId: z.string().min(1).max(100),
});

export const cardReplaceInputSchema: z.ZodType<CardReplaceInput> = z.object({
  comment: optionalText(1000),
  newBarcode: barcodeSchema,
  oldCardId: z.string().min(1).max(100),
  oldCardStatus: z.enum(['BLOCKED', 'LOST']),
  registerIfUnknown: z.boolean(),
  studentId: z.string().min(1).max(100),
});

export const cardActionInputSchema: z.ZodType<CardActionInput> = z.object({
  comment: optionalText(1000),
});

export const cardListQuerySchema: z.ZodType<CardListQuery> = z.object({
  branchId: z.string().min(1).max(100).optional(),
  page: z.number().int().min(1).max(100_000),
  pageSize: z.number().int().min(5).max(100),
  search: optionalText(160),
  sortBy: z.enum(['barcode', 'createdAt', 'lastScan']),
  sortDirection: z.enum(['asc', 'desc']),
  status: z.enum(MEMBERSHIP_CARD_STATUSES).optional(),
});

const optionalIdentifier = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => (value?.length ? value : undefined));
const isoDate = z.string().date(t('validation.date'));
export const attendanceWorkspaceDateSchema = isoDate;
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

export const groupRosterDateSchema = isoDate;

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
    roomId: optionalIdentifier,
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
  roomId: optionalIdentifier,
});

export const lessonInputSchema: z.ZodType<LessonInput> = z
  .object({
    coachId: optionalIdentifier,
    endsAt: isoDateTime,
    groupId: z.string().min(1).max(100),
    notes: optionalText(2000),
    room: optionalText(120),
    roomId: optionalIdentifier,
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
    roomId: optionalIdentifier,
  })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const roomInputSchema: z.ZodType<RoomInput> = z.object({
  areaSquareMeters: z.number().positive().max(10000).optional(),
  branchId: z.string().min(1).max(100),
  capacity: z.number().int().positive().max(10000).optional(),
  colorKey: optionalText(40),
  description: optionalText(2000),
  floor: optionalText(40),
  isActive: z.boolean(),
  name: z.string().trim().min(1, t('validation.required')).max(120),
  sortOrder: z.number().int().min(0).max(10000),
});

export const calendarRangeQuerySchema: z.ZodType<CalendarRangeQuery> = z
  .object({
    branchId: optionalIdentifier,
    dateFrom: isoDateTime,
    dateTo: isoDateTime,
    roomId: optionalIdentifier,
  })
  .refine((input) => input.dateFrom < input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const roomRentalInputSchema: z.ZodType<RoomRentalInput> = z
  .object({
    amount: z.number().int().nonnegative().optional(),
    branchId: z.string().min(1).max(100),
    clientName: optionalText(160),
    comment: optionalText(2000),
    endAt: isoDateTime,
    phone: optionalText(40),
    roomId: z.string().min(1).max(100),
    startAt: isoDateTime,
  })
  .refine((input) => input.startAt < input.endAt, {
    message: t('validation.timeRange'),
    path: ['endAt'],
  });

export const roomClosureInputSchema: z.ZodType<RoomClosureInput> = z
  .object({
    comment: optionalText(2000),
    endAt: isoDateTime,
    reason: z.string().trim().min(2, t('validation.required')).max(240),
    roomId: z.string().min(1).max(100),
    startAt: isoDateTime,
  })
  .refine((input) => input.startAt < input.endAt, {
    message: t('validation.timeRange'),
    path: ['endAt'],
  });

export const calendarExceptionInputSchema: z.ZodType<CalendarExceptionInput> = z
  .object({
    branchId: optionalIdentifier,
    comment: optionalText(2000),
    endAt: isoDateTime,
    startAt: isoDateTime,
    title: z.string().trim().min(2, t('validation.required')).max(160),
    type: z.enum(CALENDAR_EXCEPTION_TYPES),
  })
  .refine((input) => input.startAt < input.endAt, {
    message: t('validation.dateRange'),
    path: ['endAt'],
  });

export const trainerSubstitutionInputSchema: z.ZodType<TrainerSubstitutionInput> = z.object({
  reason: optionalText(500),
  substituteTrainerId: z.string().min(1).max(100),
});

export const copyDayInputSchema: z.ZodType<CopyDayInput> = z
  .object({ sourceDate: isoDate, targetDate: isoDate })
  .refine((input) => input.sourceDate !== input.targetDate, {
    message: 'Даты копирования должны отличаться.',
    path: ['targetDate'],
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
export const attendanceOccurrenceInputSchema = z.object({
  groupId: z.string().min(1).max(100),
  startsAt: isoDateTime,
});

const moneyAmount = z.number().int().min(0, t('validation.money')).max(1_000_000_000);
const positiveMoneyAmount = z
  .number()
  .int()
  .min(1, t('validation.moneyPositive'))
  .max(1_000_000_000);

export const tariffInputSchema: z.ZodType<TariffInput> = z
  .object({
    branchId: optionalIdentifier,
    currency: z.literal('RUB'),
    description: optionalText(2000),
    freezeDays: z.number().int().min(0).max(365).optional(),
    isActive: z.boolean(),
    lessonCount: z.number().int().min(1).max(1000).optional(),
    name: z.string().trim().min(2, t('validation.required')).max(120),
    price: moneyAmount,
    type: tariffTypeSchema,
    validityDays: z.number().int().min(1).max(3650).optional(),
  })
  .superRefine((input, context) => {
    if (input.type === 'LESSON_PACK' && !input.lessonCount)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: t('validation.tariff.lessonPackCount'),
        path: ['lessonCount'],
      });
    if (input.type === 'UNLIMITED' && input.lessonCount !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: t('validation.tariff.unlimitedCount'),
        path: ['lessonCount'],
      });
    if ((input.type === 'SINGLE_LESSON' || input.type === 'TRIAL') && input.lessonCount !== 1)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: t('validation.tariff.singleCount'),
        path: ['lessonCount'],
      });
  });

export const tariffListQuerySchema: z.ZodType<TariffListQuery> = z.object({
  branchId: optionalIdentifier,
  includeArchived: z.boolean().optional(),
  search: optionalText(120),
  type: tariffTypeSchema.optional(),
});

export const initialPaymentInputSchema = z.object({
  amount: positiveMoneyAmount,
  comment: optionalText(1000),
  externalReference: optionalText(200),
  paidAt: isoDateTime,
  paymentMethod: paymentMethodSchema,
});

export const subscriptionCreateInputSchema: z.ZodType<SubscriptionCreateInput> = z
  .object({
    expiresAt: isoDate.optional(),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
    initialPayment: initialPaymentInputSchema.optional(),
    notes: optionalText(2000),
    salePrice: moneyAmount,
    sequenceAfterSubscriptionId: optionalIdentifier,
    startsAt: isoDate,
    studentId: z.string().min(1).max(100),
    tariffId: z.string().min(1).max(100),
  })
  .refine((input) => input.salePrice > 0 && input.initialPayment?.amount === input.salePrice, {
    message: 'Абонемент выдаётся только после полной успешной оплаты.',
    path: ['initialPayment', 'amount'],
  })
  .refine((input) => !input.initialPayment || input.initialPayment.amount <= input.salePrice, {
    message: t('validation.payment.exceedsSale'),
    path: ['initialPayment', 'amount'],
  })
  .refine((input) => !input.expiresAt || input.expiresAt >= input.startsAt, {
    message: 'Дата окончания не может быть раньше даты начала.',
    path: ['expiresAt'],
  });

const subscriptionSaleIntentSchema = z
  .object({
    expiresAt: isoDate.optional(),
    notes: optionalText(2000),
    salePrice: moneyAmount,
    sequenceAfterSubscriptionId: optionalIdentifier,
    startsAt: isoDate,
    tariffId: z.string().min(1).max(100),
  })
  .refine((input) => !input.expiresAt || input.expiresAt >= input.startsAt, {
    message: 'Дата окончания не может быть раньше даты начала.',
    path: ['expiresAt'],
  });

export const subscriptionUpdateInputSchema: z.ZodType<SubscriptionUpdateInput> = z
  .object({
    expiresAt: isoDate.optional(),
    notes: optionalText(2000),
    reason: z.string().trim().min(3, t('validation.adjustmentReason')).max(1000),
    remainingLessons: z.number().int().min(0).max(1000).optional(),
    startsAt: isoDate,
    tariffId: z.string().min(1).max(100),
  })
  .refine((input) => !input.expiresAt || input.expiresAt >= input.startsAt, {
    message: 'Дата окончания не может быть раньше даты начала.',
    path: ['expiresAt'],
  });

export const subscriptionFreezeInputSchema: z.ZodType<SubscriptionFreezeInput> = z
  .object({
    endsAt: isoDate,
    reason: z.string().trim().min(3, t('validation.adjustmentReason')).max(1000),
    startsAt: isoDate,
  })
  .refine((input) => input.endsAt >= input.startsAt, {
    message: t('validation.dateRange'),
    path: ['endsAt'],
  });

export const subscriptionAdjustmentInputSchema: z.ZodType<SubscriptionAdjustmentInput> = z.object({
  comment: z.string().trim().min(3, t('validation.adjustmentReason')).max(1000),
  lessonDelta: z
    .number()
    .int()
    .min(-1000)
    .max(1000)
    .refine((value) => value !== 0, {
      message: t('validation.adjustmentDelta'),
    }),
});

export const paymentInputSchema: z.ZodType<PaymentInput> = z.object({
  amount: positiveMoneyAmount,
  branchId: z.string().min(1).max(100),
  comment: optionalText(1000),
  externalReference: optionalText(200),
  paidAt: isoDateTime,
  paymentMethod: paymentMethodSchema,
  studentId: z.string().min(1).max(100),
  subscriptionId: optionalIdentifier,
  attendanceLessonId: optionalIdentifier,
  attendanceTariffId: optionalIdentifier,
});

export const paymentOperationCreateSchema: z.ZodType<PaymentOperationCreateInput> = z
  .object({
    amount: positiveMoneyAmount,
    branchId: z.string().min(1).max(100),
    currency: z.literal('RUB'),
    idempotencyKey: z.string().trim().min(8).max(200),
    providerType: paymentProviderTypeSchema,
    purpose: z.string().trim().min(3, t('validation.required')).max(500),
    studentId: z.string().min(1).max(100),
    subscriptionId: optionalIdentifier,
    attendanceLessonId: optionalIdentifier,
    attendanceTariffId: optionalIdentifier,
    saleIntent: subscriptionSaleIntentSchema.optional(),
  })
  .refine((input) => !input.saleIntent || input.amount === input.saleIntent.salePrice, {
    message: 'Для продажи абонемента требуется полная оплата.',
    path: ['amount'],
  });

export const paymentOperationReasonSchema: z.ZodType<PaymentOperationReasonInput> = z.object({
  reason: z.string().trim().min(3, t('validation.required')).max(500),
});

export const paymentListQuerySchema: z.ZodType<PaymentListQuery> = z
  .object({
    branchId: optionalIdentifier,
    createdByUserId: optionalIdentifier,
    dateFrom: isoDateTime,
    dateTo: isoDateTime,
    paymentMethod: paymentMethodSchema.optional(),
    search: optionalText(120),
    status: paymentStatusSchema.optional(),
  })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const refundInputSchema: z.ZodType<RefundInput> = z.object({
  amount: positiveMoneyAmount,
  reason: z.string().trim().min(3, t('validation.refundReason')).max(1000),
  refundedAt: isoDateTime,
});

export const financeTodayQuerySchema: z.ZodType<FinanceTodayQuery> = z.object({
  branchId: optionalIdentifier,
  date: isoDate,
});

const financeDebtFilterFields = {
  branchId: optionalIdentifier,
  debtType: z.enum(FINANCE_DEBT_TYPES),
  search: optionalText(120),
  sort: z.enum(FINANCE_DEBT_SORTS),
};

export const financeDebtFilterSchema = z.object(financeDebtFilterFields);

export const financeDebtQuerySchema: z.ZodType<FinanceDebtQuery> = z.object({
  ...financeDebtFilterFields,
  page: z.number().int().min(1),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
});

export const financeAnalyticsQuerySchema: z.ZodType<FinanceAnalyticsQuery> = z
  .object({
    branchId: optionalIdentifier,
    dateFrom: isoDate,
    dateTo: isoDate,
  })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

const financeJournalFilterFields = {
  branchId: optionalIdentifier,
  dateFrom: isoDate,
  dateTo: isoDate,
  eventType: z.enum(FINANCE_JOURNAL_EVENT_TYPES),
  paymentMethod: paymentMethodSchema.optional(),
  search: optionalText(120),
};

export const financeJournalFilterSchema: z.ZodType<FinanceJournalFilter> = z
  .object(financeJournalFilterFields)
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const financeJournalQuerySchema: z.ZodType<FinanceJournalQuery> = z
  .object({
    ...financeJournalFilterFields,
    page: z.number().int().min(1),
    pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const expenseCategoryInputSchema: z.ZodType<ExpenseCategoryInput> = z.object({
  branchId: optionalIdentifier,
  description: optionalText(2000),
  isActive: z.boolean(),
  name: z.string().trim().min(2, t('validation.required')).max(120),
});

export const expenseInputSchema: z.ZodType<ExpenseInput> = z.object({
  amount: positiveMoneyAmount,
  attachmentPath: optionalText(1000),
  branchId: z.string().min(1).max(100),
  cashRegisterId: optionalIdentifier,
  categoryId: z.string().min(1).max(100),
  description: z.string().trim().min(2, t('validation.required')).max(2000),
  documentNumber: optionalText(200),
  paymentMethod: expensePaymentMethodSchema,
  spentAt: isoDateTime,
  vendor: optionalText(240),
});

export const expenseListQuerySchema: z.ZodType<ExpenseListQuery> = z
  .object({
    branchId: optionalIdentifier,
    categoryId: optionalIdentifier,
    createdByUserId: optionalIdentifier,
    dateFrom: isoDateTime,
    dateTo: isoDateTime,
    paymentMethod: expensePaymentMethodSchema.optional(),
    search: optionalText(200),
    status: expenseStatusSchema.optional(),
  })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const cashRegisterInputSchema: z.ZodType<CashRegisterInput> = z.object({
  branchId: z.string().min(1).max(100),
  isActive: z.boolean(),
  name: z.string().trim().min(2, t('validation.required')).max(120),
  openingBalance: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  type: cashRegisterTypeSchema,
});

export const cashTransactionQuerySchema: z.ZodType<CashTransactionQuery> = z
  .object({
    branchId: optionalIdentifier,
    cashRegisterId: optionalIdentifier,
    dateFrom: isoDateTime,
    dateTo: isoDateTime,
  })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const cashCorrectionInputSchema: z.ZodType<CashCorrectionInput> = z.object({
  amount: z
    .number()
    .int()
    .min(-1_000_000_000)
    .max(1_000_000_000)
    .refine((value) => value !== 0, {
      message: 'Сумма корректировки не может быть нулевой.',
    }),
  cashRegisterId: z.string().min(1).max(100),
  occurredAt: isoDateTime,
  reason: z.string().trim().min(3, 'Укажите причину корректировки.').max(1000),
});

export const cashTransferInputSchema: z.ZodType<CashTransferInput> = z
  .object({
    amount: positiveMoneyAmount,
    fromCashRegisterId: z.string().min(1).max(100),
    occurredAt: isoDateTime,
    reason: z.string().trim().min(3, 'Укажите назначение перевода.').max(1000),
    toCashRegisterId: z.string().min(1).max(100),
  })
  .refine((input) => input.fromCashRegisterId !== input.toCashRegisterId, {
    message: 'Выберите разные кассы для перевода.',
    path: ['toCashRegisterId'],
  });

export const payrollRuleInputSchema: z.ZodType<PayrollRuleInput> = z
  .object({
    amountPerAttendee: moneyAmount.optional(),
    branchId: z.string().min(1).max(100),
    coachId: z.string().min(1).max(100),
    fixedAmount: moneyAmount.optional(),
    groupId: optionalIdentifier,
    isActive: z.boolean(),
    monthlyAmount: moneyAmount.optional(),
    percent: z.number().min(0.01).max(100).optional(),
    type: payrollTypeSchema,
    validFrom: isoDate,
    validTo: optionalIsoDate,
  })
  .superRefine((input, context) => {
    if (input.validTo && input.validFrom > input.validTo)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: t('validation.dateRange'),
        path: ['validTo'],
      });
    if (['FIXED_PER_LESSON', 'COMBINED'].includes(input.type) && input.fixedAmount === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Укажите ставку за занятие.',
        path: ['fixedAmount'],
      });
    if (['PER_ATTENDEE', 'COMBINED'].includes(input.type) && input.amountPerAttendee === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Укажите ставку за ученика.',
        path: ['amountPerAttendee'],
      });
    if (input.type === 'PERCENT_OF_REVENUE' && input.percent === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Укажите процент от выручки.',
        path: ['percent'],
      });
    if (input.type === 'FIXED_MONTHLY' && input.monthlyAmount === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Укажите месячную ставку.',
        path: ['monthlyAmount'],
      });
  });

export const payrollPeriodInputSchema: z.ZodType<PayrollPeriodInput> = z
  .object({ branchId: optionalIdentifier, dateFrom: isoDate, dateTo: isoDate })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const payrollAdjustmentInputSchema: z.ZodType<PayrollAdjustmentInput> = z.object({
  amount: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  reason: z.string().trim().min(3, 'Укажите причину корректировки.').max(1000),
});

export const payrollPaymentInputSchema: z.ZodType<PayrollPaymentInput> = z.object({
  cashRegisterId: z.string().min(1).max(100),
  occurredAt: isoDateTime,
});

export const analyticsQuerySchema: z.ZodType<AnalyticsQuery> = z
  .object({
    branchId: optionalIdentifier,
    coachId: optionalIdentifier,
    dateFrom: isoDateTime,
    dateTo: isoDateTime,
    direction: optionalText(120),
    groupId: optionalIdentifier,
  })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const reportQuerySchema: z.ZodType<ReportQuery> = z
  .object({
    branchId: optionalIdentifier,
    coachId: optionalIdentifier,
    dateFrom: isoDateTime,
    dateTo: isoDateTime,
    direction: optionalText(120),
    groupId: optionalIdentifier,
    kind: reportKindSchema,
  })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });

export const identifierSchema = z.string().min(1).max(100);
export const sessionTokenSchema = z.string().min(32).max(256);

const bulkStudentIdsSchema = z
  .array(identifierSchema)
  .min(1, 'Выберите хотя бы одного ученика.')
  .max(200, 'За одну операцию можно выбрать не более 200 учеников.')
  .refine((ids) => new Set(ids).size === ids.length, 'Список учеников содержит повторы.');

export const studentBulkAddToGroupSchema: z.ZodType<StudentBulkAddToGroupInput> = z.object({
  effectiveDate: isoDate,
  groupId: identifierSchema,
  overrideCapacity: z.boolean(),
  studentIds: bulkStudentIdsSchema,
});

export const studentBulkMoveToGroupSchema: z.ZodType<StudentBulkMoveToGroupInput> = z
  .object({
    effectiveDate: isoDate,
    overrideCapacity: z.boolean(),
    sourceGroupId: identifierSchema,
    studentIds: bulkStudentIdsSchema,
    targetGroupId: identifierSchema,
  })
  .refine((input) => input.sourceGroupId !== input.targetGroupId, {
    message: 'Исходная и целевая группы должны отличаться.',
    path: ['targetGroupId'],
  });

export const studentBulkRemoveFromGroupSchema: z.ZodType<StudentBulkRemoveFromGroupInput> =
  z.object({
    effectiveDate: isoDate,
    groupId: identifierSchema,
    studentIds: bulkStudentIdsSchema,
  });

export const studentBulkChangeStatusSchema: z.ZodType<StudentBulkChangeStatusInput> = z.object({
  status: studentStatusSchema,
  studentIds: bulkStudentIdsSchema,
});

export const chatListQuerySchema = z.object({
  filter: z.enum(['ALL', 'PRIVATE_ADMIN', 'GROUP', 'UNREAD']).optional(),
  search: z.string().trim().max(120).optional(),
  updatedSince: z.string().datetime().optional(),
});

export const chatSendInputSchema = z.object({
  clientMessageId: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9_.:-]+$/u),
  text: z
    .string()
    .trim()
    .min(1, 'Введите сообщение.')
    .max(1200, 'Сообщение слишком длинное.')
    .refine((value) => !/\{\{[^{}]+\}\}/u.test(value), {
      message: 'Заполните все переменные шаблона перед отправкой.',
    }),
});

export const communicationTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Укажите название.').max(80),
    text: z.string().trim().min(1, 'Введите текст шаблона.').max(1200),
  })
  .refine(
    (input) =>
      [...input.text.matchAll(/\{\{([^{}]+)\}\}/gu)].every((match) =>
        ['STUDENT_NAME', 'GROUP_NAME', 'LESSON_DATE', 'LESSON_TIME'].includes(
          match[1]?.trim() ?? '',
        ),
      ),
    { message: 'Шаблон содержит неизвестную переменную.', path: ['text'] },
  );

export const leadStatusSchema = z.enum(LEAD_STATUSES);
export const leadSourceSchema = z.enum(LEAD_SOURCES);
export const leadListQuerySchema: z.ZodType<LeadListQuery> = z.object({
  direction: optionalText(100),
  search: optionalText(120),
  source: leadSourceSchema.optional(),
  status: leadStatusSchema.optional(),
});
export const leadCreateInputSchema: z.ZodType<LeadCreateInput> = z.object({
  branchCrmId: z.string().trim().min(1).max(160).optional(),
  comment: optionalText(1000),
  contactName: optionalText(100),
  direction: optionalText(100),
  phone: z.string().trim().min(5, 'Укажите корректный телефон.').max(40),
  studentAge: z.number().int().min(3).max(99).optional(),
  studentName: z.string().trim().min(1, 'Укажите имя ученика.').max(100),
});
export const leadGroupAssignmentInputSchema = z.object({
  crmGroupId: optionalIdentifier,
});
export const leadStudentConversionInputSchema = z.object({
  addToGroup: z.boolean(),
  allowDuplicate: z.boolean(),
  groupId: optionalIdentifier,
  student: studentInputSchema,
});
export const trialScheduleInputSchema: z.ZodType<TrialScheduleInput> = z
  .object({
    groupId: identifierSchema,
    leadId: identifierSchema.optional(),
    studentId: identifierSchema.optional(),
    startsAt: z.string().datetime(),
  })
  .refine((input) => Boolean(input.leadId) !== Boolean(input.studentId), {
    message: 'Укажите заявку или ученика.',
  });
export const trialCancelInputSchema = z.object({ expectedVersion: z.number().int().positive() });
export const trialOutcomeInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  outcome: z.enum(TRIAL_OUTCOMES),
});
export const trialOccurrenceQuerySchema: z.ZodType<TrialOccurrenceQuery> = z
  .object({
    dateFrom: z.string().datetime(),
    dateTo: z.string().datetime(),
    groupId: identifierSchema,
  })
  .refine((input) => input.dateFrom <= input.dateTo, {
    message: t('validation.dateRange'),
    path: ['dateTo'],
  });
export const trialListQuerySchema: z.ZodType<TrialListQuery> = z.object({
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  groupId: optionalIdentifier,
  includeFollowUp: z.boolean().optional(),
  includeHistory: z.boolean().optional(),
  leadId: optionalIdentifier,
  studentId: optionalIdentifier,
});
export const publicationInputSchema = z
  .object({
    audienceMode: z.enum(PUBLICATION_AUDIENCES),
    body: z
      .string()
      .trim()
      .min(1, 'Добавьте текст публикации.')
      .max(5000, 'Текст не должен превышать 5000 символов.'),
    eventLocation: optionalText(240),
    eventStartsAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    mediaId: z.string().min(1).max(100).optional(),
    publishAt: z.string().datetime().optional(),
    targetIds: z.array(z.string().min(1).max(100)).max(100),
    title: z
      .string()
      .trim()
      .min(2, 'Укажите заголовок.')
      .max(160, 'Заголовок не должен превышать 160 символов.'),
    type: z.enum(PUBLICATION_TYPES),
  })
  .superRefine((input, context) => {
    const targeted = input.audienceMode === 'BRANCHES' || input.audienceMode === 'GROUPS';
    if (targeted && input.targetIds.length === 0)
      context.addIssue({
        code: 'custom',
        message: 'Выберите хотя бы одного получателя.',
        path: ['targetIds'],
      });
    if (!targeted && input.targetIds.length > 0)
      context.addIssue({
        code: 'custom',
        message: 'Для выбранной аудитории получатели не требуются.',
        path: ['targetIds'],
      });
    if (input.publishAt && input.expiresAt && input.publishAt >= input.expiresAt)
      context.addIssue({
        code: 'custom',
        message: 'Дата окончания должна быть позже даты публикации.',
        path: ['expiresAt'],
      });
  });
export const globalSearchQuerySchema = z.string().trim().min(2).max(120);

export const attentionFiltersSchema: z.ZodType<AttentionFilters> = z.object({
  branchId: optionalIdentifier,
  category: z
    .enum([
      'LEADS',
      'TRIALS',
      'STUDENTS',
      'SUBSCRIPTIONS',
      'PAYMENTS',
      'ATTENDANCE',
      'PAYROLL',
      'CARDS',
      'SCHEDULE',
      'ROOMS',
      'SUBSTITUTIONS',
      'BACKUPS',
      'INTEGRATION',
    ])
    .optional(),
  relevance: z.enum(['ALL', 'TODAY', 'UPCOMING']).optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
});
