import { PAYOUT_CATEGORIES } from '@arava/shared';
import type {
  AnalyticsBreakdownRow,
  AnalyticsMetric,
  AnalyticsQuery,
  AuthenticatedUser,
  CashCorrectionInput,
  CashRegisterInput,
  CashRegisterSummary,
  CashTransactionQuery,
  CashTransactionSummary,
  CashTransferInput,
  CsvExport,
  ExpenseCategoryInput,
  ExpenseCategorySummary,
  ExpenseInput,
  ExpenseListQuery,
  ExpenseSummary,
  ManagementAnalytics,
  PayrollAccrualSummary,
  PayrollAdjustmentInput,
  PayrollPaymentInput,
  PayrollPeriodDetail,
  PayrollPeriodInput,
  PayrollPeriodSummary,
  PayrollPendingLessonSummary,
  PayrollRuleInput,
  PayrollRuleSummary,
  PayoutCategory,
  TrainerPayoutProfile,
  TrainerPayoutProfileInput,
  ReportData,
  ReportQuery,
} from '@arava/shared';
import type { Prisma } from '@prisma/client';

import type { DatabaseClient } from './index';
import { accessibleBranchIds, assertBranchAccess, assertPermission } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';

type TransactionClient = Prisma.TransactionClient;
type DbClient = DatabaseClient | TransactionClient;

const expenseInclude = {
  branch: { select: { name: true } },
  category: { select: { name: true } },
  confirmedByUser: { select: { fullName: true } },
  createdByUser: { select: { fullName: true } },
} satisfies Prisma.ExpenseInclude;

const payrollRuleInclude = {
  branch: { select: { name: true } },
  coach: { select: { fullName: true } },
  group: { select: { name: true } },
} satisfies Prisma.PayrollRuleInclude;

const payrollPeriodInclude = {
  approvedByUser: { select: { fullName: true } },
  createdByUser: { select: { fullName: true } },
  accruals: {
    include: {
      branch: { select: { name: true } },
      coach: { select: { fullName: true } },
      group: { select: { name: true } },
      lesson: { select: { startsAt: true } },
    },
    orderBy: [{ coach: { fullName: 'asc' } }, { createdAt: 'asc' }],
  },
} satisfies Prisma.PayrollPeriodInclude;

type ExpenseRecord = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;
type PayrollRuleRecord = Prisma.PayrollRuleGetPayload<{ include: typeof payrollRuleInclude }>;
type PayrollPeriodRecord = Prisma.PayrollPeriodGetPayload<{
  include: typeof payrollPeriodInclude;
}>;

function optionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (trimmed?.length) return trimmed;
  return null;
}

