import {
  ATTENDANCE_SCENARIO_STATUSES,
  type AttendanceScenarioPayrollEffect,
  type AttendanceScenarioReconciliationApplyInput,
  type AttendanceScenarioReconciliationFilters,
  type AttendanceScenarioReconciliationPreview,
  type AttendanceScenarioReconciliationResult,
  type AttendanceScenarioReconciliationRow,
  type AttendanceScenarioRule,
  type AttendanceScenarioStatus,
  type AttendanceStatus,
} from '@arava/shared';
import type { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

import {
  attendanceDeductsSubscription,
  attendanceIncludedInTrainerPayroll,
  readAttendanceScenarioSettings,
  type AttendanceScenarioSettings,
} from './attendance-scenarios';
import type { DatabaseClient } from './index';
import { assertCapability } from './permissions';
import { endOfLocalDay, startOfLocalDay } from './schedule';
import { DomainError } from './security';
import type { ApplicationService } from './services';
import {
  applyAttendanceWriteOff,
  inspectAttendanceWriteOff,
  reverseAttendanceWriteOffs,
} from './subscription-ledger';

type ReconciliationClient = DatabaseClient | Prisma.TransactionClient;

interface PlannedDeduction {
  attendanceId: string;
  attendanceStatus: AttendanceStatus;
  branchId: string;
  lessonId: string;
  lessonStartsAt: Date;
  studentId: string;
}

interface ReconciliationPlan {
  actionableAttendanceIds: string[];
  deductions: PlannedDeduction[];
  payrollPeriodIds: string[];
  preview: AttendanceScenarioReconciliationPreview;
  restorations: string[];
}

function scenarioStatus(status: string): AttendanceScenarioStatus | undefined {
  const normalized = status === 'EXCUSED' ? 'ILL' : status;
  return ATTENDANCE_SCENARIO_STATUSES.includes(normalized as AttendanceScenarioStatus)
    ? (normalized as AttendanceScenarioStatus)
    : undefined;
}

function cloneSettings(settings: AttendanceScenarioSettings): AttendanceScenarioSettings {
  return Object.fromEntries(
    ATTENDANCE_SCENARIO_STATUSES.map((status) => [status, { ...settings[status] }]),
  ) as AttendanceScenarioSettings;
}

function auditRule(detail: string | null): AttendanceScenarioRule | undefined {
  if (!detail) return undefined;
  try {
    const value = (JSON.parse(detail) as { old?: Partial<AttendanceScenarioRule> }).old;
    if (
      typeof value?.deductSubscription === 'boolean' &&
      typeof value.includeInTrainerPayroll === 'boolean'
    )
      return {
        deductSubscription: value.deductSubscription,
        includeInTrainerPayroll: value.includeInTrainerPayroll,
      };
  } catch {
    return undefined;
  }
  return undefined;
}

function appendReason(current: string | undefined, next: string): string {
  return current ? `${current} ${next}` : next;
}

export class AttendanceScenarioReconciliationService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async preview(
    token: string,
    filters: AttendanceScenarioReconciliationFilters,
  ): Promise<AttendanceScenarioReconciliationPreview> {
    const actor = await this.application.authenticate(token);
    assertCapability(actor, 'canManageSystemSettings');
    if (actor.role !== 'OWNER')
      throw new DomainError('AUTHORIZATION', 'Пересчёт прошлых занятий доступен только владельцу.');
    return (await this.buildPlan(this.database, filters)).preview;
  }

  async apply(
    token: string,
    input: AttendanceScenarioReconciliationApplyInput,
  ): Promise<AttendanceScenarioReconciliationResult> {
    const actor = await this.application.authenticate(token);
    assertCapability(actor, 'canManageSystemSettings');
    if (actor.role !== 'OWNER')
      throw new DomainError('AUTHORIZATION', 'Пересчёт прошлых занятий доступен только владельцу.');
    return this.database.$transaction(async (transaction) => {
      const plan = await this.buildPlan(transaction, input.filters);
      if (plan.preview.fingerprint !== input.previewFingerprint)
        throw new DomainError(
          'CONFLICT',
          'Данные изменились после предпросмотра. Сформируйте предпросмотр заново.',
        );
      if (plan.preview.totals.actionableRows === 0)
        throw new DomainError('VALIDATION', 'Нет изменений, которые можно безопасно применить.');

      let restoredVisits = 0;
      for (const attendanceId of plan.restorations) {
        restoredVisits += await reverseAttendanceWriteOffs(
          transaction,
          attendanceId,
          actor.id,
          'Применение текущего сценария к прошлому занятию',
        );
      }

      let deductedVisits = 0;
      const scenarios = await readAttendanceScenarioSettings(transaction);
      for (const deduction of plan.deductions) {
        const subscriptionId = await applyAttendanceWriteOff(transaction, {
          actorUserId: actor.id,
          attendanceStatus: deduction.attendanceStatus,
          branchId: deduction.branchId,
          lessonId: deduction.lessonId,
          lessonStartsAt: deduction.lessonStartsAt,
          scenarioSettings: scenarios,
          studentId: deduction.studentId,
        });
        if (!subscriptionId)
          throw new DomainError(
            'CONFLICT',
            'Покрытие посещения изменилось после предпросмотра. Повторите проверку.',
          );
        deductedVisits += 1;
      }

      let payrollPeriodsInvalidated = 0;
      for (const periodId of plan.payrollPeriodIds) {
        await transaction.payrollAccrual.deleteMany({ where: { payrollPeriodId: periodId } });
        const updated = await transaction.payrollPeriod.updateMany({
          data: { status: 'DRAFT' },
          where: { id: periodId, status: 'CALCULATED' },
        });
        if (updated.count !== 1)
          throw new DomainError(
            'CONFLICT',
            'Статус расчёта зарплаты изменился. Сформируйте предпросмотр заново.',
          );
        payrollPeriodsInvalidated += 1;
        await transaction.auditLog.create({
          data: {
            action: 'PAYROLL_INVALIDATED_BY_ATTENDANCE_SCENARIO_RECONCILIATION',
            actorUserId: actor.id,
            detail: JSON.stringify({ filters: input.filters }),
            entityId: periodId,
            entityType: 'PayrollPeriod',
          },
        });
      }

      const batchId = randomUUID();
      await transaction.auditLog.create({
        data: {
          action: 'ATTENDANCE_SCENARIO_RECONCILIATION_APPLIED',
          actorUserId: actor.id,
          detail: JSON.stringify({
            affectedLessonsCount: plan.preview.affectedLessonsCount,
            affectedStudentsCount: plan.preview.affectedStudentsCount,
            deductedVisits,
            filters: input.filters,
            payrollPeriodsInvalidated,
            protectedRowsSkipped: plan.preview.totals.skippedProtectedRows,
            restoredVisits,
            scenarioConfigSnapshot: plan.preview.scenarioSnapshot,
          }),
          entityId: batchId,
          entityType: 'AttendanceScenarioReconciliation',
        },
      });
      return {
        batchId,
        deductedVisits,
        payrollPeriodsInvalidated,
        processedAttendanceCount: plan.actionableAttendanceIds.length,
        protectedRowsSkipped: plan.preview.totals.skippedProtectedRows,
        restoredVisits,
      };
    });
  }

  private async buildPlan(
    client: ReconciliationClient,
    filters: AttendanceScenarioReconciliationFilters,
  ): Promise<ReconciliationPlan> {
    const dateFrom = startOfLocalDay(filters.dateFrom);
    const dateTo = endOfLocalDay(filters.dateTo);
    const storedStatus = filters.status === 'ILL' ? 'EXCUSED' : filters.status;
    const [scenarios, attendances, periods, scenarioAudits] = await Promise.all([
      readAttendanceScenarioSettings(client),
      client.attendance.findMany({
        include: {
          lesson: { include: { group: true, substitution: true } },
          student: true,
        },
        orderBy: [{ lesson: { startsAt: 'asc' } }, { student: { lastName: 'asc' } }],
        where: {
          status: storedStatus
            ? (storedStatus as AttendanceStatus)
            : { in: ['PRESENT', 'ABSENT', 'EXCUSED', 'LATE'] },
          lesson: {
            ...(filters.branchId ? { branchId: filters.branchId } : {}),
            ...(filters.groupId ? { groupId: filters.groupId } : {}),
            startsAt: { gte: dateFrom, lte: dateTo },
            status: { not: 'CANCELLED' },
          },
        },
      }),
      client.payrollPeriod.findMany({
        include: { accruals: { select: { lessonId: true } } },
        where: {
          dateFrom: { lte: dateTo },
          dateTo: { gte: dateFrom },
          status: { in: ['DRAFT', 'CALCULATED', 'APPROVED', 'PAID'] },
        },
      }),
      client.auditLog.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { action: 'ATTENDANCE_SCENARIO_UPDATED', entityType: 'AttendanceScenario' },
      }),
    ]);
    const attendanceIds = attendances.map(({ lessonId, studentId }) => `${lessonId}:${studentId}`);
    const [writeOffs, calculationAudits] = await Promise.all([
      attendanceIds.length
        ? client.subscriptionLedger.findMany({
            include: {
              reversals: { select: { id: true } },
              subscription: { select: { lessonLimit: true, lessonsUsed: true } },
            },
            where: { attendanceId: { in: attendanceIds }, type: 'LESSON_WRITE_OFF' },
          })
        : [],
      periods.length
        ? client.auditLog.findMany({
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            where: {
              action: 'PAYROLL_CALCULATED',
              entityId: { in: periods.map(({ id }) => id) },
              entityType: 'PayrollPeriod',
            },
          })
        : [],
    ]);

    const activeByAttendance = new Map<string, typeof writeOffs>();
    for (const writeOff of writeOffs) {
      if (!writeOff.attendanceId || writeOff.reversals.length > 0) continue;
      const list = activeByAttendance.get(writeOff.attendanceId) ?? [];
      list.push(writeOff);
      activeByAttendance.set(writeOff.attendanceId, list);
    }
    const projectedUsage = new Map<string, number>();
    const restorations: string[] = [];
    const subscriptionDecision = new Map<
      string,
      { action?: 'DEDUCT' | 'RESTORE'; nextDeducted: boolean; reason?: string }
    >();
    for (const attendance of attendances) {
      const attendanceId = `${attendance.lessonId}:${attendance.studentId}`;
      const active = activeByAttendance.get(attendanceId) ?? [];
      const shouldDeduct = attendanceDeductsSubscription(scenarios, attendance.status);
      if (active.length > 1) {
        subscriptionDecision.set(attendanceId, {
          nextDeducted: shouldDeduct,
          reason: 'Найдено несколько активных списаний. Требуется ручная проверка.',
        });
      } else if (!shouldDeduct && active.length === 1) {
        restorations.push(attendanceId);
        const writeOff = active[0];
        if (writeOff) {
          const current =
            projectedUsage.get(writeOff.subscriptionId) ?? writeOff.subscription.lessonsUsed;
          projectedUsage.set(writeOff.subscriptionId, Math.max(0, current - writeOff.lessonDelta));
        }
        subscriptionDecision.set(attendanceId, { action: 'RESTORE', nextDeducted: false });
      } else {
        subscriptionDecision.set(attendanceId, { nextDeducted: active.length === 1 });
      }
    }

    const deductions: PlannedDeduction[] = [];
    for (const attendance of attendances) {
      const attendanceId = `${attendance.lessonId}:${attendance.studentId}`;
      const active = activeByAttendance.get(attendanceId) ?? [];
      if (active.length > 0 || !attendanceDeductsSubscription(scenarios, attendance.status))
        continue;
      const inspection = await inspectAttendanceWriteOff(
        client,
        {
          actorUserId: attendance.markedByUserId,
          attendanceStatus: attendance.status,
          branchId: attendance.lesson.branchId,
          lessonId: attendance.lessonId,
          lessonStartsAt: attendance.lesson.startsAt,
          scenarioSettings: scenarios,
          studentId: attendance.studentId,
        },
        projectedUsage,
      );
      if (inspection.outcome === 'READY' && inspection.subscriptionId) {
        deductions.push({
          attendanceId,
          attendanceStatus: attendance.status,
          branchId: attendance.lesson.branchId,
          lessonId: attendance.lessonId,
          lessonStartsAt: attendance.lesson.startsAt,
          studentId: attendance.studentId,
        });
        projectedUsage.set(inspection.subscriptionId, (inspection.lessonsUsed ?? 0) + 1);
        subscriptionDecision.set(attendanceId, { action: 'DEDUCT', nextDeducted: true });
      } else if (inspection.outcome === 'BLOCKED') {
        subscriptionDecision.set(attendanceId, {
          nextDeducted: true,
          ...(inspection.reason ? { reason: inspection.reason } : {}),
        });
      } else {
        subscriptionDecision.set(attendanceId, { nextDeducted: false });
      }
    }

    const calculationAuditByPeriod = new Map<string, (typeof calculationAudits)[number]>();
    for (const audit of calculationAudits)
      if (!calculationAuditByPeriod.has(audit.entityId))
        calculationAuditByPeriod.set(audit.entityId, audit);
    const settingsAt = (date: Date) => {
      const snapshot = cloneSettings(scenarios);
      for (const audit of scenarioAudits) {
        if (audit.createdAt <= date) continue;
        const status = scenarioStatus(audit.entityId);
        const old = auditRule(audit.detail);
        if (status && old) snapshot[status] = old;
      }
      return snapshot;
    };

    const rows: AttendanceScenarioReconciliationRow[] = [];
    const payrollPeriodIds = new Set<string>();
    const actionableAttendanceIds = new Set<string>();
    let payrollRowsToInclude = 0;
    let payrollRowsToExclude = 0;
    let skippedProtectedRows = 0;
    for (const attendance of attendances) {
      const attendanceId = `${attendance.lessonId}:${attendance.studentId}`;
      const active = activeByAttendance.get(attendanceId) ?? [];
      const decision = subscriptionDecision.get(attendanceId) ?? {
        nextDeducted: active.length === 1,
      };
      const status = scenarioStatus(attendance.status);
      if (!status) continue;
      const actualTrainerId =
        attendance.lesson.substitution?.substituteTrainerId ?? attendance.lesson.coachId;
      const applicablePeriods = periods.filter(
        (period) =>
          attendance.lesson.startsAt >= period.dateFrom &&
          attendance.lesson.startsAt <= period.dateTo &&
          (!period.branchId || period.branchId === attendance.lesson.branchId) &&
          (!period.trainerId || period.trainerId === actualTrainerId),
      );
      const snapshots = applicablePeriods
        .filter(({ status: periodStatus }) => periodStatus !== 'DRAFT')
        .map((period) => {
          const calculatedAt =
            calculationAuditByPeriod.get(period.id)?.createdAt ?? period.updatedAt;
          const historicalSettings = settingsAt(calculatedAt);
          const included =
            attendanceIncludedInTrainerPayroll(historicalSettings, attendance.status) &&
            period.accruals.some(({ lessonId }) => lessonId === attendance.lessonId);
          return { included, period };
        });
      const newPayrollIncluded = attendanceIncludedInTrainerPayroll(scenarios, attendance.status);
      const mutableMismatches = snapshots.filter(
        ({ included, period }) => period.status === 'CALCULATED' && included !== newPayrollIncluded,
      );
      const protectedMismatches = snapshots.filter(
        ({ included, period }) =>
          (period.status === 'APPROVED' || period.status === 'PAID') &&
          included !== newPayrollIncluded,
      );
      for (const { period } of mutableMismatches) payrollPeriodIds.add(period.id);
      const payrollChanged = mutableMismatches.length > 0 || protectedMismatches.length > 0;
      const subscriptionChanged = Boolean(decision.action);
      if (!subscriptionChanged && !decision.reason && !payrollChanged) continue;
      if (subscriptionChanged || mutableMismatches.length > 0)
        actionableAttendanceIds.add(attendanceId);
      if (payrollChanged) {
        if (newPayrollIncluded) payrollRowsToInclude += 1;
        else payrollRowsToExclude += 1;
      }
      let skipReason = decision.reason;
      if (protectedMismatches.length > 0) {
        skippedProtectedRows += 1;
        skipReason = appendReason(
          skipReason,
          'Расчёт APPROVED/PAID защищён и останется без изменений.',
        );
      }
      const currentPayrollEffect: AttendanceScenarioPayrollEffect =
        snapshots.length === 0
          ? 'NOT_CALCULATED'
          : snapshots.some(({ included }) => included)
            ? 'INCLUDED'
            : 'EXCLUDED';
      rows.push({
        attendanceId,
        currentPayrollEffect,
        currentSubscriptionEffect: active.length > 0 ? 'DEDUCTED' : 'NOT_DEDUCTED',
        date: attendance.lesson.startsAt.toISOString(),
        groupId: attendance.lesson.groupId,
        groupName: attendance.lesson.group.name,
        lessonId: attendance.lessonId,
        newPayrollEffect: newPayrollIncluded ? 'INCLUDED' : 'EXCLUDED',
        newSubscriptionEffect: decision.nextDeducted ? 'DEDUCTED' : 'NOT_DEDUCTED',
        payrollProtected: protectedMismatches.length > 0,
        skipReason,
        status,
        studentId: attendance.studentId,
        studentName: [
          attendance.student.lastName,
          attendance.student.firstName,
          attendance.student.middleName,
        ]
          .filter(Boolean)
          .join(' '),
      });
    }

    const scenarioSnapshot = cloneSettings(scenarios);
    const normalizedFilters = { ...filters };
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          deductions: deductions.map(({ attendanceId }) => attendanceId),
          filters: normalizedFilters,
          payrollPeriodIds: [...payrollPeriodIds].sort(),
          restorations: [...restorations].sort(),
          rows,
          scenarioSnapshot,
        }),
      )
      .digest('hex');
    const preview: AttendanceScenarioReconciliationPreview = {
      affectedLessonsCount: new Set(rows.map(({ lessonId }) => lessonId)).size,
      affectedStudentsCount: new Set(rows.map(({ studentId }) => studentId)).size,
      filters: normalizedFilters,
      fingerprint,
      rows,
      scenarioSnapshot,
      totals: {
        actionableRows: actionableAttendanceIds.size,
        payrollPeriodsToRecalculate: payrollPeriodIds.size,
        payrollRowsToExclude,
        payrollRowsToInclude,
        skippedProtectedRows,
        visitsToDeduct: deductions.length,
        visitsToRestore: restorations.length,
      },
    };
    return {
      actionableAttendanceIds: [...actionableAttendanceIds],
      deductions,
      payrollPeriodIds: [...payrollPeriodIds],
      preview,
      restorations,
    };
  }
}
