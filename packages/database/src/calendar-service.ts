import type {
  AffectedCalendarEvent,
  CalendarExceptionInput,
  CalendarExceptionSummary,
  CalendarRangeQuery,
  CopyDayInput,
  CopyDayResult,
  RoomAvailabilityInterval,
  RoomClosureInput,
  RoomClosurePreview,
  RoomClosureSummary,
  RoomInput,
  RoomRentalInput,
  RoomRentalSummary,
  RoomSummary,
  RoomUtilization,
  TrainerSubstitutionInput,
  TrainerSubstitutionSummary,
} from '@arava/shared';
import type { Prisma } from '@prisma/client';

import type { DatabaseClient } from './index';
import { accessibleBranchIds, assertBranchAccess, assertPermission } from './permissions';
import { DomainError, normalizePhone } from './security';
import type { ApplicationService } from './services';

const optional = (value?: string): string | null => {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : null;
};
const overlap = (startAt: Date, endAt: Date) => ({
  endsAt: { gt: startAt },
  startsAt: { lt: endAt },
});

const roomInclude = { branch: { select: { name: true } } } satisfies Prisma.RoomInclude;
const rentalInclude = {
  branch: { select: { name: true } },
  room: { select: { name: true } },
} satisfies Prisma.RoomRentalInclude;
const closureInclude = {
  room: { select: { branchId: true, name: true } },
} satisfies Prisma.RoomClosureInclude;
const exceptionInclude = {
  branch: { select: { name: true } },
} satisfies Prisma.CalendarExceptionInclude;

type RoomRecord = Prisma.RoomGetPayload<{ include: typeof roomInclude }>;
type RentalRecord = Prisma.RoomRentalGetPayload<{ include: typeof rentalInclude }>;
type ClosureRecord = Prisma.RoomClosureGetPayload<{ include: typeof closureInclude }>;
type ExceptionRecord = Prisma.CalendarExceptionGetPayload<{ include: typeof exceptionInclude }>;

function roomSummary(room: RoomRecord): RoomSummary {
  return {
    areaSquareMeters: room.areaSquareMeters ?? undefined,
    archivedAt: room.archivedAt?.toISOString(),
    branchId: room.branchId,
    branchName: room.branch.name,
    capacity: room.capacity ?? undefined,
    colorKey: room.colorKey ?? undefined,
    createdAt: room.createdAt.toISOString(),
    description: room.description ?? undefined,
    floor: room.floor ?? undefined,
    id: room.id,
    isActive: room.isActive,
    name: room.name,
    sortOrder: room.sortOrder,
    updatedAt: room.updatedAt.toISOString(),
  };
}

function rentalSummary(rental: RentalRecord): RoomRentalSummary {
  return {
    amount: rental.amount ?? undefined,
    branchId: rental.branchId,
    branchName: rental.branch.name,
    clientName: rental.clientName ?? undefined,
    comment: rental.comment ?? undefined,
    createdAt: rental.createdAt.toISOString(),
    endAt: rental.endAt.toISOString(),
    id: rental.id,
    phone: rental.phone ?? undefined,
    roomId: rental.roomId,
    roomName: rental.room.name,
    startAt: rental.startAt.toISOString(),
    status: rental.status,
    updatedAt: rental.updatedAt.toISOString(),
  };
}

function closureSummary(closure: ClosureRecord): RoomClosureSummary {
  return {
    branchId: closure.room.branchId,
    comment: closure.comment ?? undefined,
    createdAt: closure.createdAt.toISOString(),
    endAt: closure.endAt.toISOString(),
    id: closure.id,
    reason: closure.reason,
    roomId: closure.roomId,
    roomName: closure.room.name,
    startAt: closure.startAt.toISOString(),
  };
}

function exceptionSummary(exception: ExceptionRecord): CalendarExceptionSummary {
  return {
    branchId: exception.branchId ?? undefined,
    branchName: exception.branch?.name,
    comment: exception.comment ?? undefined,
    createdAt: exception.createdAt.toISOString(),
    endAt: exception.endAt.toISOString(),
    id: exception.id,
    startAt: exception.startAt.toISOString(),
    title: exception.title,
    type: exception.type,
    updatedAt: exception.updatedAt.toISOString(),
  };
}