function requireResult<Result>(value: Result | undefined, message: string): Result {
  if (!value) throw new DomainError('NOT_FOUND', message);
  return value;
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function endDate(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function dateRangeScope(dateFrom: string, dateTo: string) {
  return { gte: new Date(dateFrom), lte: new Date(dateTo) };
}

function expenseSummary(expense: ExpenseRecord): ExpenseSummary {
  const attachment = expense.attachmentPath
    ? {
        fileName: expense.attachmentPath.split(/[\\/]/u).at(-1) ?? 'Документ расхода',
        managed: /^media\/expenses\/[\da-f-]+\.(?:jpe?g|png|webp|pdf)$/iu.test(
          expense.attachmentPath,
        ),
      }
    : undefined;
  return {
    amount: expense.amount,
    ...(attachment ? { attachment } : {}),
    branchId: expense.branchId,
    branchName: expense.branch.name,
    categoryId: expense.categoryId,
    categoryName: expense.category.name,
    confirmedByName: expense.confirmedByUser?.fullName,
    createdAt: expense.createdAt.toISOString(),
    createdByName: expense.createdByUser.fullName,
    description: expense.description,
    documentNumber: expense.documentNumber ?? undefined,
    id: expense.id,
    paymentMethod: expense.paymentMethod,
    spentAt: expense.spentAt.toISOString(),
    status: expense.status,
    updatedAt: expense.updatedAt.toISOString(),
    vendor: expense.vendor ?? undefined,
  };
}

function ruleSummary(rule: PayrollRuleRecord): PayrollRuleSummary {
  return {
    amountPerAttendee: rule.amountPerAttendee ?? undefined,
    branchId: rule.branchId,
    branchName: rule.branch.name,
    coachId: rule.coachId,
    coachName: rule.coach.fullName,
    createdAt: rule.createdAt.toISOString(),
    fixedAmount: rule.fixedAmount ?? undefined,
    groupId: rule.groupId ?? undefined,
    groupName: rule.group?.name,
    id: rule.id,
    isActive: rule.isActive,
    monthlyAmount: rule.monthlyAmount ?? undefined,
    percent: rule.percent ?? undefined,
    type: rule.type,
    updatedAt: rule.updatedAt.toISOString(),
    validFrom: rule.validFrom.toISOString().slice(0, 10),
    validTo: rule.validTo?.toISOString().slice(0, 10),
  };
}

function accrualSummary(accrual: PayrollPeriodRecord['accruals'][number]): PayrollAccrualSummary {
  return {
    attendeeCount: accrual.attendeeCount ?? undefined,
    baseAmount: accrual.baseAmount,
    branchId: accrual.branchId,
    branchName: accrual.branch.name,
    calculatedAmount: accrual.calculatedAmount,
    coachId: accrual.coachId,
    coachName: accrual.coach.fullName,
    comment: accrual.comment ?? undefined,
    finalAmount: accrual.finalAmount,
    groupId: accrual.groupId ?? undefined,
    groupName: accrual.group?.name,
    id: accrual.id,
    lessonId: accrual.lessonId ?? undefined,
    lessonStartsAt: accrual.lesson?.startsAt.toISOString(),
    manualAdjustment: accrual.manualAdjustment,
    payoutAmount: accrual.payoutAmount ?? undefined,
    payoutCategory: accrual.payoutCategory ?? undefined,
    payoutMode: accrual.payoutMode ?? undefined,
    payoutPercentage:
      accrual.payoutPercentageBasisPoints === null
        ? undefined
        : accrual.payoutPercentageBasisPoints / 100,
    revenueBase: accrual.revenueBase ?? undefined,
    type: accrual.type,
  };
}

function periodSummary(period: PayrollPeriodRecord): PayrollPeriodSummary {
  return {
    approvedByName: period.approvedByUser?.fullName,
    branchId: period.branchId ?? undefined,
    createdAt: period.createdAt.toISOString(),
    createdByName: period.createdByUser.fullName,
    dateFrom: period.dateFrom.toISOString().slice(0, 10),
    dateTo: period.dateTo.toISOString().slice(0, 10),
    id: period.id,
    status: period.status,
    totalAmount: period.accruals.reduce((sum, accrual) => sum + accrual.finalAmount, 0),
    updatedAt: period.updatedAt.toISOString(),
  };
}

function periodDetail(
  period: PayrollPeriodRecord,
  pendingAttendance: PayrollPendingLessonSummary[],
): PayrollPeriodDetail {
  return {
    ...periodSummary(period),
    accruals: period.accruals.map(accrualSummary),
    pendingAttendance,
    unconfiguredPayoutCount: period.accruals.filter(
      ({ payoutCategory, payoutMode }) => payoutCategory !== null && payoutMode === null,
    ).length,
  };
}

function metric(current: number, previous: number): AnalyticsMetric {
  const changePercent =
    previous === 0 ? (current === 0 ? 0 : 100) : ((current - previous) / previous) * 100;
  return { changePercent: Math.round(changePercent * 10) / 10, current, previous };
}

function csvCell(value: number | string): string {
  const text = String(value);
  return /[";,\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export class ManagementService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async listExpenseCategories(
    token: string,
    includeArchived = false,
  ): Promise<ExpenseCategorySummary[]> {
    const actor = await this.financeActor(token, 'expenses:read');
    const branchIds = accessibleBranchIds(actor);
    const categories = await this.database.expenseCategory.findMany({
      include: { branch: { select: { name: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      where: {
        ...(branchIds ? { OR: [{ branchId: null }, { branchId: { in: branchIds } }] } : {}),
        ...(includeArchived ? {} : { archivedAt: null }),
      },
    });
    return categories.map((category) => ({
      archivedAt: category.archivedAt?.toISOString(),
      branchId: category.branchId ?? undefined,
      branchName: category.branch?.name,
      createdAt: category.createdAt.toISOString(),
      description: category.description ?? undefined,
      id: category.id,
      isActive: category.isActive,
      name: category.name,
      updatedAt: category.updatedAt.toISOString(),
    }));
  }

  async createExpenseCategory(
    token: string,
    input: ExpenseCategoryInput,
  ): Promise<ExpenseCategorySummary> {
    const actor = await this.financeActor(token, 'expense-categories:manage');
    if (input.branchId) assertBranchAccess(actor, input.branchId);
    if (actor.role === 'ADMIN' && actor.branchIds.length > 0 && !input.branchId)
      throw new DomainError(
        'AUTHORIZATION',
        'Руководитель филиала не может создавать общие категории.',
      );
    const category = await this.database.$transaction(async (transaction) => {
      const created = await transaction.expenseCategory.create({ data: this.categoryData(input) });
      await this.audit(
        transaction,
        actor.id,
        'EXPENSE_CATEGORY_CREATED',
        'ExpenseCategory',
        created.id,
        input,
      );
      return created;
    });
    return requireResult(
      (await this.listExpenseCategories(token, true)).find(({ id }) => id === category.id),
      'Категория расходов не найдена.',
    );
  }

  async updateExpenseCategory(
    token: string,
    id: string,
    input: ExpenseCategoryInput,
  ): Promise<ExpenseCategorySummary> {
    const actor = await this.financeActor(token, 'expense-categories:manage');
    const current = await this.requireCategory(id);
    if (current.branchId) assertBranchAccess(actor, current.branchId);
    if (input.branchId) assertBranchAccess(actor, input.branchId);
    if (
      actor.role === 'ADMIN' &&
      actor.branchIds.length > 0 &&
      (!current.branchId || !input.branchId)
    )
      throw new DomainError(
        'AUTHORIZATION',
        'Общие категории доступны для изменения только администратору.',
      );
    await this.database.$transaction(async (transaction) => {
      await transaction.expenseCategory.update({ data: this.categoryData(input), where: { id } });
      await this.audit(
        transaction,
        actor.id,
        'EXPENSE_CATEGORY_UPDATED',
        'ExpenseCategory',
        id,
        input,
      );
    });
    return requireResult(
      (await this.listExpenseCategories(token, true)).find((item) => item.id === id),
      'Категория расходов не найдена.',
    );
  }

  async archiveExpenseCategory(token: string, id: string): Promise<ExpenseCategorySummary> {
    const actor = await this.financeActor(token, 'expense-categories:manage');
    const current = await this.requireCategory(id);
    if (current.branchId) assertBranchAccess(actor, current.branchId);
    if (actor.role === 'ADMIN' && actor.branchIds.length > 0 && !current.branchId)
      throw new DomainError('AUTHORIZATION', 'Общие категории доступны только администратору.');
    await this.database.$transaction(async (transaction) => {
      await transaction.expenseCategory.update({
        data: { archivedAt: new Date(), isActive: false },
        where: { id },
      });
      await this.audit(transaction, actor.id, 'EXPENSE_CATEGORY_ARCHIVED', 'ExpenseCategory', id);
    });
    return requireResult(
      (await this.listExpenseCategories(token, true)).find((item) => item.id === id),
      'Категория расходов не найдена.',
    );
  }

  async listExpenses(token: string, query: ExpenseListQuery): Promise<ExpenseSummary[]> {
    const actor = await this.financeActor(token, 'expenses:read');
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const branchIds = accessibleBranchIds(actor);
    const search = query.search?.trim();
    const records = await this.database.expense.findMany({
      include: expenseInclude,
      orderBy: { spentAt: 'desc' },
      where: {
        ...(query.branchId
          ? { branchId: query.branchId }
          : branchIds
            ? { branchId: { in: branchIds } }
            : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.createdByUserId ? { createdByUserId: query.createdByUserId } : {}),
        ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { vendor: { contains: search } },
                { description: { contains: search } },
                { documentNumber: { contains: search } },
              ],
            }
          : {}),
        spentAt: dateRangeScope(query.dateFrom, query.dateTo),
      },
    });
    return records.map(expenseSummary);
  }

  async createExpense(token: string, input: ExpenseInput): Promise<ExpenseSummary> {
    const actor = await this.financeActor(token, 'expenses:manage');
    assertBranchAccess(actor, input.branchId);
    this.assertPositiveAmount(input.amount);
    await this.assertExpenseCategory(input.categoryId, input.branchId);
    const created = await this.database.$transaction(async (transaction) => {
      const expense = await transaction.expense.create({ data: this.expenseData(input, actor.id) });
      await this.audit(transaction, actor.id, 'EXPENSE_CREATED', 'Expense', expense.id, {
        amount: input.amount,
      });
      return expense;
    });
    return this.getExpense(token, created.id);
  }

  async updateExpense(token: string, id: string, input: ExpenseInput): Promise<ExpenseSummary> {
    const actor = await this.financeActor(token, 'expenses:manage');
    const current = await this.requireExpense(id);
    assertBranchAccess(actor, current.branchId);
    assertBranchAccess(actor, input.branchId);
    this.assertPositiveAmount(input.amount);
    if (current.status !== 'DRAFT')
      throw new DomainError('VALIDATION', 'Изменять можно только черновик расхода.');
    await this.assertExpenseCategory(input.categoryId, input.branchId);
    await this.database.$transaction(async (transaction) => {
      const { createdByUserId: _createdByUserId, ...data } = this.expenseData(input, actor.id);
      await transaction.expense.update({ data, where: { id } });
      await this.audit(transaction, actor.id, 'EXPENSE_UPDATED', 'Expense', id, {
        amount: input.amount,
      });
    });
    return this.getExpense(token, id);
  }

  async confirmExpense(token: string, id: string, cashRegisterId: string): Promise<ExpenseSummary> {
    const actor = await this.financeActor(token, 'expenses:manage');
    const expense = await this.requireExpense(id);
    assertBranchAccess(actor, expense.branchId);
    if (expense.status !== 'DRAFT')
      throw new DomainError('VALIDATION', 'Подтвердить можно только черновик расхода.');
    const register = await this.requireRegister(cashRegisterId);
    if (register.branchId !== expense.branchId || !register.isActive)
      throw new DomainError('VALIDATION', 'Выберите активную кассу этого филиала.');
    await this.database.$transaction(async (transaction) => {
      await transaction.expense.update({
        data: { confirmedByUserId: actor.id, status: 'CONFIRMED' },
        where: { id },
      });
      await this.createCashTransaction(transaction, {
        actorId: actor.id,
        amount: expense.amount,
        branchId: expense.branchId,
        cashRegisterId,
        comment: `Расход: ${expense.description}`,
        occurredAt: expense.spentAt,
        sourceId: id,
        sourceType: 'EXPENSE',
        type: 'EXPENSE',
      });
      await this.audit(transaction, actor.id, 'EXPENSE_CONFIRMED', 'Expense', id, {
        cashRegisterId,
      });
    });
    return this.getExpense(token, id);
  }

  async cancelExpense(token: string, id: string): Promise<ExpenseSummary> {
    const actor = await this.financeActor(token, 'expenses:manage');
    const expense = await this.requireExpense(id);
    assertBranchAccess(actor, expense.branchId);
    if (expense.status === 'CANCELLED') throw new DomainError('VALIDATION', 'Расход уже отменён.');
    await this.database.$transaction(async (transaction) => {
      if (expense.status === 'CONFIRMED') {
        const source = await transaction.cashTransaction.findFirst({
          where: { sourceId: id, sourceType: 'EXPENSE', type: 'EXPENSE' },
        });
        if (source)
          await this.createCashTransaction(transaction, {
            actorId: actor.id,
            amount: source.amount,
            branchId: source.branchId,
            cashRegisterId: source.cashRegisterId,
            comment: `Сторно расхода: ${expense.description}`,
            occurredAt: new Date(),
            sourceId: id,
            sourceType: 'EXPENSE',
            type: 'INCOME',
          });
      }
      await transaction.expense.update({ data: { status: 'CANCELLED' }, where: { id } });
      await this.audit(transaction, actor.id, 'EXPENSE_CANCELLED', 'Expense', id);
    });
    return this.getExpense(token, id);
  }

  async expenseAttachmentReference(token: string, id: string): Promise<string | undefined> {
    const actor = await this.financeActor(token, 'expenses:read');
    const expense = await this.requireExpense(id);
    assertBranchAccess(actor, expense.branchId);
    return expense.attachmentPath ?? undefined;
  }

  async listCashRegisters(token: string, branchId?: string): Promise<CashRegisterSummary[]> {
    const actor = await this.financeActor(token, 'cash:read');
    if (branchId) assertBranchAccess(actor, branchId);
    const branchIds = accessibleBranchIds(actor);
    const registers = await this.database.cashRegister.findMany({
      include: {
        branch: { select: { name: true } },
        transactions: { select: { amount: true, type: true } },
      },
      orderBy: [{ branch: { name: 'asc' } }, { name: 'asc' }],
      where: branchId ? { branchId } : branchIds ? { branchId: { in: branchIds } } : {},
    });
    return registers.map((register) => ({
      balance:
        register.openingBalance +
        register.transactions.reduce(
          (sum, item) =>
            sum +
            (item.type === 'INCOME' || (item.type === 'CORRECTION' && item.amount > 0)
              ? item.amount
              : item.type === 'EXPENSE' || (item.type === 'CORRECTION' && item.amount < 0)
                ? -Math.abs(item.amount)
                : item.amount),
          0,
        ),
      branchId: register.branchId,
      branchName: register.branch.name,
      createdAt: register.createdAt.toISOString(),
      id: register.id,
      isActive: register.isActive,
      name: register.name,
      openingBalance: register.openingBalance,
      type: register.type,
      updatedAt: register.updatedAt.toISOString(),
    }));
  }

  async createCashRegister(token: string, input: CashRegisterInput): Promise<CashRegisterSummary> {
    const actor = await this.financeActor(token, 'cash:manage');
    assertBranchAccess(actor, input.branchId);
    const created = await this.database.$transaction(async (transaction) => {
      const register = await transaction.cashRegister.create({
        data: { ...input, name: input.name.trim() },
      });
      await this.audit(
        transaction,
        actor.id,
        'CASH_REGISTER_CREATED',
        'CashRegister',
        register.id,
        input,
      );
      return register;
    });
    return requireResult(
      (await this.listCashRegisters(token)).find(({ id }) => id === created.id),
      'Касса не найдена.',
    );
  }

  async updateCashRegister(
    token: string,
    id: string,
    input: CashRegisterInput,
  ): Promise<CashRegisterSummary> {
    const actor = await this.financeActor(token, 'cash:manage');
    const current = await this.requireRegister(id);
    assertBranchAccess(actor, current.branchId);
    assertBranchAccess(actor, input.branchId);
    if (current.branchId !== input.branchId)
      throw new DomainError('VALIDATION', 'Нельзя перенести кассу в другой филиал.');
    if (
      current.openingBalance !== input.openingBalance &&
      actor.role === 'ADMIN' &&
      actor.branchIds.length > 0
    )
      throw new DomainError(
        'AUTHORIZATION',
        'Начальный остаток может изменить только администратор.',
      );
    await this.database.$transaction(async (transaction) => {
      await transaction.cashRegister.update({
        data: { ...input, name: input.name.trim() },
        where: { id },
      });
      await this.audit(transaction, actor.id, 'CASH_REGISTER_UPDATED', 'CashRegister', id, input);
    });
    return requireResult(
      (await this.listCashRegisters(token)).find((item) => item.id === id),
      'Касса не найдена.',
    );
  }

  async listCashTransactions(
    token: string,
    query: CashTransactionQuery,
  ): Promise<CashTransactionSummary[]> {
    const actor = await this.financeActor(token, 'cash:read');
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const branchIds = accessibleBranchIds(actor);
    const records = await this.database.cashTransaction.findMany({
      include: {
        cashRegister: { select: { name: true } },
        createdByUser: { select: { fullName: true } },
      },
      orderBy: { occurredAt: 'desc' },
      where: {
        ...(query.branchId
          ? { branchId: query.branchId }
          : branchIds
            ? { branchId: { in: branchIds } }
            : {}),
        ...(query.cashRegisterId ? { cashRegisterId: query.cashRegisterId } : {}),
        occurredAt: dateRangeScope(query.dateFrom, query.dateTo),
      },
    });
    return records.map((item) => ({
      amount: item.amount,
      branchId: item.branchId,
      cashRegisterId: item.cashRegisterId,
      cashRegisterName: item.cashRegister.name,
      comment: item.comment ?? undefined,
      createdAt: item.createdAt.toISOString(),
      createdByName: item.createdByUser.fullName,
      id: item.id,
      occurredAt: item.occurredAt.toISOString(),
      sourceId: item.sourceId ?? undefined,
      sourceType: item.sourceType,
      type: item.type,
    }));
  }

  async correctCash(token: string, input: CashCorrectionInput): Promise<CashTransactionSummary> {
    const actor = await this.financeActor(token, 'cash:correct');
    if (!Number.isInteger(input.amount) || input.amount === 0)
      throw new DomainError('VALIDATION', 'Сумма корректировки не может быть нулевой.');
    const register = await this.requireRegister(input.cashRegisterId);
    assertBranchAccess(actor, register.branchId);
    const transaction = await this.database.$transaction(async (client) => {
      const created = await this.createCashTransaction(client, {
        actorId: actor.id,
        amount: input.amount,
        branchId: register.branchId,
        cashRegisterId: register.id,
        comment: input.reason.trim(),
        occurredAt: new Date(input.occurredAt),
        sourceType: 'MANUAL',
        type: 'CORRECTION',
      });
      await this.audit(client, actor.id, 'CASH_CORRECTED', 'CashTransaction', created.id, input);
      return created;
    });
    return requireResult(
      (
        await this.listCashTransactions(token, {
          cashRegisterId: register.id,
          dateFrom: new Date(0).toISOString(),
          dateTo: new Date('9999-12-31T23:59:59.999Z').toISOString(),
        })
      ).find(({ id }) => id === transaction.id),
      'Операция не найдена.',
    );
  }

  async transferCash(token: string, input: CashTransferInput): Promise<CashTransactionSummary[]> {
    const actor = await this.financeActor(token, 'cash:manage');
    this.assertPositiveAmount(input.amount);
    if (input.fromCashRegisterId === input.toCashRegisterId)
      throw new DomainError('VALIDATION', 'Выберите разные кассы для перевода.');
    const [from, to] = await Promise.all([
      this.requireRegister(input.fromCashRegisterId),
      this.requireRegister(input.toCashRegisterId),
    ]);
    assertBranchAccess(actor, from.branchId);
    assertBranchAccess(actor, to.branchId);
    if (!from.isActive || !to.isActive)
      throw new DomainError('VALIDATION', 'Переводы доступны только между активными кассами.');
    const ids = await this.database.$transaction(async (transaction) => {
      const outgoing = await this.createCashTransaction(transaction, {
        actorId: actor.id,
        amount: -input.amount,
        branchId: from.branchId,
        cashRegisterId: from.id,
        comment: input.reason.trim(),
        occurredAt: new Date(input.occurredAt),
        sourceType: 'MANUAL',
        type: 'TRANSFER',
      });
      const incoming = await this.createCashTransaction(transaction, {
        actorId: actor.id,
        amount: input.amount,
        branchId: to.branchId,
        cashRegisterId: to.id,
        comment: input.reason.trim(),
        occurredAt: new Date(input.occurredAt),
        sourceId: outgoing.id,
        sourceType: 'MANUAL',
        type: 'TRANSFER',
      });
      await this.audit(transaction, actor.id, 'CASH_TRANSFERRED', 'CashTransaction', outgoing.id, {
        ...input,
        incomingId: incoming.id,
      });
      return [outgoing.id, incoming.id];
    });
    const history = await this.listCashTransactions(token, {
      dateFrom: new Date(0).toISOString(),
      dateTo: new Date('9999-12-31T23:59:59.999Z').toISOString(),
    });
    return history.filter(({ id }) => ids.includes(id));
  }

  async listPayrollRules(token: string, branchId?: string): Promise<PayrollRuleSummary[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payroll:read');
    if (branchId) assertBranchAccess(actor, branchId);
    const branchIds = accessibleBranchIds(actor);
    const records = await this.database.payrollRule.findMany({
      include: payrollRuleInclude,
      orderBy: [{ coach: { fullName: 'asc' } }, { validFrom: 'desc' }],
      where: {
        ...(branchId ? { branchId } : branchIds ? { branchId: { in: branchIds } } : {}),
        ...(actor.role === 'COACH' ? { coachId: actor.id } : {}),
      },
    });
    return records.map(ruleSummary);
  }

  async getTrainerPayoutProfile(token: string, trainerId: string): Promise<TrainerPayoutProfile> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payroll:read');
    const trainer = await this.database.user.findUnique({
      include: { branchAssignments: true },
      where: { id: trainerId },
    });
    if (trainer?.role !== 'COACH') throw new DomainError('NOT_FOUND', 'Тренер не найден.');
    if (actor.role === 'COACH')
      throw new DomainError('AUTHORIZATION', 'Настройки выплат недоступны тренеру.');
    const branchIds = accessibleBranchIds(actor);
    if (
      branchIds &&
      trainer.branchAssignments.length > 0 &&
      !trainer.branchAssignments.some(({ branchId }) => branchIds.includes(branchId))
    )
      throw new DomainError('AUTHORIZATION', 'Профиль выплат недоступен в ваших филиалах.');
    const [rules, legacyRuleCount] = await Promise.all([
      this.database.trainerPayoutRule.findMany({
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        where: { trainerId },
      }),
      this.database.payrollRule.count({ where: { coachId: trainerId, isActive: true } }),
    ]);
    const now = new Date();
    const version = (rule: (typeof rules)[number]) => ({
      amount: rule.amount ?? undefined,
      category: rule.category,
      createdAt: rule.createdAt.toISOString(),
      effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10),
      id: rule.id,
      mode: rule.mode ?? undefined,
      percentage:
        rule.percentageBasisPoints === null ? undefined : rule.percentageBasisPoints / 100,
    });
    return {
      canEdit: actor.role === 'OWNER',
      categories: PAYOUT_CATEGORIES.map((category) => {
        const matching = rules.filter((rule) => rule.category === category);
        const current = matching.find((rule) => rule.effectiveFrom <= now);
        return {
          category,
          current: current ? version(current) : undefined,
          future: matching
            .filter((rule) => rule.effectiveFrom > now)
            .reverse()
            .map(version),
          history: matching
            .filter((rule) => rule.effectiveFrom <= now && rule.id !== current?.id)
            .map(version),
        };
      }),
      legacyRuleCount,
      trainerId,
      trainerName: trainer.fullName,
    };
  }

  async saveTrainerPayoutProfile(
    token: string,
    input: TrainerPayoutProfileInput,
  ): Promise<TrainerPayoutProfile> {
    const actor = await this.application.authenticate(token);
    if (actor.role !== 'OWNER')
      throw new DomainError('AUTHORIZATION', 'Настраивать выплаты может только владелец.');
    const trainer = await this.database.user.findUnique({ where: { id: input.trainerId } });
    if (trainer?.role !== 'COACH') throw new DomainError('NOT_FOUND', 'Тренер не найден.');
    if (
      input.rules.length !== PAYOUT_CATEGORIES.length ||
      new Set(input.rules.map(({ category }) => category)).size !== PAYOUT_CATEGORIES.length
    )
      throw new DomainError('VALIDATION', 'Укажите правило для каждой категории.');
    const effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00`);
    if (Number.isNaN(effectiveFrom.getTime()))
      throw new DomainError('VALIDATION', 'Укажите корректную дату начала действия.');
    for (const rule of input.rules) this.assertTrainerPayoutRule(rule);
    await this.database.$transaction(async (transaction) => {
      for (const rule of input.rules) {
        await transaction.trainerPayoutRule.upsert({
          create: {
            amount: rule.amount ?? null,
            category: rule.category,
            createdByUserId: actor.id,
            effectiveFrom,
            mode: rule.mode ?? null,
            percentageBasisPoints:
              rule.percentage === undefined ? null : Math.round(rule.percentage * 100),
            trainerId: input.trainerId,
          },
          update: {
            amount: rule.amount ?? null,
            createdByUserId: actor.id,
            mode: rule.mode ?? null,
            percentageBasisPoints:
              rule.percentage === undefined ? null : Math.round(rule.percentage * 100),
          },
          where: {
            trainerId_category_effectiveFrom: {
              category: rule.category,
              effectiveFrom,
              trainerId: input.trainerId,
            },
          },
        });
      }
      await this.audit(
        transaction,
        actor.id,
        'TRAINER_PAYOUT_PROFILE_SAVED',
        'User',
        input.trainerId,
        {
          categories: input.rules.map(({ category, mode }) => ({ category, mode: mode ?? null })),
          effectiveFrom: input.effectiveFrom,
        },
      );
    });
    return this.getTrainerPayoutProfile(token, input.trainerId);
  }

  async createPayrollRule(token: string, input: PayrollRuleInput): Promise<PayrollRuleSummary> {
    const actor = await this.financeActor(token, 'payroll:manage');
    assertBranchAccess(actor, input.branchId);
    await this.assertPayrollRule(input);
    const record = await this.database.$transaction(async (transaction) => {
      const created = await transaction.payrollRule.create({ data: this.payrollRuleData(input) });
      await this.audit(
        transaction,
        actor.id,
        'PAYROLL_RULE_CREATED',
        'PayrollRule',
        created.id,
        input,
      );
      return created;
    });
    return requireResult(
      (await this.listPayrollRules(token)).find(({ id }) => id === record.id),
      'Правило расчёта не найдено.',
    );
  }

  async updatePayrollRule(
    token: string,
    id: string,
    input: PayrollRuleInput,
  ): Promise<PayrollRuleSummary> {
    const actor = await this.financeActor(token, 'payroll:manage');
    const current = await this.database.payrollRule.findUnique({ where: { id } });
    if (!current) throw new DomainError('NOT_FOUND', 'Правило расчёта не найдено.');
    assertBranchAccess(actor, current.branchId);
    assertBranchAccess(actor, input.branchId);
    await this.assertPayrollRule(input, id);
    await this.database.$transaction(async (transaction) => {
      await transaction.payrollRule.update({ data: this.payrollRuleData(input), where: { id } });
      await this.audit(transaction, actor.id, 'PAYROLL_RULE_UPDATED', 'PayrollRule', id, input);
    });
    return requireResult(
      (await this.listPayrollRules(token)).find((item) => item.id === id),
      'Правило расчёта не найдено.',
    );
  }

  async createPayrollPeriod(
    token: string,
    input: PayrollPeriodInput,
  ): Promise<PayrollPeriodDetail> {
    const actor = await this.financeActor(token, 'payroll:calculate');
    if (input.branchId) assertBranchAccess(actor, input.branchId);
    if (actor.role === 'ADMIN' && actor.branchIds.length > 0 && !input.branchId)
      throw new DomainError('AUTHORIZATION', 'Для расчёта выберите доступный филиал.');
    const period = await this.database.payrollPeriod.create({
      data: {
        branchId: input.branchId ?? null,
        createdByUserId: actor.id,
        dateFrom: dateOnly(input.dateFrom),
        dateTo: endDate(input.dateTo),
      },
    });
    return this.getPayrollPeriod(token, period.id);
  }

  async listPayrollPeriods(token: string, branchId?: string): Promise<PayrollPeriodSummary[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payroll:read');
    if (branchId) assertBranchAccess(actor, branchId);
    const branchIds = accessibleBranchIds(actor);
    const records = await this.database.payrollPeriod.findMany({
      include: payrollPeriodInclude,
      orderBy: { dateFrom: 'desc' },
      where: {
        ...(branchId ? { branchId } : branchIds ? { branchId: { in: branchIds } } : {}),
        ...(actor.role === 'COACH' ? { accruals: { some: { coachId: actor.id } } } : {}),
      },
    });
    return records.map(periodSummary);
  }

  async getPayrollPeriod(token: string, id: string): Promise<PayrollPeriodDetail> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payroll:read');
    const period = await this.requirePayrollPeriod(id);
    if (period.branchId) assertBranchAccess(actor, period.branchId);
    const pendingAttendance = await this.pendingPayrollAttendance(period);
    if (
      actor.role === 'COACH' &&
      !period.accruals.some(({ coachId }) => coachId === actor.id) &&
      !pendingAttendance.some(({ coachId }) => coachId === actor.id)
    )
      throw new DomainError('AUTHORIZATION', 'Расчёт недоступен этому тренеру.');
    return actor.role === 'COACH'
      ? periodDetail(
          {
            ...period,
            accruals: period.accruals.filter(({ coachId }) => coachId === actor.id),
          },
          pendingAttendance.filter(({ coachId }) => coachId === actor.id),
        )
      : periodDetail(period, pendingAttendance);
  }

  async calculatePayrollPeriod(token: string, id: string): Promise<PayrollPeriodDetail> {
    const actor = await this.financeActor(token, 'payroll:calculate');
    const period = await this.requirePayrollPeriod(id);
    if (period.branchId) assertBranchAccess(actor, period.branchId);
    if (period.status === 'APPROVED' || period.status === 'PAID')
      throw new DomainError('VALIDATION', 'Утверждённый расчёт нельзя изменить.');
    const lessons = await this.database.lesson.findMany({
      include: {
        attendance: true,
        substitution: true,
        trialAppointments: {
          select: { status: true, studentId: true, supersededAt: true },
        },
      },
      where: {
        ...(period.branchId ? { branchId: period.branchId } : {}),
        startsAt: { gte: period.dateFrom, lte: period.dateTo },
        status: 'COMPLETED',
      },
    });
    const coachIds = [...new Set(lessons.flatMap(({ coachId }) => (coachId ? [coachId] : [])))];
    const [rules, payoutRules] = await Promise.all([
      this.database.payrollRule.findMany({
        where: {
          coachId: { in: coachIds },
          isActive: true,
          ...(period.branchId ? { branchId: period.branchId } : {}),
          validFrom: { lte: period.dateTo },
          OR: [{ validTo: null }, { validTo: { gte: period.dateFrom } }],
        },
      }),
      this.database.trainerPayoutRule.findMany({
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        where: { trainerId: { in: coachIds } },
      }),
    ]);
    const accruals: Prisma.PayrollAccrualCreateManyInput[] = [];
    for (const lesson of lessons) {
      if (!lesson.coachId) continue;
      if (!lesson.attendanceCompletedAt) continue;
      const trainerPolicies = payoutRules.filter(({ trainerId }) => trainerId === lesson.coachId);
      if (trainerPolicies.length > 0) {
        const effectiveRule = (category: PayoutCategory) =>
          trainerPolicies.find(
            (rule) => rule.category === category && rule.effectiveFrom <= lesson.startsAt,
          );
        const substitutionRule = lesson.substitution ? effectiveRule('SUBSTITUTION') : undefined;
        const useSubstitutionRule = Boolean(substitutionRule?.mode);
        const trialStudentIds = new Set(
          lesson.trialAppointments.flatMap((appointment) =>
            appointment.studentId &&
            appointment.status === 'BOOKED' &&
            appointment.supersededAt === null
              ? [appointment.studentId]
              : [],
          ),
        );
        const eligible = lesson.attendance.filter(
          ({ status }) => status === 'PRESENT' || status === 'TRIAL',
        );
        const categorized = new Map<PayoutCategory, string[]>();
        for (const attendance of eligible) {
          const category: PayoutCategory = useSubstitutionRule
            ? 'SUBSTITUTION'
            : attendance.status === 'TRIAL' || trialStudentIds.has(attendance.studentId)
              ? 'TRIAL'
              : attendance.directPaymentId
                ? 'SINGLE_VISIT'
                : lesson.payoutCategory;
          categorized.set(category, [...(categorized.get(category) ?? []), attendance.studentId]);
        }
        if (categorized.size === 0) {
          const category: PayoutCategory = useSubstitutionRule
            ? 'SUBSTITUTION'
            : lesson.payoutCategory;
          categorized.set(category, []);
        }
        for (const [category, studentIds] of categorized) {
          const rule = category === 'SUBSTITUTION' ? substitutionRule : effectiveRule(category);
          const mode = rule?.mode ?? null;
          const revenueBase =
            mode === 'PERCENTAGE' ? await this.lessonRevenueBase(lesson.id, studentIds) : null;
          const calculatedAmount = this.calculateTrainerPayout(
            mode,
            rule?.amount ?? 0,
            rule?.percentageBasisPoints ?? 0,
            studentIds.length,
            revenueBase ?? 0,
          );
          const type = this.payoutModeToPayrollType(mode);
          accruals.push({
            attendeeCount: studentIds.length,
            baseAmount: rule?.amount ?? 0,
            branchId: lesson.branchId,
            calculatedAmount,
            coachId: lesson.coachId,
            finalAmount: calculatedAmount,
            groupId: lesson.groupId,
            lessonId: lesson.id,
            payoutAmount: rule?.amount ?? null,
            payoutCategory: category,
            payoutMode: mode,
            payoutPercentageBasisPoints: rule?.percentageBasisPoints ?? null,
            payoutRuleEffectiveFrom: rule?.effectiveFrom ?? null,
            payoutRuleId: rule?.id ?? null,
            payrollPeriodId: id,
            revenueBase,
            type,
          });
        }
        continue;
      }
      const rule = rules
        .filter(
          (item) =>
            item.coachId === lesson.coachId &&
            item.branchId === lesson.branchId &&
            (!item.groupId || item.groupId === lesson.groupId) &&
            item.validFrom <= lesson.startsAt &&
            (!item.validTo || item.validTo >= lesson.startsAt),
        )
        .sort((a, b) => Number(Boolean(b.groupId)) - Number(Boolean(a.groupId)))[0];
      if (!rule || rule.type === 'FIXED_MONTHLY') continue;
      const attendeeCount = lesson.attendance.filter(({ status }) => status === 'PRESENT').length;
      const revenueBase =
        rule.type === 'PERCENT_OF_REVENUE' ? await this.lessonRevenueBase(lesson.id) : null;
      const calculatedAmount = this.calculateAccrual(rule, attendeeCount, revenueBase ?? 0);
      accruals.push({
        baseAmount: rule.fixedAmount ?? rule.amountPerAttendee ?? 0,
        attendeeCount,
        branchId: lesson.branchId,
        calculatedAmount,
        coachId: lesson.coachId,
        finalAmount: calculatedAmount,
        groupId: lesson.groupId,
        lessonId: lesson.id,
        payrollPeriodId: id,
        revenueBase,
        type: rule.type,
      });
    }
    const trainersWithProfiles = new Set(payoutRules.map(({ trainerId }) => trainerId));
    for (const rule of rules.filter(
      ({ coachId, type }) => type === 'FIXED_MONTHLY' && !trainersWithProfiles.has(coachId),
    )) {
      const calculatedAmount = rule.monthlyAmount ?? 0;
      accruals.push({
        baseAmount: calculatedAmount,
        branchId: rule.branchId,
        calculatedAmount,
        coachId: rule.coachId,
        finalAmount: calculatedAmount,
        groupId: rule.groupId,
        lessonId: null,
        payrollPeriodId: id,
        type: rule.type,
      });
    }
    await this.database.$transaction(async (transaction) => {
      await transaction.payrollAccrual.deleteMany({ where: { payrollPeriodId: id } });
      if (accruals.length) await transaction.payrollAccrual.createMany({ data: accruals });
      await transaction.payrollPeriod.update({ data: { status: 'CALCULATED' }, where: { id } });
      await this.audit(transaction, actor.id, 'PAYROLL_CALCULATED', 'PayrollPeriod', id, {
        accrualCount: accruals.length,
      });
    });
    return this.getPayrollPeriod(token, id);
  }

  async adjustPayrollAccrual(
    token: string,
    id: string,
    input: PayrollAdjustmentInput,
  ): Promise<PayrollPeriodDetail> {
    const actor = await this.financeActor(token, 'payroll:adjust');
    const accrual = await this.database.payrollAccrual.findUnique({
      include: { payrollPeriod: true },
      where: { id },
    });
    if (!accrual) throw new DomainError('NOT_FOUND', 'Начисление не найдено.');
    if (accrual.payrollPeriod.status !== 'CALCULATED')
      throw new DomainError('VALIDATION', 'Корректировать можно только рассчитанный период.');
    await this.database.$transaction(async (transaction) => {
      await transaction.payrollAccrual.update({
        data: {
          comment: input.reason.trim(),
          finalAmount: accrual.calculatedAmount + input.amount,
          manualAdjustment: input.amount,
        },
        where: { id },
      });
      await this.audit(transaction, actor.id, 'PAYROLL_ADJUSTED', 'PayrollAccrual', id, input);
    });
    return this.getPayrollPeriod(token, accrual.payrollPeriodId);
  }

  async approvePayrollPeriod(token: string, id: string): Promise<PayrollPeriodDetail> {
    const actor = await this.financeActor(token, 'payroll:approve');
    const period = await this.requirePayrollPeriod(id);
    if (period.status !== 'CALCULATED')
      throw new DomainError('VALIDATION', 'Сначала выполните расчёт зарплаты.');
    if ((await this.pendingPayrollAttendance(period)).length > 0)
      throw new DomainError(
        'VALIDATION',
        'Посещаемость заполнена не для всех занятий — расчёт нельзя утвердить.',
      );
    if (
      period.accruals.some(
        ({ payoutCategory, payoutMode }) => payoutCategory !== null && payoutMode === null,
      )
    )
      throw new DomainError(
        'VALIDATION',
        'Для части занятий выплаты тренеру не настроены — расчёт нельзя утвердить.',
      );
    await this.database.$transaction(async (transaction) => {
      await transaction.payrollPeriod.update({
        data: { approvedByUserId: actor.id, status: 'APPROVED' },
        where: { id },
      });
      await this.audit(transaction, actor.id, 'PAYROLL_APPROVED', 'PayrollPeriod', id);
    });
    return this.getPayrollPeriod(token, id);
  }

  async payPayrollPeriod(
    token: string,
    id: string,
    input: PayrollPaymentInput,
  ): Promise<PayrollPeriodDetail> {
    const actor = await this.financeActor(token, 'payroll:pay');
    const period = await this.requirePayrollPeriod(id);
    if (period.status !== 'APPROVED')
      throw new DomainError('VALIDATION', 'Оплатить можно только утверждённый период.');
    const register = await this.requireRegister(input.cashRegisterId);
    if (period.branchId && register.branchId !== period.branchId)
      throw new DomainError('VALIDATION', 'Касса не относится к филиалу расчёта.');
    if (period.accruals.some(({ branchId }) => branchId !== register.branchId))
      throw new DomainError(
        'VALIDATION',
        'Для общего периода выплаты выполняются отдельно по филиалам.',
      );
    const total = period.accruals.reduce((sum, accrual) => sum + accrual.finalAmount, 0);
    const category = await this.ensurePayrollCategory(this.database);
    await this.database.$transaction(async (transaction) => {
      const expense = await transaction.expense.create({
        data: {
          amount: total,
          branchId: register.branchId,
          categoryId: category.id,
          confirmedByUserId: actor.id,
          createdByUserId: actor.id,
          description: `Выплата зарплаты за период ${period.dateFrom.toLocaleDateString('ru-RU')} — ${period.dateTo.toLocaleDateString('ru-RU')}`,
          paymentMethod: register.type === 'CASH' ? 'CASH' : 'TRANSFER',
          spentAt: new Date(input.occurredAt),
          status: 'CONFIRMED',
        },
      });
      await this.createCashTransaction(transaction, {
        actorId: actor.id,
        amount: total,
        branchId: register.branchId,
        cashRegisterId: register.id,
        comment: expense.description,
        occurredAt: new Date(input.occurredAt),
        sourceId: id,
        sourceType: 'PAYROLL',
        type: 'EXPENSE',
      });
      await transaction.payrollPeriod.update({ data: { status: 'PAID' }, where: { id } });
      await this.audit(transaction, actor.id, 'PAYROLL_PAID', 'PayrollPeriod', id, {
        amount: total,
        expenseId: expense.id,
      });
    });
    return this.getPayrollPeriod(token, id);
  }

  async coachPayroll(
    token: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<PayrollAccrualSummary[]> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'payroll:read');
    const records = await this.database.payrollAccrual.findMany({
      include: {
        branch: { select: { name: true } },
        coach: { select: { fullName: true } },
        group: { select: { name: true } },
        lesson: { select: { startsAt: true } },
      },
      where: {
        ...(actor.role === 'COACH' ? { coachId: actor.id } : {}),
        payrollPeriod: {
          dateFrom: { gte: dateOnly(dateFrom) },
          dateTo: { lte: endDate(dateTo) },
          status: { in: ['CALCULATED', 'APPROVED', 'PAID'] },
        },
      },
    });
    return records.map((item) => accrualSummary(item));
  }

  async analytics(token: string, query: AnalyticsQuery): Promise<ManagementAnalytics> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'analytics:read');
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const currentFrom = new Date(query.dateFrom),
      currentTo = new Date(query.dateTo);
    const duration = currentTo.getTime() - currentFrom.getTime() + 1;
    const previousTo = new Date(currentFrom.getTime() - 1),
      previousFrom = new Date(previousTo.getTime() - duration);
    const [current, previous] = await Promise.all([
      this.analyticsPeriod(actor, query, currentFrom, currentTo),
      this.analyticsPeriod(actor, query, previousFrom, previousTo),
    ]);
    const breakdown = await this.analyticsBreakdown(actor, query, currentFrom, currentTo);
    return {
      activeStudents: metric(current.activeStudents, previous.activeStudents),
      attendancePercentage: metric(current.attendancePercentage, previous.attendancePercentage),
      averagePayment: metric(current.averagePayment, previous.averagePayment),
      breakdown,
      churnedStudents: metric(current.churnedStudents, previous.churnedStudents),
      coachWorkload: metric(current.coachWorkload, previous.coachWorkload),
      expenses: metric(current.expenses, previous.expenses),
      groupOccupancy: metric(current.groupOccupancy, previous.groupOccupancy),
      netProfit: metric(current.netProfit, previous.netProfit),
      newStudents: metric(current.newStudents, previous.newStudents),
      outstandingDebt: metric(current.outstandingDebt, previous.outstandingDebt),
      payrollAccrued: metric(current.payrollAccrued, previous.payrollAccrued),
      profitBeforePayroll: metric(current.profitBeforePayroll, previous.profitBeforePayroll),
      revenue: metric(current.revenue, previous.revenue),
    };
  }

  async report(token: string, query: ReportQuery): Promise<ReportData> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'reports:read');
    const analytics = await this.analytics(token, query);
    const scope = this.branchScope(actor, query.branchId);
    const range = dateRangeScope(query.dateFrom, query.dateTo);
    if (query.kind === 'CASH_FLOW') {
      const rows = await this.database.cashTransaction.findMany({
        include: { branch: true, cashRegister: true },
        orderBy: { occurredAt: 'asc' },
        where: { ...scope, occurredAt: range },
      });
      return {
        headers: ['Дата', 'Филиал', 'Касса', 'Тип', 'Источник', 'Сумма, ₽', 'Комментарий'],
        kind: query.kind,
        rows: rows.map((row) => [
          row.occurredAt.toLocaleDateString('ru-RU'),
          row.branch.name,
          row.cashRegister.name,
          row.type,
          row.sourceType,
          row.amount / 100,
          row.comment ?? '',
        ]),
        title: 'Движение денежных средств',
      };
    }
    if (query.kind === 'INCOME_EXPENSES' || query.kind === 'PROFIT_BY_BRANCH')
      return {
        headers: ['Филиал', 'Доходы, ₽', 'Расходы, ₽', 'Прибыль, ₽'],
        kind: query.kind,
        rows: analytics.breakdown.map((row) => [
          row.label,
          row.revenue / 100,
          row.expenses / 100,
          row.netProfit / 100,
        ]),
        title: query.kind === 'INCOME_EXPENSES' ? 'Доходы и расходы' : 'Прибыль по филиалам',
      };
    if (query.kind === 'PAYROLL_BY_COACH') {
      const rows = await this.database.payrollAccrual.groupBy({
        by: ['coachId'],
        _sum: { finalAmount: true },
        where: {
          ...scope,
          payrollPeriod: {
            dateFrom: { gte: new Date(query.dateFrom) },
            dateTo: { lte: new Date(query.dateTo) },
            status: { not: 'CANCELLED' },
          },
        },
      });
      const users = await this.database.user.findMany({
        where: { id: { in: rows.map(({ coachId }) => coachId) } },
      });
      return {
        headers: ['Тренер', 'Начислено, ₽'],
        kind: query.kind,
        rows: rows.map((row) => [
          users.find(({ id }) => id === row.coachId)?.fullName ?? '',
          (row._sum.finalAmount ?? 0) / 100,
        ]),
        title: 'Зарплата тренеров',
      };
    }
    if (query.kind === 'ATTENDANCE_BY_GROUP')
      return {
        headers: ['Группа', 'Посещаемость, %'],
        kind: query.kind,
        rows: analytics.breakdown.map((row) => [row.label, row.attendancePercentage]),
        title: 'Посещаемость по группам',
      };
    if (query.kind === 'GROUP_OCCUPANCY')
      return {
        headers: ['Группа', 'Заполняемость, %'],
        kind: query.kind,
        rows: analytics.breakdown.map((row) => [row.label, row.groupOccupancy]),
        title: 'Заполняемость групп',
      };
    const subscriptions = await this.database.subscription.findMany({
      include: { payments: { include: { refunds: true } }, student: true, tariff: true },
      where: { ...scope, status: { not: 'CANCELLED' } },
    });
    return {
      headers: ['Ученик', 'Абонемент', 'Стоимость, ₽', 'Оплачено, ₽', 'Долг, ₽'],
      kind: query.kind,
      rows: subscriptions.map((item) => {
        const paid = item.payments
          .filter(({ status }) => status !== 'CANCELLED')
          .reduce(
            (sum, payment) =>
              sum +
              payment.amount -
              payment.refunds.reduce((refundSum, refund) => refundSum + refund.amount, 0),
            0,
          );
        return [
          `${item.student.lastName} ${item.student.firstName}`,
          item.tariff.name,
          item.salePrice / 100,
          paid / 100,
          Math.max(0, item.salePrice - paid) / 100,
        ];
      }),
      title: 'Абонементы и задолженность',
    };
  }

  async exportReportCsv(token: string, query: ReportQuery): Promise<CsvExport> {
    const report = await this.report(token, query);
    const content = `\uFEFF${[report.headers, ...report.rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
    return {
      content,
      filename: `${report.title.toLocaleLowerCase('ru-RU').replaceAll(/[^а-яё0-9]+/giu, '-')}-${query.dateFrom.slice(0, 10)}-${query.dateTo.slice(0, 10)}.csv`,
    };
  }

  private async getExpense(token: string, id: string): Promise<ExpenseSummary> {
    const actor = await this.financeActor(token, 'expenses:read');
    const record = await this.requireExpense(id);
    assertBranchAccess(actor, record.branchId);
    return expenseSummary(record);
  }

  private async financeActor(
    token: string,
    permission: Parameters<typeof assertPermission>[1],
  ): Promise<AuthenticatedUser> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, permission);
    return actor;
  }

  private categoryData(input: ExpenseCategoryInput): Prisma.ExpenseCategoryUncheckedCreateInput {
    return {
      branchId: input.branchId ?? null,
      description: optionalText(input.description),
      isActive: input.isActive,
      name: input.name.trim(),
    };
  }

  private expenseData(input: ExpenseInput, actorId: string): Prisma.ExpenseUncheckedCreateInput {
    return {
      amount: input.amount,
      attachmentPath: optionalText(input.attachmentPath),
      branchId: input.branchId,
      categoryId: input.categoryId,
      createdByUserId: actorId,
      description: input.description.trim(),
      documentNumber: optionalText(input.documentNumber),
      paymentMethod: input.paymentMethod,
      spentAt: new Date(input.spentAt),
      vendor: optionalText(input.vendor),
    };
  }

  private payrollRuleData(input: PayrollRuleInput): Prisma.PayrollRuleUncheckedCreateInput {
    return {
      amountPerAttendee: input.amountPerAttendee ?? null,
      branchId: input.branchId,
      coachId: input.coachId,
      fixedAmount: input.fixedAmount ?? null,
      groupId: input.groupId ?? null,
      isActive: input.isActive,
      monthlyAmount: input.monthlyAmount ?? null,
      percent: input.percent ?? null,
      type: input.type,
      validFrom: dateOnly(input.validFrom),
      validTo: input.validTo ? endDate(input.validTo) : null,
    };
  }

  private assertTrainerPayoutRule(rule: TrainerPayoutProfileInput['rules'][number]): void {
    const fixed = rule.mode === 'FIXED_PER_ATTENDANCE' || rule.mode === 'FIXED_PER_LESSON';
    if (fixed && (!Number.isInteger(rule.amount) || (rule.amount ?? 0) < 0))
      throw new DomainError('VALIDATION', 'Укажите корректную сумму выплаты.');
    if (!fixed && rule.amount !== undefined)
      throw new DomainError('VALIDATION', 'Сумма допустима только для фиксированного правила.');
    if (
      rule.mode === 'PERCENTAGE' &&
      (rule.percentage === undefined ||
        rule.percentage <= 0 ||
        rule.percentage > 100 ||
        Math.round(rule.percentage * 100) !== rule.percentage * 100)
    )
      throw new DomainError('VALIDATION', 'Процент должен быть от 0,01 до 100.');
    if (rule.mode !== 'PERCENTAGE' && rule.percentage !== undefined)
      throw new DomainError('VALIDATION', 'Процент допустим только для процентного правила.');
  }

  private async assertExpenseCategory(categoryId: string, branchId: string): Promise<void> {
    const category = await this.requireCategory(categoryId);
    if (!category.isActive || category.archivedAt)
      throw new DomainError('VALIDATION', 'Категория расхода неактивна.');
    if (category.branchId && category.branchId !== branchId)
      throw new DomainError('VALIDATION', 'Категория относится к другому филиалу.');
  }

  private async assertPayrollRule(input: PayrollRuleInput, excludedId?: string): Promise<void> {
    if (
      ((input.type === 'FIXED_PER_LESSON' || input.type === 'COMBINED') &&
        input.fixedAmount === undefined) ||
      ((input.type === 'PER_ATTENDEE' || input.type === 'COMBINED') &&
        input.amountPerAttendee === undefined) ||
      (input.type === 'PERCENT_OF_REVENUE' && input.percent === undefined) ||
      (input.type === 'FIXED_MONTHLY' && input.monthlyAmount === undefined)
    )
      throw new DomainError('VALIDATION', 'Заполните обязательные параметры правила зарплаты.');
    for (const amount of [input.fixedAmount, input.amountPerAttendee, input.monthlyAmount])
      if (amount !== undefined && (!Number.isInteger(amount) || amount < 0))
        throw new DomainError('VALIDATION', 'Ставка не может быть отрицательной.');
    if (input.percent !== undefined && (input.percent <= 0 || input.percent > 100))
      throw new DomainError('VALIDATION', 'Процент должен быть больше нуля и не превышать 100.');
    const coach = await this.database.user.findUnique({
      include: { branchAssignments: true },
      where: { id: input.coachId },
    });
    if (
      coach?.role !== 'COACH' ||
      (!coach.branchAssignments.some(({ branchId }) => branchId === input.branchId) &&
        coach.branchAssignments.length)
    )
      throw new DomainError('VALIDATION', 'Выберите тренера, доступного в этом филиале.');
    if (input.groupId) {
      const group = await this.database.danceGroup.findUnique({ where: { id: input.groupId } });
      if (group?.branchId !== input.branchId)
        throw new DomainError('VALIDATION', 'Группа относится к другому филиалу.');
    }
    const from = dateOnly(input.validFrom),
      to = input.validTo ? endDate(input.validTo) : null;
    const overlap = await this.database.payrollRule.findFirst({
      where: {
        coachId: input.coachId,
        branchId: input.branchId,
        groupId: input.groupId ?? null,
        isActive: true,
        ...(excludedId ? { id: { not: excludedId } } : {}),
        validFrom: { lte: to ?? new Date('9999-12-31') },
        OR: [{ validTo: null }, { validTo: { gte: from } }],
      },
    });
    if (input.isActive && overlap)
      throw new DomainError(
        'CONFLICT',
        'На выбранный период уже действует правило для этого тренера и группы.',
      );
  }

  private calculateAccrual(
    rule: {
      type: string;
      fixedAmount: number | null;
      amountPerAttendee: number | null;
      percent: number | null;
    },
    attendees: number,
    revenue: number,
  ): number {
    if (rule.type === 'FIXED_PER_LESSON') return rule.fixedAmount ?? 0;
    if (rule.type === 'PER_ATTENDEE') return (rule.amountPerAttendee ?? 0) * attendees;
    if (rule.type === 'PERCENT_OF_REVENUE')
      return Math.round(revenue * ((rule.percent ?? 0) / 100));
    if (rule.type === 'COMBINED')
      return (rule.fixedAmount ?? 0) + (rule.amountPerAttendee ?? 0) * attendees;
    return 0;
  }

  private payoutModeToPayrollType(
    mode: 'FIXED_PER_ATTENDANCE' | 'FIXED_PER_LESSON' | 'NO_PAYOUT' | 'PERCENTAGE' | null,
  ): 'FIXED_PER_LESSON' | 'PER_ATTENDEE' | 'PERCENT_OF_REVENUE' {
    if (mode === 'FIXED_PER_ATTENDANCE') return 'PER_ATTENDEE';
    if (mode === 'PERCENTAGE') return 'PERCENT_OF_REVENUE';
    return 'FIXED_PER_LESSON';
  }

  private calculateTrainerPayout(
    mode: 'FIXED_PER_ATTENDANCE' | 'FIXED_PER_LESSON' | 'NO_PAYOUT' | 'PERCENTAGE' | null,
    amount: number,
    percentageBasisPoints: number,
    attendees: number,
    revenue: number,
  ): number {
    if (mode === 'FIXED_PER_ATTENDANCE') return amount * attendees;
    if (mode === 'FIXED_PER_LESSON') return amount;
    if (mode === 'PERCENTAGE') return Math.round((revenue * percentageBasisPoints) / 10_000);
    return 0;
  }

  private async pendingPayrollAttendance(
    period: PayrollPeriodRecord,
  ): Promise<PayrollPendingLessonSummary[]> {
    if (period.status === 'APPROVED' || period.status === 'PAID') return [];
    const [lessons, rules, payoutRules] = await Promise.all([
      this.database.lesson.findMany({
        include: {
          branch: { select: { name: true } },
          coach: { select: { fullName: true } },
          group: { select: { name: true } },
        },
        where: {
          ...(period.branchId ? { branchId: period.branchId } : {}),
          attendanceCompletedAt: null,
          coachId: { not: null },
          startsAt: { gte: period.dateFrom, lte: period.dateTo },
          status: 'COMPLETED',
        },
      }),
      this.database.payrollRule.findMany({
        where: {
          ...(period.branchId ? { branchId: period.branchId } : {}),
          isActive: true,
          validFrom: { lte: period.dateTo },
          OR: [{ validTo: null }, { validTo: { gte: period.dateFrom } }],
        },
      }),
      this.database.trainerPayoutRule.findMany({
        select: { trainerId: true },
        where: { effectiveFrom: { lte: period.dateTo } },
      }),
    ]);
    return lessons.flatMap((lesson) => {
      if (!lesson.coachId || !lesson.coach) return [];
      const hasPayoutProfile = payoutRules.some(({ trainerId }) => trainerId === lesson.coachId);
      const rule = rules
        .filter(
          (item) =>
            item.type !== 'FIXED_MONTHLY' &&
            item.coachId === lesson.coachId &&
            item.branchId === lesson.branchId &&
            (!item.groupId || item.groupId === lesson.groupId) &&
            item.validFrom <= lesson.startsAt &&
            (!item.validTo || item.validTo >= lesson.startsAt),
        )
        .sort((a, b) => Number(Boolean(b.groupId)) - Number(Boolean(a.groupId)))[0];
      if (!rule && !hasPayoutProfile) return [];
      return [
        {
          branchId: lesson.branchId,
          branchName: lesson.branch.name,
          coachId: lesson.coachId,
          coachName: lesson.coach.fullName,
          groupId: lesson.groupId,
          groupName: lesson.group.name,
          lessonId: lesson.id,
          startsAt: lesson.startsAt.toISOString(),
        },
      ];
    });
  }

  private async lessonRevenueBase(lessonId: string, studentIds?: string[]): Promise<number> {
    const [entries, directPayments] = await Promise.all([
      this.database.subscriptionLedger.findMany({
        include: { subscription: { include: { payments: { include: { refunds: true } } } } },
        where: {
          lessonId,
          type: 'LESSON_WRITE_OFF',
          reversals: { none: {} },
          ...(studentIds ? { studentId: { in: studentIds } } : {}),
        },
      }),
      this.database.payment.findMany({
        include: { refunds: true },
        where: {
          attendanceLessonId: lessonId,
          status: { not: 'CANCELLED' },
          ...(studentIds ? { studentId: { in: studentIds } } : {}),
        },
      }),
    ]);
    const subscriptionRevenue = entries.reduce((sum, entry) => {
      const paid = entry.subscription.payments
        .filter(({ status }) => status !== 'CANCELLED')
        .reduce(
          (paymentSum, payment) =>
            paymentSum +
            payment.amount -
            payment.refunds.reduce((refundSum, refund) => refundSum + refund.amount, 0),
          0,
        );
      const divisor = entry.subscription.lessonLimit ?? Math.max(1, entry.subscription.lessonsUsed);
      return sum + Math.floor(paid / divisor);
    }, 0);
    return (
      subscriptionRevenue +
      directPayments.reduce(
        (sum, payment) =>
          sum +
          payment.amount -
          payment.refunds.reduce((refundSum, refund) => refundSum + refund.amount, 0),
        0,
      )
    );
  }

  private async analyticsPeriod(
    actor: AuthenticatedUser,
    query: AnalyticsQuery,
    from: Date,
    to: Date,
  ) {
    const scope = this.branchScope(actor, query.branchId);
    const paymentScope = {
      ...scope,
      paidAt: { gte: from, lte: to },
      status: { not: 'CANCELLED' as const },
    };
    const [
      payments,
      refunds,
      expenses,
      payroll,
      activeStudents,
      newStudents,
      churnedStudents,
      attendance,
      groups,
      debtSubscriptions,
    ] = await Promise.all([
      this.database.payment.findMany({ where: paymentScope }),
      this.database.refund.findMany({
        where: { payment: scope, refundedAt: { gte: from, lte: to } },
      }),
      this.database.expense.aggregate({
        _sum: { amount: true },
        where: { ...scope, spentAt: { gte: from, lte: to }, status: 'CONFIRMED' },
      }),
      this.database.payrollAccrual.aggregate({
        _sum: { finalAmount: true },
        where: {
          ...scope,
          payrollPeriod: {
            dateFrom: { lte: to },
            dateTo: { gte: from },
            status: { in: ['CALCULATED', 'APPROVED', 'PAID'] },
          },
        },
      }),
      this.database.student.count({
        where: {
          ...scope,
          archivedAt: null,
          createdAt: { lte: to },
          status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] },
        },
      }),
      this.database.student.count({ where: { ...scope, createdAt: { gte: from, lte: to } } }),
      this.database.student.count({ where: { ...scope, archivedAt: { gte: from, lte: to } } }),
      this.database.attendance.findMany({
        where: {
          lesson: {
            ...scope,
            startsAt: { gte: from, lte: to },
            ...(query.coachId ? { coachId: query.coachId } : {}),
            ...(query.groupId ? { groupId: query.groupId } : {}),
          },
        },
      }),
      this.database.danceGroup.findMany({
        include: {
          _count: {
            select: {
              enrollments: {
                where: { leftAt: null, status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] } },
              },
            },
          },
        },
        where: {
          ...scope,
          archivedAt: null,
          ...(query.direction ? { direction: query.direction } : {}),
          ...(query.groupId ? { id: query.groupId } : {}),
          ...(query.coachId
            ? { OR: [{ coachId: query.coachId }, { assistantCoachId: query.coachId }] }
            : {}),
        },
      }),
      this.database.subscription.findMany({
        include: { payments: { include: { refunds: true } } },
        where: { ...scope, startsAt: { lte: to }, status: { not: 'CANCELLED' } },
      }),
    ]);
    const revenue =
      payments.reduce((sum, item) => sum + item.amount, 0) -
      refunds.reduce((sum, item) => sum + item.amount, 0);
    const expenseTotal = expenses._sum.amount ?? 0;
    const payrollTotal = payroll._sum.finalAmount ?? 0;
    const marked = attendance.length,
      attended = attendance.filter(({ status }) =>
        ['PRESENT', 'LATE', 'TRIAL'].includes(status),
      ).length;
    const outstandingDebt = debtSubscriptions.reduce((sum, item) => {
      const paid = item.payments
        .filter(({ status }) => status !== 'CANCELLED')
        .reduce(
          (paymentSum, payment) =>
            paymentSum +
            payment.amount -
            payment.refunds.reduce((refundSum, refund) => refundSum + refund.amount, 0),
          0,
        );
      return sum + Math.max(0, item.salePrice - paid);
    }, 0);
    return {
      activeStudents,
      attendancePercentage: marked ? Math.round((attended / marked) * 100) : 0,
      averagePayment: payments.length ? Math.round(revenue / payments.length) : 0,
      churnedStudents,
      coachWorkload: await this.database.lesson.count({
        where: {
          ...scope,
          startsAt: { gte: from, lte: to },
          status: 'COMPLETED',
          ...(query.coachId ? { coachId: query.coachId } : {}),
        },
      }),
      expenses: expenseTotal,
      groupOccupancy: groups.length
        ? Math.round(
            groups.reduce(
              (sum, group) =>
                sum + Math.min(100, (group._count.enrollments / group.capacity) * 100),
              0,
            ) / groups.length,
          )
        : 0,
      netProfit: revenue - expenseTotal - payrollTotal,
      newStudents,
      outstandingDebt,
      payrollAccrued: payrollTotal,
      profitBeforePayroll: revenue - expenseTotal,
      revenue,
    };
  }

  private async analyticsBreakdown(
    actor: AuthenticatedUser,
    query: AnalyticsQuery,
    from: Date,
    to: Date,
  ): Promise<AnalyticsBreakdownRow[]> {
    const scope = this.branchScope(actor, query.branchId);
    const branches = await this.database.branch.findMany({
      where: { ...(scope.branchId ? { id: scope.branchId } : {}) },
    });
    return Promise.all(
      branches.map(async (branch) => {
        const period = await this.analyticsPeriod(
          actor,
          { ...query, branchId: branch.id },
          from,
          to,
        );
        return {
          attendancePercentage: period.attendancePercentage,
          coachWorkload: period.coachWorkload,
          expenses: period.expenses,
          groupOccupancy: period.groupOccupancy,
          id: branch.id,
          label: branch.name,
          netProfit: period.netProfit,
          revenue: period.revenue,
        };
      }),
    );
  }

  private branchScope(
    actor: AuthenticatedUser,
    branchId?: string,
  ): { branchId?: string | { in: string[] } } {
    if (branchId) {
      assertBranchAccess(actor, branchId);
      return { branchId };
    }
    const ids = accessibleBranchIds(actor);
    return ids ? { branchId: { in: ids } } : {};
  }

  private async createCashTransaction(
    client: DbClient,
    input: {
      actorId: string;
      amount: number;
      branchId: string;
      cashRegisterId: string;
      comment?: string;
      occurredAt: Date;
      sourceId?: string;
      sourceType: 'PAYMENT' | 'REFUND' | 'EXPENSE' | 'PAYROLL' | 'MANUAL';
      type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'CORRECTION';
    },
  ) {
    return client.cashTransaction.create({
      data: {
        amount: input.amount,
        branchId: input.branchId,
        cashRegisterId: input.cashRegisterId,
        comment: input.comment ?? null,
        createdByUserId: input.actorId,
        occurredAt: input.occurredAt,
        sourceId: input.sourceId ?? null,
        sourceType: input.sourceType,
        type: input.type,
      },
    });
  }

  private async ensurePayrollCategory(client: DbClient) {
    const existing = await client.expenseCategory.findFirst({
      where: { branchId: null, name: 'Заработная плата' },
    });
    return (
      existing ??
      client.expenseCategory.create({ data: { isActive: true, name: 'Заработная плата' } })
    );
  }

  private async requireCategory(id: string) {
    const record = await this.database.expenseCategory.findUnique({ where: { id } });
    if (!record) throw new DomainError('NOT_FOUND', 'Категория расходов не найдена.');
    return record;
  }
  private async requireExpense(id: string) {
    const record = await this.database.expense.findUnique({
      include: expenseInclude,
      where: { id },
    });
    if (!record) throw new DomainError('NOT_FOUND', 'Расход не найден.');
    return record;
  }
  private async requireRegister(id: string) {
    const record = await this.database.cashRegister.findUnique({ where: { id } });
    if (!record) throw new DomainError('NOT_FOUND', 'Касса не найдена.');
    return record;
  }
  private async requirePayrollPeriod(id: string) {
    const record = await this.database.payrollPeriod.findUnique({
      include: payrollPeriodInclude,
      where: { id },
    });
    if (!record) throw new DomainError('NOT_FOUND', 'Расчётный период не найден.');
    return record;
  }

  private async audit(
    client: DbClient,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    detail?: unknown,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        action,
        actorUserId,
        detail: detail === undefined ? null : JSON.stringify(detail),
        entityId,
        entityType,
      },
    });
  }

  private assertPositiveAmount(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0)
      throw new DomainError('VALIDATION', 'Сумма должна быть больше нуля.');
  }
}
