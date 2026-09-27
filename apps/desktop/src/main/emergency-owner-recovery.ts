import {
  createDatabaseClient,
  hashPassword,
  toSqliteUrl,
  type DatabaseClient,
} from '@arava/database';
import { passwordSchema } from '@arava/shared';
import type { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type Reader = DatabaseClient | Prisma.TransactionClient;

interface ControlState {
  failed: number;
  tables: Record<string, number>;
}

export interface EmergencyOwnerPreview {
  ticket: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  backupPath: string;
  checkedAt: string;
  failed: number;
  outbox: number;
  expiresAt: string;
}

export interface EmergencyOwnerResult {
  ownerId: string;
  recoveryCode: string;
  failedBefore: number;
  failedAfter: number;
}

interface PreparedRecovery {
  preview: EmergencyOwnerPreview;
  controls: ControlState;
  authorizedAt?: number;
}

const SUCCESS_ACTION = 'OWNER_EMERGENCY_RECOVERY_SUCCEEDED';
const TICKET_LIFETIME_MS = 10 * 60 * 1000;
const AUTHORIZATION_LIFETIME_MS = 3 * 60 * 1000;

function quoteSqlite(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function integrityCheck(database: Reader): Promise<void> {
  const rows =
    await database.$queryRawUnsafe<{ integrity_check: string }[]>('PRAGMA integrity_check');
  if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
    throw new Error('Проверка целостности SQLite не пройдена. Сброс запрещён.');
  }
}

async function controls(database: Reader): Promise<ControlState> {
  const tables = await database.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const safeName = name.replaceAll('"', '""');
    const rows = await database.$queryRawUnsafe<{ count: bigint | number }[]>(
      `SELECT COUNT(*) AS count FROM "${safeName}"`,
    );
    counts[name] = Number(rows[0]?.count ?? -1);
  }
  return {
    failed: await database.syncOutbox.count({ where: { status: 'FAILED' } }),
    tables: counts,
  };
}

function assertSame(before: ControlState, after: ControlState, excludeAuth = false): void {
  if (before.failed !== after.failed) {
    throw new Error('Количество FAILED изменилось. Сброс остановлен.');
  }
  const ignored = excludeAuth ? new Set(['AuditLog', 'Session']) : new Set<string>();
  for (const [name, count] of Object.entries(before.tables)) {
    if (ignored.has(name)) continue;
    if (after.tables[name] !== count) {
      throw new Error(`Контрольное количество ${name} изменилось. Сброс остановлен.`);
    }
  }
}

export class EmergencyOwnerRecovery {
  private prepared: PreparedRecovery | undefined;
  private preparing = false;

  constructor(
    private readonly database: DatabaseClient,
    private readonly databasePath: string,
    private readonly enabled: boolean,
    private readonly authorizeAdministrator: () => Promise<boolean>,
    private readonly verifyIntegrity: (database: Reader) => Promise<void> = integrityCheck,
  ) {}

  async available(): Promise<boolean> {
    if (!this.enabled) return false;
    return (await this.database.auditLog.count({ where: { action: SUCCESS_ACTION } })) === 0;
  }

  private async requireAvailable(): Promise<void> {
    if (!(await this.available())) {
      throw new Error('Аварийное восстановление недоступно или уже использовано.');
    }
  }

  private async singleOwner() {
    const owners = await this.database.user.findMany({
      select: { email: true, fullName: true, id: true, isActive: true },
      where: { role: 'OWNER' },
    });
    if (owners.length !== 1 || !owners[0]?.isActive) {
      throw new Error('Нужен ровно один существующий активный OWNER. Сброс запрещён.');
    }
    return owners[0];
  }