export class CalendarService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async listRooms(
    token: string,
    branchId?: string,
    includeArchived = false,
  ): Promise<RoomSummary[]> {
    const actor = await this.application.authenticate(token);
    if (branchId) assertBranchAccess(actor, branchId);
    const branchIds = accessibleBranchIds(actor);
    const rooms = await this.database.room.findMany({
      include: roomInclude,
      orderBy: [{ branch: { name: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      where: {
        ...(branchId ? { branchId } : branchIds ? { branchId: { in: branchIds } } : {}),
        ...(includeArchived ? {} : { archivedAt: null, isActive: true }),
      },
    });
    return rooms.map(roomSummary);
  }

  async createRoom(token: string, input: RoomInput): Promise<RoomSummary> {
    const actor = await this.manager(token, input.branchId);
    const room = await this.database.room.create({
      data: this.roomData(input),
      include: roomInclude,
    });
    await this.audit(actor.id, 'ROOM_CREATED', 'Room', room.id);
    return roomSummary(room);
  }

  async updateRoom(token: string, id: string, input: RoomInput): Promise<RoomSummary> {
    const current = await this.requireRoom(id);
    const actor = await this.manager(token, current.branchId);
    assertBranchAccess(actor, input.branchId);
    if (current.branchId !== input.branchId && (await this.roomHasHistory(id)))
      throw new DomainError('VALIDATION', 'Нельзя перенести зал с историей в другой филиал.');
    const room = await this.database.room.update({
      data: this.roomData(input),
      include: roomInclude,
      where: { id },
    });
    await this.audit(actor.id, 'ROOM_UPDATED', 'Room', id);
    return roomSummary(room);
  }

  async archiveRoom(token: string, id: string): Promise<RoomSummary> {
    const current = await this.requireRoom(id);
    const actor = await this.manager(token, current.branchId);
    const room = await this.database.room.update({
      data: { archivedAt: new Date(), isActive: false },
      include: roomInclude,
      where: { id },
    });
    await this.audit(actor.id, 'ROOM_ARCHIVED', 'Room', id);
    return roomSummary(room);
  }

  async listRentals(token: string, query: CalendarRangeQuery): Promise<RoomRentalSummary[]> {
    const actor = await this.application.authenticate(token);
    if (actor.role === 'COACH')
      throw new DomainError('AUTHORIZATION', 'Доступ к арендам запрещён.');
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const branchIds = accessibleBranchIds(actor);
    const rentals = await this.database.roomRental.findMany({
      include: rentalInclude,
      orderBy: { startAt: 'asc' },
      where: {
        ...(query.branchId
          ? { branchId: query.branchId }
          : branchIds
            ? { branchId: { in: branchIds } }
            : {}),
        ...(query.roomId ? { roomId: query.roomId } : {}),
        endAt: { gt: new Date(query.dateFrom) },
        startAt: { lt: new Date(query.dateTo) },
      },
    });
    return rentals.map(rentalSummary);
  }

  async createRental(token: string, input: RoomRentalInput): Promise<RoomRentalSummary> {
    const actor = await this.manager(token, input.branchId);
    await this.validateRoomBranch(input.roomId, input.branchId);
    await this.assertRoomAvailable(input.roomId, new Date(input.startAt), new Date(input.endAt));
    const rental = await this.database.roomRental.create({
      data: this.rentalData(input, actor.id),
      include: rentalInclude,
    });
    await this.audit(actor.id, 'ROOM_RENTAL_CREATED', 'RoomRental', rental.id);
    return rentalSummary(rental);
  }

  async updateRental(
    token: string,
    id: string,
    input: RoomRentalInput,
  ): Promise<RoomRentalSummary> {
    const current = await this.database.roomRental.findUnique({ where: { id } });
    if (!current) throw new DomainError('NOT_FOUND', 'Аренда не найдена.');
    const actor = await this.manager(token, current.branchId);
    assertBranchAccess(actor, input.branchId);
    await this.validateRoomBranch(input.roomId, input.branchId);
    await this.assertRoomAvailable(input.roomId, new Date(input.startAt), new Date(input.endAt), {
      rentalId: id,
    });
    const rental = await this.database.roomRental.update({
      data: this.rentalData(input, current.createdByUserId),
      include: rentalInclude,
      where: { id },
    });
    await this.audit(actor.id, 'ROOM_RENTAL_UPDATED', 'RoomRental', id);
    return rentalSummary(rental);
  }

  async cancelRental(token: string, id: string): Promise<RoomRentalSummary> {
    const current = await this.database.roomRental.findUnique({ where: { id } });
    if (!current) throw new DomainError('NOT_FOUND', 'Аренда не найдена.');
    const actor = await this.manager(token, current.branchId);
    const rental = await this.database.roomRental.update({
      data: { status: 'CANCELLED' },
      include: rentalInclude,
      where: { id },
    });
    await this.audit(actor.id, 'ROOM_RENTAL_CANCELLED', 'RoomRental', id);
    return rentalSummary(rental);
  }

  async previewClosure(token: string, input: RoomClosureInput): Promise<RoomClosurePreview> {
    const room = await this.requireRoom(input.roomId);
    await this.manager(token, room.branchId);
    return { affected: await this.affectedEvents(input), roomName: room.name };
  }

  async createClosure(token: string, input: RoomClosureInput): Promise<RoomClosureSummary> {
    const room = await this.requireRoom(input.roomId);
    const actor = await this.manager(token, room.branchId);
    const affected = await this.affectedEvents(input);
    const closure = await this.database.roomClosure.create({
      data: {
        ...input,
        comment: optional(input.comment),
        createdByUserId: actor.id,
        endAt: new Date(input.endAt),
        startAt: new Date(input.startAt),
      },
      include: closureInclude,
    });
    await this.audit(actor.id, 'ROOM_CLOSURE_CREATED', 'RoomClosure', closure.id, {
      affected: affected.length,
    });
    return closureSummary(closure);
  }

  async listClosures(token: string, query: CalendarRangeQuery): Promise<RoomClosureSummary[]> {
    const actor = await this.application.authenticate(token);
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const branchIds = accessibleBranchIds(actor);
    const rows = await this.database.roomClosure.findMany({
      include: closureInclude,
      orderBy: { startAt: 'asc' },
      where: {
        ...(query.roomId ? { roomId: query.roomId } : {}),
        room: query.branchId
          ? { branchId: query.branchId }
          : branchIds
            ? { branchId: { in: branchIds } }
            : {},
        endAt: { gt: new Date(query.dateFrom) },
        startAt: { lt: new Date(query.dateTo) },
      },
    });
    return rows.map(closureSummary);
  }

  async createException(
    token: string,
    input: CalendarExceptionInput,
  ): Promise<CalendarExceptionSummary> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'schedules:manage');
    if (input.branchId) assertBranchAccess(actor, input.branchId);
    const row = await this.database.calendarException.create({
      data: {
        ...input,
        branchId: input.branchId ?? null,
        comment: optional(input.comment),
        endAt: new Date(input.endAt),
        startAt: new Date(input.startAt),
        title: input.title.trim(),
      },
      include: exceptionInclude,
    });
    await this.audit(actor.id, 'CALENDAR_EXCEPTION_CREATED', 'CalendarException', row.id);
    return exceptionSummary(row);
  }

  async listExceptions(
    token: string,
    query: CalendarRangeQuery,
  ): Promise<CalendarExceptionSummary[]> {
    const actor = await this.application.authenticate(token);
    if (query.branchId) assertBranchAccess(actor, query.branchId);
    const branchIds = accessibleBranchIds(actor);
    const rows = await this.database.calendarException.findMany({
      include: exceptionInclude,
      orderBy: { startAt: 'asc' },
      where: {
        ...(query.branchId
          ? { OR: [{ branchId: null }, { branchId: query.branchId }] }
          : branchIds
            ? { OR: [{ branchId: null }, { branchId: { in: branchIds } }] }
            : {}),
        endAt: { gt: new Date(query.dateFrom) },
        startAt: { lt: new Date(query.dateTo) },
      },
    });
    return rows.map(exceptionSummary);
  }

  async availability(
    token: string,
    roomId: string,
    date: string,
  ): Promise<RoomAvailabilityInterval[]> {
    const room = await this.requireRoom(roomId);
    const actor = await this.application.authenticate(token);
    assertBranchAccess(actor, room.branchId);
    const start = new Date(`${date}T08:00:00`);
    const end = new Date(`${date}T23:00:00`);
    const [lessons, rentals, closures] = await Promise.all([
      this.database.lesson.findMany({
        where: { roomId, status: { not: 'CANCELLED' }, ...overlap(start, end) },
      }),
      this.database.roomRental.findMany({
        where: { roomId, status: 'ACTIVE', endAt: { gt: start }, startAt: { lt: end } },
      }),
      this.database.roomClosure.findMany({
        where: { roomId, endAt: { gt: start }, startAt: { lt: end } },
      }),
    ]);
    const occupied: RoomAvailabilityInterval[] = [
      ...lessons.map((item) => ({
        endAt: item.endsAt.toISOString(),
        kind: 'LESSON' as const,
        startAt: item.startsAt.toISOString(),
        title: 'Занятие',
      })),
      ...rentals.map((item) => ({
        endAt: item.endAt.toISOString(),
        kind: 'RENTAL' as const,
        startAt: item.startAt.toISOString(),
        title: 'Аренда зала',
      })),
      ...closures.map((item) => ({
        endAt: item.endAt.toISOString(),
        kind: 'CLOSURE' as const,
        startAt: item.startAt.toISOString(),
        title: item.reason,
      })),
    ].sort((a, b) => a.startAt.localeCompare(b.startAt));
    const result: RoomAvailabilityInterval[] = [];
    let cursor = start;
    for (const event of occupied) {
      const eventStart = new Date(event.startAt);
      const eventEnd = new Date(event.endAt);
      if (eventStart > cursor)
        result.push({
          endAt: eventStart.toISOString(),
          kind: 'FREE',
          startAt: cursor.toISOString(),
          title: 'Свободно',
        });
      result.push(event);
      if (eventEnd > cursor) cursor = eventEnd;
    }
    if (cursor < end)
      result.push({
        endAt: end.toISOString(),
        kind: 'FREE',
        startAt: cursor.toISOString(),
        title: 'Свободно',
      });
    return result;
  }

  async utilization(
    token: string,
    roomId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<RoomUtilization> {
    const room = await this.requireRoom(roomId);
    const actor = await this.application.authenticate(token);
    assertBranchAccess(actor, room.branchId);
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    const [lessons, rentals] = await Promise.all([
      this.database.lesson.findMany({
        where: { roomId, status: { not: 'CANCELLED' }, ...overlap(start, end) },
      }),
      this.database.roomRental.findMany({
        where: { roomId, status: 'ACTIVE', endAt: { gt: start }, startAt: { lt: end } },
      }),
    ]);
    const hours = (items: { startsAt?: Date; startAt?: Date; endsAt?: Date; endAt?: Date }[]) =>
      items.reduce((sum, item) => {
        const startAt = item.startsAt ?? item.startAt;
        const endAt = item.endsAt ?? item.endAt;
        return startAt && endAt ? sum + (endAt.getTime() - startAt.getTime()) / 3_600_000 : sum;
      }, 0);
    const lessonHours = hours(lessons);
    const rentalHours = hours(rentals);
    return {
      lessonHours,
      lessons: lessons.length,
      rentalHours,
      rentals: rentals.length,
      totalOccupiedHours: lessonHours + rentalHours,
    };
  }

  async assignSubstitution(
    token: string,
    lessonId: string,
    input: TrainerSubstitutionInput,
  ): Promise<TrainerSubstitutionSummary> {
    const lesson = await this.database.lesson.findUnique({
      include: { coach: true },
      where: { id: lessonId },
    });
    if (!lesson) throw new DomainError('NOT_FOUND', 'Занятие не найдено.');
    const actor = await this.manager(token, lesson.branchId);
    const substitute = await this.database.user.findFirst({
      where: {
        id: input.substituteTrainerId,
        isActive: true,
        role: 'COACH',
        branchAssignments: { some: { branchId: lesson.branchId } },
      },
    });
    if (!substitute)
      throw new DomainError('VALIDATION', 'Заменяющий тренер недоступен в этом филиале.');
    const conflict = await this.database.lesson.findFirst({
      where: {
        id: { not: lessonId },
        status: { not: 'CANCELLED' },
        coachId: substitute.id,
        ...overlap(lesson.startsAt, lesson.endsAt),
      },
    });
    if (conflict) throw new DomainError('CONFLICT', 'Тренер уже занят в это время.');
    const row = await this.database.$transaction(async (transaction) => {
      const substitution = await transaction.trainerSubstitution.upsert({
        create: {
          createdByUserId: actor.id,
          lessonId,
          originalTrainerId: lesson.coachId,
          reason: optional(input.reason),
          substituteTrainerId: substitute.id,
        },
        update: { reason: optional(input.reason), substituteTrainerId: substitute.id },
        where: { lessonId },
      });
      await transaction.lesson.update({
        data: { coachId: substitute.id },
        where: { id: lessonId },
      });
      await transaction.auditLog.create({
        data: {
          action: 'TRAINER_SUBSTITUTED',
          actorUserId: actor.id,
          entityId: substitution.id,
          entityType: 'TrainerSubstitution',
        },
      });
      return substitution;
    });
    return {
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      lessonId,
      originalTrainerId: row.originalTrainerId ?? undefined,
      originalTrainerName: lesson.coach?.fullName,
      reason: row.reason ?? undefined,
      substituteTrainerId: substitute.id,
      substituteTrainerName: substitute.fullName,
    };
  }

  async copyDay(token: string, input: CopyDayInput): Promise<CopyDayResult> {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'lessons:manage');
    const sourceStart = new Date(`${input.sourceDate}T00:00:00`);
    const sourceEnd = new Date(`${input.sourceDate}T23:59:59.999`);
    const targetStart = new Date(`${input.targetDate}T00:00:00`);
    const branchIds = accessibleBranchIds(actor);
    const lessons = await this.database.lesson.findMany({
      where: {
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        startsAt: { gte: sourceStart, lte: sourceEnd },
        status: { not: 'CANCELLED' },
      },
    });
    let copied = 0;
    const errors: string[] = [];
    for (const lesson of lessons) {
      assertBranchAccess(actor, lesson.branchId);
      const startsAt = new Date(targetStart);
      startsAt.setHours(lesson.startsAt.getHours(), lesson.startsAt.getMinutes());
      const endsAt = new Date(
        startsAt.getTime() + (lesson.endsAt.getTime() - lesson.startsAt.getTime()),
      );
      try {
        await this.assertEventAvailable({
          coachId: lesson.coachId,
          endAt: endsAt,
          groupId: lesson.groupId,
          roomId: lesson.roomId,
          startAt: startsAt,
        });
        await this.database.lesson.create({
          data: {
            branchId: lesson.branchId,
            coachId: lesson.coachId,
            endsAt,
            groupId: lesson.groupId,
            notes: lesson.notes,
            room: lesson.room,
            roomId: lesson.roomId,
            startsAt,
          },
        });
        copied += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Конфликт расписания');
      }
    }
    await this.audit(actor.id, 'LESSON_DAY_COPIED', 'Lesson', input.targetDate, {
      conflicts: errors.length,
      copied,
    });
    return { conflicts: errors.length, copied, errors };
  }

  async assertEventAvailable(input: {
    coachId?: string | null;
    endAt: Date;
    excludeLessonId?: string;
    groupId: string;
    roomId?: string | null;
    startAt: Date;
  }): Promise<void> {
    const conditions: Prisma.LessonWhereInput[] = [{ groupId: input.groupId }];
    if (input.coachId) conditions.push({ coachId: input.coachId });
    if (input.roomId) conditions.push({ roomId: input.roomId });
    const conflict = await this.database.lesson.findFirst({
      where: {
        ...(input.excludeLessonId ? { id: { not: input.excludeLessonId } } : {}),
        status: { not: 'CANCELLED' },
        ...overlap(input.startAt, input.endAt),
        OR: conditions,
      },
    });
    if (conflict?.groupId === input.groupId)
      throw new DomainError('CONFLICT', 'У группы уже есть занятие в это время.');
    if (input.coachId && conflict?.coachId === input.coachId)
      throw new DomainError('CONFLICT', 'Тренер уже занят в это время.');
    if (input.roomId && conflict?.roomId === input.roomId)
      throw new DomainError('CONFLICT', 'Зал уже занят другим занятием в это время.');
    if (input.roomId)
      await this.assertRoomAvailable(input.roomId, input.startAt, input.endAt, {
        ...(input.excludeLessonId ? { lessonId: input.excludeLessonId } : {}),
      });
  }

  private async assertRoomAvailable(
    roomId: string,
    startAt: Date,
    endAt: Date,
    exclude: { lessonId?: string; rentalId?: string } = {},
  ): Promise<void> {
    const [lesson, rental, closure] = await Promise.all([
      this.database.lesson.findFirst({
        where: {
          ...(exclude.lessonId ? { id: { not: exclude.lessonId } } : {}),
          roomId,
          status: { not: 'CANCELLED' },
          ...overlap(startAt, endAt),
        },
        include: { group: { select: { name: true } }, roomEntity: { select: { name: true } } },
      }),
      this.database.roomRental.findFirst({
        where: {
          ...(exclude.rentalId ? { id: { not: exclude.rentalId } } : {}),
          roomId,
          status: 'ACTIVE',
          endAt: { gt: startAt },
          startAt: { lt: endAt },
        },
      }),
      this.database.roomClosure.findFirst({
        where: { roomId, endAt: { gt: startAt }, startAt: { lt: endAt } },
      }),
    ]);
    if (lesson)
      throw new DomainError(
        'CONFLICT',
        `Зал «${lesson.roomEntity?.name ?? 'без названия'}» уже занят группой «${lesson.group.name}».`,
      );
    if (rental) throw new DomainError('CONFLICT', 'В это время зал занят арендой.');
    if (closure) throw new DomainError('CONFLICT', `Зал временно закрыт: ${closure.reason}.`);
  }

  private async affectedEvents(input: RoomClosureInput): Promise<AffectedCalendarEvent[]> {
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    const [lessons, rentals] = await Promise.all([
      this.database.lesson.findMany({
        include: { group: { select: { name: true } } },
        where: { roomId: input.roomId, status: { not: 'CANCELLED' }, ...overlap(startAt, endAt) },
      }),
      this.database.roomRental.findMany({
        where: {
          roomId: input.roomId,
          status: 'ACTIVE',
          endAt: { gt: startAt },
          startAt: { lt: endAt },
        },
      }),
    ]);
    return [
      ...lessons.map((item) => ({
        endAt: item.endsAt.toISOString(),
        id: item.id,
        startAt: item.startsAt.toISOString(),
        title: item.group.name,
        type: 'LESSON' as const,
      })),
      ...rentals.map((item) => ({
        endAt: item.endAt.toISOString(),
        id: item.id,
        startAt: item.startAt.toISOString(),
        title: item.clientName ?? 'Аренда зала',
        type: 'RENTAL' as const,
      })),
    ];
  }

  private roomData(input: RoomInput): Prisma.RoomUncheckedCreateInput {
    return {
      ...input,
      areaSquareMeters: input.areaSquareMeters ?? null,
      capacity: input.capacity ?? null,
      colorKey: optional(input.colorKey),
      description: optional(input.description),
      floor: optional(input.floor),
      name: input.name.trim(),
    };
  }
  private rentalData(
    input: RoomRentalInput,
    createdByUserId: string,
  ): Prisma.RoomRentalUncheckedCreateInput {
    return {
      amount: input.amount ?? null,
      branchId: input.branchId,
      clientName: optional(input.clientName),
      comment: optional(input.comment),
      createdByUserId,
      endAt: new Date(input.endAt),
      phone: input.phone ? normalizePhone(input.phone) : null,
      roomId: input.roomId,
      startAt: new Date(input.startAt),
    };
  }
  private async requireRoom(id: string): Promise<RoomRecord> {
    const room = await this.database.room.findUnique({ include: roomInclude, where: { id } });
    if (!room) throw new DomainError('NOT_FOUND', 'Зал не найден.');
    return room;
  }
  private async validateRoomBranch(roomId: string, branchId: string): Promise<void> {
    const room = await this.requireRoom(roomId);
    if (room.branchId !== branchId)
      throw new DomainError('VALIDATION', 'Зал относится к другому филиалу.');
    if (!room.isActive || room.archivedAt)
      throw new DomainError('VALIDATION', 'Зал закрыт или архивирован.');
  }
  private async roomHasHistory(id: string): Promise<boolean> {
    const [lessons, schedules, rentals, closures] = await Promise.all([
      this.database.lesson.count({ where: { roomId: id } }),
      this.database.weeklySchedule.count({ where: { roomId: id } }),
      this.database.roomRental.count({ where: { roomId: id } }),
      this.database.roomClosure.count({ where: { roomId: id } }),
    ]);
    return lessons + schedules + rentals + closures > 0;
  }
  private async manager(token: string, branchId: string) {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, 'schedules:manage');
    assertBranchAccess(actor, branchId);
    return actor;
  }
  private async audit(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.database.auditLog.create({
      data: {
        action,
        actorUserId,
        detail: detail ? JSON.stringify(detail) : null,
        entityId,
        entityType,
      },
    });
  }
}
