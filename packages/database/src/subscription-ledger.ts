import { t, type AttendanceStatus } from '@arava/shared';
import type { Prisma, SubscriptionStatus } from '@prisma/client';

import type { DatabaseClient } from './index';
import { DomainError } from './security';

type LedgerClient = DatabaseClient | Prisma.TransactionClient;

const DAY_MS = 86_400_000;

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

export function subscriptionStatusAt(
  subscription: {
    expiresAt: Date | null;
    lessonLimit: number | null;
    lessonsUsed: number;
    startsAt: Date;
    status: SubscriptionStatus;
  },
  now = new Date(),
): SubscriptionStatus {
  if (subscription.status === 'CANCELLED' || subscription.status === 'FROZEN')
    return subscription.status;
  if (subscription.startsAt > now) return 'PENDING';
  if (subscription.expiresAt && subscription.expiresAt < now) return 'EXPIRED';
  if (subscription.lessonLimit !== null && subscription.lessonsUsed >= subscription.lessonLimit)
    return 'USED_UP';
  return 'ACTIVE';
}

async function audit(
  client: LedgerClient,
  actorUserId: string,
  action: string,
  entityId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await client.auditLog.create({
    data: {
      action,
      actorUserId,
      detail: JSON.stringify(detail),
      entityId,
      entityType: 'SubscriptionLedger',
    },
  });
}

async function restoreSubscriptionAfterReversal(
  client: LedgerClient,
  subscriptionId: string,
  lessonDelta: number,
): Promise<void> {
  const current = await client.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const lessonsUsed = Math.max(0, current.lessonsUsed - lessonDelta);
  await client.subscription.update({
    data: {
      lessonsUsed,
      status: subscriptionStatusAt({ ...current, lessonsUsed }),
    },
    where: { id: subscriptionId },
  });
}

export async function reverseAttendanceWriteOffs(
  client: LedgerClient,
  attendanceId: string,
  actorUserId: string,
  comment: string,
): Promise<number> {
  const writeOffs = await client.subscriptionLedger.findMany({
    include: { reversals: { select: { id: true } } },
    where: { attendanceId, type: 'LESSON_WRITE_OFF' },
  });
  let reversed = 0;
  for (const writeOff of writeOffs) {
    if (writeOff.reversals.length) continue;
    await restoreSubscriptionAfterReversal(client, writeOff.subscriptionId, writeOff.lessonDelta);
    const reversal = await client.subscriptionLedger.create({
      data: {
        attendanceId,
        comment,
        createdByUserId: actorUserId,
        lessonDelta: -writeOff.lessonDelta,
        lessonId: writeOff.lessonId,
        reversesLedgerId: writeOff.id,
        studentId: writeOff.studentId,
        subscriptionId: writeOff.subscriptionId,
        type: 'REVERSAL',
      },
    });
    await audit(client, actorUserId, 'SUBSCRIPTION_WRITE_OFF_REVERSED', reversal.id, {
      attendanceId,
      subscriptionId: writeOff.subscriptionId,
      writeOffId: writeOff.id,
    });
    reversed += 1;
  }
  return reversed;
}

export async function applyAttendanceWriteOff(
  client: LedgerClient,
  input: {
    actorUserId: string;
    attendanceStatus: AttendanceStatus;
    branchId: string;
    lessonId: string;
    lessonStartsAt: Date;
    studentId: string;
  },
): Promise<string | null> {
  const consumesPaid = input.attendanceStatus === 'PRESENT' || input.attendanceStatus === 'LATE';
  const consumesTrial = input.attendanceStatus === 'TRIAL';
  if (!consumesPaid && !consumesTrial) return null;

  const attendanceId = `${input.lessonId}:${input.studentId}`;
  const existing = await client.subscriptionLedger.findFirst({
    include: { reversals: { select: { id: true } } },
    where: { attendanceId, type: 'LESSON_WRITE_OFF' },
  });
  if (existing?.reversals.length === 0)
    throw new DomainError('CONFLICT', t('domain.conflict.writeOffDuplicate'));

  const candidates = await client.subscription.findMany({
    include: { tariff: true },
    orderBy: [
      { expiresAt: { nulls: 'last', sort: 'asc' } },
      { startsAt: 'asc' },
      { createdAt: 'asc' },
    ],
    where: {
      branchId: input.branchId,
      OR: [{ expiresAt: null }, { expiresAt: { gte: input.lessonStartsAt } }],
      startsAt: { lte: input.lessonStartsAt },
      status: { notIn: ['CANCELLED', 'FROZEN'] },
      studentId: input.studentId,
      tariff: consumesTrial
        ? { type: 'TRIAL' }
        : { type: { in: ['LESSON_PACK', 'SINGLE_LESSON', 'UNLIMITED'] } },
    },
  });
  const subscription = candidates.find(
    (candidate) => candidate.lessonLimit === null || candidate.lessonsUsed < candidate.lessonLimit,
  );
  if (!subscription) return null;

  const lessonsUsed = subscription.lessonsUsed + 1;
  const status =
    subscription.lessonLimit !== null && lessonsUsed >= subscription.lessonLimit
      ? 'USED_UP'
      : subscription.status === 'PENDING'
        ? 'ACTIVE'
        : subscription.status;
  await client.subscription.update({
    data: { lessonsUsed, status },
    where: { id: subscription.id },
  });
  const ledger = await client.subscriptionLedger.create({
    data: {
      attendanceId,
      comment: t('ledger.comment.attendanceWriteOff'),
      createdByUserId: input.actorUserId,
      lessonDelta: 1,
      lessonId: input.lessonId,
      studentId: input.studentId,
      subscriptionId: subscription.id,
      type: 'LESSON_WRITE_OFF',
    },
  });
  await audit(client, input.actorUserId, 'SUBSCRIPTION_LESSON_WRITTEN_OFF', ledger.id, {
    attendanceId,
    lessonId: input.lessonId,
    studentId: input.studentId,
    subscriptionId: subscription.id,
  });
  return subscription.id;
}

export async function reverseLessonWriteOffs(
  client: LedgerClient,
  lessonId: string,
  actorUserId: string,
): Promise<number> {
  const entries = await client.subscriptionLedger.findMany({
    select: { attendanceId: true },
    where: { lessonId, type: 'LESSON_WRITE_OFF' },
  });
  const attendanceIds = [
    ...new Set(entries.flatMap(({ attendanceId }) => (attendanceId ? [attendanceId] : []))),
  ];
  let total = 0;
  for (const attendanceId of attendanceIds) {
    total += await reverseAttendanceWriteOffs(
      client,
      attendanceId,
      actorUserId,
      t('ledger.comment.lessonCancelled'),
    );
  }
  return total;
}
