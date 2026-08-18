import type { GlobalSearchResult } from '@arava/shared';

import type { DatabaseClient } from './index';
import { accessibleBranchIds } from './permissions';
import type { ApplicationService } from './services';

const LIMIT_PER_TYPE = 5;
const ACTIVE_ENROLLMENTS = ['ACTIVE', 'TRIAL', 'FROZEN'] as const;

function searchVariants(query: string): string[] {
  const trimmed = query.trim();
  const lower = trimmed.toLocaleLowerCase('ru-RU');
  const words = lower.split(/\s+/u);
  const title = words
    .map((word) => `${word.slice(0, 1).toLocaleUpperCase('ru-RU')}${word.slice(1)}`)
    .join(' ');
  return [...new Set([trimmed, lower, trimmed.toLocaleUpperCase('ru-RU'), title])];
}

export class GlobalSearchService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  async search(token: string, unsafeQuery: string): Promise<GlobalSearchResult[]> {
    const actor = await this.application.authenticate(token);
    const query = unsafeQuery.trim();
    if (query.length < 2) return [];
    const variants = searchVariants(query);
    const nameParts = query.split(/\s+/u).slice(0, 4);
    const branchIds = accessibleBranchIds(actor);
    const branchWhere = branchIds ? { id: { in: branchIds } } : {};
    const branchEntityWhere = branchIds ? { branchId: { in: branchIds } } : {};
    const ownGroupWhere =
      actor.role === 'COACH' ? { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] } : {};
    const studentAccess =
      actor.role === 'COACH'
        ? {
            enrollments: {
              some: {
                group: { OR: [{ coachId: actor.id }, { assistantCoachId: actor.id }] },
                status: { in: [...ACTIVE_ENROLLMENTS] },
              },
            },
          }
        : branchEntityWhere;

    const [students, groups, trainers, branches, rooms, cards] = await Promise.all([
      this.database.student.findMany({
        include: { branch: { select: { name: true } } },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: LIMIT_PER_TYPE,
        where: {
          ...studentAccess,
          OR: [
            ...variants.flatMap((value) => [
              { firstName: { contains: value } },
              { lastName: { contains: value } },
              { middleName: { contains: value } },
              { phone: { contains: value } },
              { email: { contains: value } },
              { contacts: { some: { archivedAt: null, fullName: { contains: value } } } },
              { contacts: { some: { archivedAt: null, phone: { contains: value } } } },
              { contacts: { some: { archivedAt: null, secondaryPhone: { contains: value } } } },
              { membershipCards: { some: { barcode: { contains: value } } } },
            ]),
            ...(nameParts.length > 1
              ? [
                  {
                    AND: nameParts.map((part) => ({
                      OR: searchVariants(part).flatMap((value) => [
                        { firstName: { contains: value } },
                        { lastName: { contains: value } },
                        { middleName: { contains: value } },
                      ]),
                    })),
                  },
                ]
              : []),
          ],
        },
      }),
      this.database.danceGroup.findMany({
        include: {
          branch: { select: { name: true } },
          coach: { select: { fullName: true } },
        },
        orderBy: { name: 'asc' },
        take: LIMIT_PER_TYPE,
        where: {
          ...branchEntityWhere,
          ...ownGroupWhere,
          OR: variants.flatMap((value) => [
            { name: { contains: value } },
            { direction: { contains: value } },
            { coach: { fullName: { contains: value } } },
            { branch: { name: { contains: value } } },
          ]),
        },
      }),
      this.database.user.findMany({
        include: { branchAssignments: { include: { branch: { select: { name: true } } } } },
        orderBy: { fullName: 'asc' },
        take: LIMIT_PER_TYPE,
        where: {
          isActive: true,
          role: 'COACH',
          ...(actor.role === 'COACH'
            ? { id: actor.id }
            : branchIds
              ? { branchAssignments: { some: { branchId: { in: branchIds } } } }
              : {}),
          OR: variants.flatMap((value) => [
            { fullName: { contains: value } },
            { email: { contains: value } },
            { phone: { contains: value } },
          ]),
        },
      }),
      this.database.branch.findMany({
        orderBy: { name: 'asc' },
        take: LIMIT_PER_TYPE,
        where: {
          ...branchWhere,
          archivedAt: null,
          OR: variants.flatMap((value) => [
            { name: { contains: value } },
            { address: { contains: value } },
          ]),
        },
      }),
      this.database.room.findMany({
        include: { branch: { select: { name: true } } },
        orderBy: [{ branch: { name: 'asc' } }, { name: 'asc' }],
        take: LIMIT_PER_TYPE,
        where: {
          ...branchEntityWhere,
          archivedAt: null,
          OR: variants.flatMap((value) => [
            { name: { contains: value } },
            { branch: { name: { contains: value } } },
          ]),
        },
      }),
      this.database.membershipCard.findMany({
        include: {
          student: { include: { branch: { select: { name: true } } } },
        },
        orderBy: { barcode: 'asc' },
        take: LIMIT_PER_TYPE,
        where: {
          ...(actor.role === 'COACH'
            ? { student: studentAccess }
            : branchIds
              ? { OR: [{ student: { branchId: { in: branchIds } } }] }
              : {}),
          OR: variants.map((value) => ({ barcode: { contains: value } })),
        },
      }),
    ]);

    return [
      ...students.map((student): GlobalSearchResult => ({
        id: student.id,
        metadata: { branchId: student.branchId },
        route: `/students/${student.id}`,
        subtitle: [student.phone, student.branch.name].filter(Boolean).join(' · '),
        title: [student.lastName, student.firstName, student.middleName].filter(Boolean).join(' '),
        type: 'STUDENT',
      })),
      ...groups.map((group): GlobalSearchResult => ({
        id: group.id,
        metadata: { branchId: group.branchId },
        route: `/groups/${group.id}`,
        subtitle: [group.direction, group.coach?.fullName, group.branch.name]
          .filter(Boolean)
          .join(' · '),
        title: group.name,
        type: 'GROUP',
      })),
      ...trainers.map((trainer): GlobalSearchResult => ({
        id: trainer.id,
        route: `/trainers/${trainer.id}`,
        subtitle: [
          trainer.email,
          trainer.branchAssignments.map(({ branch }) => branch.name).join(', '),
        ]
          .filter(Boolean)
          .join(' · '),
        title: trainer.fullName,
        type: 'TRAINER',
      })),
      ...branches.map((branch): GlobalSearchResult => ({
        id: branch.id,
        route: `/branches?search=${encodeURIComponent(branch.name)}`,
        subtitle: branch.address ?? undefined,
        title: branch.name,
        type: 'BRANCH',
      })),
      ...rooms.map((room): GlobalSearchResult => ({
        id: room.id,
        metadata: { branchId: room.branchId },
        route: `/rooms?branchId=${room.branchId}&roomId=${room.id}`,
        subtitle: room.branch.name,
        title: room.name,
        type: 'ROOM',
      })),
      ...cards.map((card): GlobalSearchResult => ({
        id: card.id,
        metadata: card.student ? { branchId: card.student.branchId } : undefined,
        route: card.student
          ? `/students/${card.student.id}?openedByCard=1`
          : `/cards?search=${encodeURIComponent(card.barcode)}`,
        subtitle: card.student
          ? `${card.student.lastName} ${card.student.firstName} · ${card.student.branch.name}`
          : 'Карта не привязана',
        title: card.barcode,
        type: 'CARD',
      })),
    ];
  }
}