  async prepare(): Promise<EmergencyOwnerPreview> {
    await this.requireAvailable();
    if (this.preparing || this.prepared) {
      throw new Error(
        'Подготовка уже выполнена. Используйте показанную копию или перезапустите CRM.',
      );
    }
    this.preparing = true;
    try {
      const owner = await this.singleOwner();
      await this.verifyIntegrity(this.database);
      const before = await controls(this.database);
      const backupDirectory = join(dirname(this.databasePath), 'backups');
      await mkdir(backupDirectory, { recursive: true });
      const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, '-');
      const backupPath = join(
        backupDirectory,
        `ARAVA-CRM-emergency-owner-${timestamp}-${randomUUID()}.db`,
      );
      await this.database.$executeRawUnsafe(`VACUUM INTO ${quoteSqlite(backupPath)}`);
      if ((await stat(backupPath)).size < 100) throw new Error('Резервная копия пуста.');
      const backup = createDatabaseClient(toSqliteUrl(backupPath));
      try {
        await backup.$connect();
        await this.verifyIntegrity(backup);
        assertSame(before, await controls(backup));
      } finally {
        await backup.$disconnect();
      }
      assertSame(before, await controls(this.database));
      const checkedAt = new Date();
      const preview: EmergencyOwnerPreview = {
        backupPath,
        checkedAt: checkedAt.toISOString(),
        expiresAt: new Date(checkedAt.getTime() + TICKET_LIFETIME_MS).toISOString(),
        failed: before.failed,
        outbox: before.tables.SyncOutbox ?? 0,
        ownerEmail: owner.email,
        ownerId: owner.id,
        ownerName: owner.fullName,
        ticket: randomUUID(),
      };
      this.prepared = { controls: before, preview };
      return preview;
    } finally {
      this.preparing = false;
    }
  }

  private ticket(value: string): PreparedRecovery {
    const prepared = this.prepared;
    if (prepared?.preview.ticket !== value) {
      throw new Error('Подготовка устарела. Аварийный сброс запрещён.');
    }
    if (Date.now() > Date.parse(prepared.preview.expiresAt)) {
      throw new Error('Подготовка устарела. Аварийный сброс запрещён.');
    }
    return prepared;
  }

  async authorize(ticket: string): Promise<void> {
    await this.requireAvailable();
    const prepared = this.ticket(ticket);
    if (!(await this.authorizeAdministrator())) {
      throw new Error('Администратор Windows не подтвердил восстановление.');
    }
    prepared.authorizedAt = Date.now();
  }

  async reset(
    ticket: string,
    newPassword: string,
    confirmation: string,
  ): Promise<EmergencyOwnerResult> {
    await this.requireAvailable();
    const prepared = this.ticket(ticket);
    if (
      !prepared.authorizedAt ||
      Date.now() - prepared.authorizedAt > AUTHORIZATION_LIFETIME_MS ||
      confirmation !== 'ВОССТАНОВИТЬ ВЛАДЕЛЬЦА'
    ) {
      throw new Error('Требуется новое подтверждение администратора Windows и явное согласие.');
    }
    passwordSchema.parse(newPassword);
    const owner = await this.singleOwner();
    if (owner.id !== prepared.preview.ownerId) throw new Error('OWNER изменился. Сброс запрещён.');
    await this.verifyIntegrity(this.database);
    assertSame(prepared.controls, await controls(this.database));
    const recoveryCode = randomBytes(24).toString('base64url').toUpperCase();
    const [passwordHash, recoveryCodeHash] = await Promise.all([
      hashPassword(newPassword),
      hashPassword(recoveryCode),
    ]);
    await this.database.$transaction(async (transaction) => {
      const existing = await transaction.user.findMany({
        select: { id: true, isActive: true },
        where: { role: 'OWNER' },
      });
      if (existing.length !== 1 || existing[0]?.id !== owner.id || !existing[0].isActive) {
        throw new Error('OWNER изменился во время восстановления.');
      }
      const before = await controls(transaction);
      assertSame(prepared.controls, before);
      await transaction.user.update({
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          passwordHash,
          recoveryCodeCreatedAt: new Date(),
          recoveryCodeHash,
          recoveryFailedAttempts: 0,
          recoveryLockedUntil: null,
          securityVersion: { increment: 1 },
        },
        where: { id: owner.id },
      });
      await transaction.session.deleteMany({ where: { userId: owner.id } });
      await transaction.auditLog.create({
        data: {
          action: SUCCESS_ACTION,
          actorUserId: owner.id,
          detail: JSON.stringify({
            backupPath: prepared.preview.backupPath,
            method: 'LOCAL_WINDOWS_ADMIN_UAC',
          }),
          entityId: owner.id,
          entityType: 'User',
        },
      });
      assertSame(before, await controls(transaction), true);
    });
    this.prepared = undefined;
    return {
      failedAfter: prepared.controls.failed,
      failedBefore: prepared.controls.failed,
      ownerId: owner.id,
      recoveryCode,
    };
  }
}
