import {
  ATTENDANCE_SCENARIO_STATUSES,
  type AttendanceScenarioRule,
  type AttendanceScenarioStatus,
  type AttendanceScenarioSummary,
  type AttendanceScenarioUpdate,
} from '@arava/shared';
import type { Prisma } from '@prisma/client';

import type { DatabaseClient } from './index';
import { assertCapability } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';

type ScenarioClient = DatabaseClient | Prisma.TransactionClient;
export type AttendanceScenarioSettings = Record<AttendanceScenarioStatus, AttendanceScenarioRule>;

export const ATTENDANCE_SCENARIO_DEFAULTS: AttendanceScenarioSettings = {
  ABSENT: { deductSubscription: true, includeInTrainerPayroll: false },
  ILL: { deductSubscription: false, includeInTrainerPayroll: false },
  LATE: { deductSubscription: true, includeInTrainerPayroll: true },
  PRESENT: { deductSubscription: true, includeInTrainerPayroll: true },
};

export function attendanceScenarioSettingKey(status: AttendanceScenarioStatus): string {
  return `attendance.scenario.${status}`;
}

function parseRule(value: string | undefined, fallback: AttendanceScenarioRule) {
  if (!value) return { ...fallback };
  try {
    const parsed = JSON.parse(value) as Partial<AttendanceScenarioRule>;
    return {
      deductSubscription:
        typeof parsed.deductSubscription === 'boolean'
          ? parsed.deductSubscription
          : fallback.deductSubscription,
      includeInTrainerPayroll:
        typeof parsed.includeInTrainerPayroll === 'boolean'
          ? parsed.includeInTrainerPayroll
          : fallback.includeInTrainerPayroll,
    };
  } catch {
    return { ...fallback };
  }
}

export async function readAttendanceScenarioSettings(
  client: ScenarioClient,
): Promise<AttendanceScenarioSettings> {
  const rows = await client.appSetting.findMany({
    where: { key: { in: ATTENDANCE_SCENARIO_STATUSES.map(attendanceScenarioSettingKey) } },
  });
  const values = new Map(rows.map(({ key, value }) => [key, value]));
  return Object.fromEntries(
    ATTENDANCE_SCENARIO_STATUSES.map((status) => [
      status,
      parseRule(
        values.get(attendanceScenarioSettingKey(status)),
        ATTENDANCE_SCENARIO_DEFAULTS[status],
      ),
    ]),
  ) as AttendanceScenarioSettings;
}

export function attendanceScenarioForStatus(
  settings: AttendanceScenarioSettings,
  status: string,
): AttendanceScenarioRule {
  if (status === 'TRIAL') return { deductSubscription: true, includeInTrainerPayroll: true };
  const scenarioStatus = status === 'EXCUSED' ? 'ILL' : status;
  if (ATTENDANCE_SCENARIO_STATUSES.includes(scenarioStatus as AttendanceScenarioStatus))
    return settings[scenarioStatus as AttendanceScenarioStatus];
  return { deductSubscription: false, includeInTrainerPayroll: false };
}

export function attendanceDeductsSubscription(
  settings: AttendanceScenarioSettings,
  status: string,
): boolean {
  return attendanceScenarioForStatus(settings, status).deductSubscription;
}

export function attendanceIncludedInTrainerPayroll(
  settings: AttendanceScenarioSettings,
  status: string,
): boolean {
  return attendanceScenarioForStatus(settings, status).includeInTrainerPayroll;
}

export class AttendanceScenarioService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async list(token: string): Promise<AttendanceScenarioSummary[]> {
    const actor = await this.application.authenticate(token);
    if (actor.role === 'COACH')
      throw new DomainError('AUTHORIZATION', 'Настройки посещаемости недоступны тренеру.');
    const settings = await readAttendanceScenarioSettings(this.database);
    return ATTENDANCE_SCENARIO_STATUSES.map((status) => ({ status, ...settings[status] }));
  }

  async update(
    token: string,
    status: AttendanceScenarioStatus,
    input: AttendanceScenarioUpdate,
  ): Promise<AttendanceScenarioSummary> {
    const actor = await this.application.authenticate(token);
    assertCapability(actor, 'canManageSystemSettings');
    return this.database.$transaction(async (transaction) => {
      const oldSettings = await readAttendanceScenarioSettings(transaction);
      const next = {
        deductSubscription: input.deductSubscription,
        includeInTrainerPayroll: input.includeInTrainerPayroll,
      };
      await transaction.appSetting.upsert({
        create: { key: attendanceScenarioSettingKey(status), value: JSON.stringify(next) },
        update: { value: JSON.stringify(next) },
        where: { key: attendanceScenarioSettingKey(status) },
      });
      await transaction.auditLog.create({
        data: {
          action: 'ATTENDANCE_SCENARIO_UPDATED',
          actorUserId: actor.id,
          detail: JSON.stringify({ new: next, old: oldSettings[status] }),
          entityId: status,
          entityType: 'AttendanceScenario',
        },
      });
      return { status, ...next };
    });
  }
}
