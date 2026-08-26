import type {
  AuthenticatedUser,
  LeadCreateInput,
  LeadDetail,
  LeadGroupAssignmentInput,
  LeadListQuery,
  LeadListResult,
  LeadStudentConversionInput,
  LeadStudentConversionResult,
  LeadStatus,
  TrialAppointmentSummary,
  TrialCancelInput,
  TrialListQuery,
  TrialOccurrenceQuery,
  TrialOccurrenceSummary,
  TrialOutcomeInput,
  TrialScheduleInput,
} from '@arava/shared';
import { randomUUID } from 'node:crypto';

import type { CrmChatRequestContext, IntegrationService } from './integration-service';
import { DomainError } from './security';
import { normalizePhone } from './security';
import type { DatabaseClient } from './index';
import type { ApplicationService } from './services';
import type { StudioService } from './studio-service';
import { LessonOccurrenceService } from './lesson-occurrence-service';

function localDateKey(value = new Date()): string {
  return [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

export function deriveTrialWorkflowState(input: {
  attendanceStatus?: string | undefined;
  endsAt: Date;
  leadStatus?: LeadStatus | undefined;
  lessonStatus: string;
  now: Date;
  outcome?: string | null | undefined;
  purchased: boolean;
  status: string;
  startsAt: Date;
}): TrialAppointmentSummary['state'] {
  if (input.status === 'CANCELLED') return 'CANCELLED';
  if (input.outcome === 'PURCHASED') return 'SUBSCRIPTION_PURCHASED';
  if (input.outcome === 'DECLINED') return 'CLOSED';
  if (input.outcome === 'NO_SHOW') return 'MISSED';
  if (input.outcome === 'THINKING') return 'FOLLOW_UP';
  if (input.leadStatus === 'REJECTED' || input.leadStatus === 'NOT_RELEVANT') return 'CLOSED';
  if (input.lessonStatus === 'CANCELLED') return 'CANCELLED';
  if (input.purchased) return 'SUBSCRIPTION_PURCHASED';
  const attended =
    input.leadStatus === 'TRIAL_ATTENDED' ||
    ['PRESENT', 'LATE', 'TRIAL'].includes(input.attendanceStatus ?? '');
  if (attended) return 'FOLLOW_UP';
  if (['ABSENT', 'EXCUSED'].includes(input.attendanceStatus ?? '')) return 'MISSED';
  if (input.leadStatus === 'NO_ANSWER' && input.startsAt <= input.now) return 'MISSED';
  if (input.endsAt < input.now) return 'FOLLOW_UP';
  const start = new Date(input.startsAt);
  const today = new Date(input.now);
  start.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return start.getTime() === today.getTime() ? 'TODAY' : 'SCHEDULED';
}

export class LeadService {
  private readonly lessonOccurrences: LessonOccurrenceService;

  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
    private readonly integration: IntegrationService,
    private readonly studio: StudioService,
  ) {
    this.lessonOccurrences = new LessonOccurrenceService(database);
  }

  async list(token: string, query: LeadListQuery): Promise<LeadListResult> {
    const actor = await this.actor(token);
    return this.integration.listRemoteLeads(this.context(actor), query);
  }

  async get(token: string, id: string): Promise<LeadDetail> {
    const actor = await this.actor(token);
    const lead = await this.integration.getRemoteLead(this.context(actor), id);
    return this.withLocalCandidates(actor, lead);
  }

  async create(token: string, input: LeadCreateInput): Promise<LeadDetail> {
    const actor = await this.actor(token);
    return this.integration.createRemoteLead(this.context(actor), input);
  }

  async updateStatus(token: string, id: string, status: LeadStatus): Promise<LeadDetail> {
    const actor = await this.actor(token);
    return this.integration.updateRemoteLeadStatus(
      this.context(actor),
      id,
      status,
      `lead-status:${randomUUID()}`,
    );
  }

  async convert(token: string, id: string, crmStudentId: string): Promise<LeadDetail> {
    const actor = await this.actor(token);
    await this.application.getStudent(token, crmStudentId);
    const converted = await this.integration.convertRemoteLead(
      this.context(actor),
      id,
      crmStudentId,
      `lead-convert:${id}:${crmStudentId}`,
    );
    await this.database.trialAppointment.updateMany({
      data: { studentId: crmStudentId, version: { increment: 1 } },
      where: { externalLeadId: id, studentId: null },
    });
    return converted;
  }

  async assignGroup(
    token: string,
    id: string,
    input: LeadGroupAssignmentInput,
  ): Promise<LeadDetail> {
    const actor = await this.actor(token);
    if (input.crmGroupId) {
      const group = await this.studio.getGroup(token, input.crmGroupId);
      if (group.archivedAt || (group.status !== 'ACTIVE' && group.status !== 'RECRUITING'))
        throw new DomainError(
          'VALIDATION',
          'Для заявки доступна только активная группа или группа с набором.',
        );
    }
    return this.integration.updateRemoteLeadGroup(
      this.context(actor),
      id,
      input.crmGroupId,
      `lead-group:${id}:${input.crmGroupId ?? 'none'}`,
    );
  }

  async createStudent(
    token: string,
    id: string,
    input: LeadStudentConversionInput,
  ): Promise<LeadStudentConversionResult> {
    const actor = await this.actor(token);
    const lead = await this.withLocalCandidates(
      actor,
      await this.integration.getRemoteLead(this.context(actor), id),
    );
    if (lead.convertedStudentCrmId) {
      const existing = await this.application.getStudent(token, lead.convertedStudentCrmId);
      return { lead, membershipCreated: false, student: existing };
    }
    if (lead.existingStudentCandidates.length > 0 && !input.allowDuplicate)
      throw new DomainError(
        'CONFLICT',
        'В CRM уже есть ученик с таким телефоном. Проверьте совпадение или подтвердите создание нового ученика.',
      );
    if (input.addToGroup && !input.groupId)
      throw new DomainError('VALIDATION', 'Выберите группу для добавления ученика.');
    if (input.groupId) {
      const group = await this.studio.getGroup(token, input.groupId);
      if (group.branchId !== input.student.branchId)
        throw new DomainError(
          'VALIDATION',
          'Ученик и выбранная группа должны быть в одном филиале.',
        );
      if (group.archivedAt || (group.status !== 'ACTIVE' && group.status !== 'RECRUITING'))
        throw new DomainError(
          'VALIDATION',
          'Для новой записи доступна только активная группа или группа с набором.',
        );
    }
    const created = await this.application.createStudentFromWebLead(token, id, input.student);
    if (lead.parentName && !created.reused) {
      await this.application.createContact(token, created.student.id, {
        fullName: lead.parentName,
        isPrimary: true,
        phone: lead.phone,
        relationship: 'Родитель',
        whatsapp: false,
      });
    }
    let membershipCreated = false;
    if (input.addToGroup && input.groupId) {
      const active = await this.database.enrollment.findFirst({
        where: {
          groupId: input.groupId,
          leftAt: null,
          status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] },
          studentId: created.student.id,
        },
      });
      if (!active) {
        await this.studio.addEnrollment(token, input.groupId, {
          joinedAt: localDateKey(),
          overrideCapacity: false,
          status: 'TRIAL',
          studentId: created.student.id,
        });
        membershipCreated = true;
      }
    }
    const converted = await this.integration.convertRemoteLead(
      this.context(actor),
      id,
      created.student.id,
      `lead-convert:${id}:${created.student.id}`,
    );
    await this.database.trialAppointment.updateMany({
      data: { studentId: created.student.id, version: { increment: 1 } },
      where: { externalLeadId: id, studentId: null },
    });
    return { lead: converted, membershipCreated, student: created.student };
  }

  async scheduleTrial(token: string, input: TrialScheduleInput): Promise<TrialAppointmentSummary> {
    const actor = await this.actor(token);
    const [lead, student, group] = await Promise.all([
      input.leadId
        ? this.integration.getRemoteLead(this.context(actor), input.leadId)
        : Promise.resolve(undefined),
      input.studentId
        ? this.application.getStudent(token, input.studentId)
        : Promise.resolve(undefined),
      this.studio.getGroup(token, input.groupId),
    ]);
    const linkedStudentId = student?.id ?? lead?.convertedStudentCrmId;
    if (student && student.branchId !== group.branchId)
      throw new DomainError('VALIDATION', 'Ученик и группа должны находиться в одном филиале.');
    if (group.archivedAt || !['ACTIVE', 'RECRUITING'].includes(group.status))
      throw new DomainError('VALIDATION', 'Для пробного доступна только действующая группа.');
    const lesson = await this.studio.materializeLessonOccurrence(token, {
      groupId: group.id,
      startsAt: input.startsAt,
    });
    if (lesson.groupId !== group.id)
      throw new DomainError('VALIDATION', 'Выбранное занятие относится к другой группе.');
    if (lesson.status === 'CANCELLED')
      throw new DomainError('VALIDATION', 'Нельзя записать на отменённое занятие.');
    if (new Date(lesson.endsAt) <= new Date())
      throw new DomainError('VALIDATION', 'Выберите текущее или предстоящее занятие.');

    if (lead) {
      await this.integration.updateRemoteLeadGroup(
        this.context(actor),
        lead.id,
        group.id,
        `trial-group:${lead.id}:${lesson.id}`,
      );
      await this.integration.updateRemoteLeadStatus(
        this.context(actor),
        lead.id,
        'TRIAL_BOOKED',
        `trial-status:${lead.id}:${lesson.id}`,
      );
    }

    const subjectKey = lead?.id ?? `student:${student?.id ?? ''}`;
    const [occupiedEnrollments, bookedTrials] = await Promise.all([
      this.database.enrollment.findMany({
        select: { studentId: true },
        where: { groupId: group.id, leftAt: null, status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] } },
      }),
      this.database.trialAppointment.findMany({
        select: { externalLeadId: true, studentId: true },
        where: { groupId: group.id, lessonId: lesson.id, status: 'BOOKED', supersededAt: null },
      }),
    ]);
    const enrolledStudentIds = new Set(occupiedEnrollments.map(({ studentId }) => studentId));
    const trialGuests = new Set(
      bookedTrials.flatMap(({ externalLeadId, studentId }) =>
        studentId && enrolledStudentIds.has(studentId) ? [] : [studentId ?? externalLeadId],
      ),
    ).size;
    const alreadyBooked = await this.database.trialAppointment.findUnique({
      where: { externalLeadId_lessonId: { externalLeadId: subjectKey, lessonId: lesson.id } },
    });
    if (alreadyBooked?.status === 'BOOKED' && !alreadyBooked.supersededAt)
      return this.summaryById(token, alreadyBooked.id);
    const subjectEnrolled = linkedStudentId
      ? await this.database.enrollment.findFirst({
          where: {
            groupId: group.id,
            leftAt: null,
            status: { in: ['ACTIVE', 'TRIAL', 'FROZEN'] },
            studentId: linkedStudentId,
          },
        })
      : null;
    if (
      !alreadyBooked &&
      !subjectEnrolled &&
      occupiedEnrollments.length + trialGuests >= group.capacity
    )
      throw new DomainError('CONFLICT', 'В группе нет свободных мест для пробного занятия.');

    const appointment = await this.database.$transaction(async (transaction) => {
      const now = new Date();
      await transaction.trialAppointment.updateMany({
        data: {
          status: 'CANCELLED',
          supersededAt: now,
          cancelledAt: now,
          version: { increment: 1 },
        },
        where: { externalLeadId: subjectKey, supersededAt: null, lessonId: { not: lesson.id } },
      });
      const saved = await transaction.trialAppointment.upsert({
        create: {
          createdByUserId: actor.id,
          externalLeadId: subjectKey,
          groupId: group.id,
          lessonId: lesson.id,
          studentId: linkedStudentId ?? null,
        },
        update: {
          cancelledAt: null,
          groupId: group.id,
          outcome: null,
          status: 'BOOKED',
          studentId: linkedStudentId ?? null,
          supersededAt: null,
          version: { increment: 1 },
        },
        where: { externalLeadId_lessonId: { externalLeadId: subjectKey, lessonId: lesson.id } },
      });
      await transaction.auditLog.create({
        data: {
          action: alreadyBooked ? 'TRIAL_RESCHEDULED' : 'TRIAL_SCHEDULED',
          actorUserId: actor.id,
          detail: JSON.stringify({ groupId: group.id, lessonId: lesson.id }),
          entityId: saved.id,
          entityType: 'TrialAppointment',
        },
      });
      return saved;
    });
    const results = await this.listTrials(
      token,
      lead ? { leadId: lead.id } : { studentId: student?.id },
    );
    const result = results.find(({ id }) => id === appointment.id);
    if (result?.id !== appointment.id)
      throw new DomainError('NOT_FOUND', 'Запись на пробное не найдена после сохранения.');
    return result;
  }

  async cancelTrial(
    token: string,
    id: string,
    input: TrialCancelInput,
  ): Promise<TrialAppointmentSummary> {
    const actor = await this.actor(token);
    const appointment = await this.database.trialAppointment.findUnique({
      include: { group: true },
      where: { id },
    });
    if (!appointment) throw new DomainError('NOT_FOUND', 'Пробное занятие не найдено.');
    if (actor.role !== 'OWNER' && !actor.branchIds.includes(appointment.group.branchId))
      throw new DomainError('AUTHORIZATION', 'Пробное относится к недоступному филиалу.');
    const updated = await this.database.$transaction(async (transaction) => {
      const result = await transaction.trialAppointment.updateMany({
        data: { cancelledAt: new Date(), status: 'CANCELLED', version: { increment: 1 } },
        where: { id, status: 'BOOKED', version: input.expectedVersion },
      });
      if (result.count !== 1)
        throw new DomainError('CONFLICT', 'Запись уже изменена. Обновите данные.');
      await transaction.auditLog.create({
        data: {
          action: 'TRIAL_CANCELLED',
          actorUserId: actor.id,
          entityId: id,
          entityType: 'TrialAppointment',
        },
      });
      return transaction.trialAppointment.findUniqueOrThrow({ where: { id } });
    });
    return this.summaryById(token, updated.id);
  }

  async setTrialOutcome(
    token: string,
    id: string,
    input: TrialOutcomeInput,
  ): Promise<TrialAppointmentSummary> {
    const actor = await this.actor(token);
    const appointment = await this.database.trialAppointment.findUnique({
      include: { group: true },
      where: { id },
    });
    if (!appointment) throw new DomainError('NOT_FOUND', 'Пробное занятие не найдено.');
    if (actor.role !== 'OWNER' && !actor.branchIds.includes(appointment.group.branchId))
      throw new DomainError('AUTHORIZATION', 'Пробное относится к недоступному филиалу.');
    const result = await this.database.$transaction(async (transaction) => {
      const changed = await transaction.trialAppointment.updateMany({
        data: { outcome: input.outcome, version: { increment: 1 } },
        where: { id, version: input.expectedVersion },
      });
      if (changed.count !== 1)
        throw new DomainError('CONFLICT', 'Результат уже изменён. Обновите данные.');
      await transaction.auditLog.create({
        data: {
          action: 'TRIAL_OUTCOME_SET',
          actorUserId: actor.id,
          detail: JSON.stringify({ outcome: input.outcome }),
          entityId: id,
          entityType: 'TrialAppointment',
        },
      });
      return transaction.trialAppointment.findUniqueOrThrow({ where: { id } });
    });
    return this.summaryById(token, result.id);
  }

  private async summaryById(token: string, id: string): Promise<TrialAppointmentSummary> {
    const appointment = await this.database.trialAppointment.findUnique({ where: { id } });
    if (!appointment) throw new DomainError('NOT_FOUND', 'Пробное занятие не найдено.');
    const rows = await this.listTrials(
      token,
      appointment.studentId
        ? { studentId: appointment.studentId }
        : { leadId: appointment.externalLeadId },
    );
    const result = rows.find((row) => row.id === id);
    if (!result) throw new DomainError('NOT_FOUND', 'Пробное занятие недоступно.');
    return result;
  }

  async listTrialOccurrences(
    token: string,
    query: TrialOccurrenceQuery,
  ): Promise<TrialOccurrenceSummary[]> {
    const actor = await this.actor(token);
    const group = await this.studio.getGroup(token, query.groupId);
    if (group.archivedAt || !['ACTIVE', 'RECRUITING'].includes(group.status))
      throw new DomainError('VALIDATION', 'Для пробного доступна только действующая группа.');
    const occurrences = await this.lessonOccurrences.resolveRange(actor, {
      dateFrom: new Date(query.dateFrom),
      dateTo: new Date(query.dateTo),
      groupId: group.id,
    });
    const now = new Date();
    return occurrences
      .filter(({ endsAt }) => endsAt > now)
      .map((occurrence) => ({
        branchId: group.branchId,
        branchName: group.branchName,
        endsAt: occurrence.endsAt.toISOString(),
        groupId: group.id,
        groupName: group.name,
        ...(occurrence.lessonId ? { lessonId: occurrence.lessonId } : {}),
        source: occurrence.source,
        startsAt: occurrence.startsAt.toISOString(),
      }));
  }

  async listTrials(token: string, query: TrialListQuery): Promise<TrialAppointmentSummary[]> {
    const actor = await this.actor(token);
    const branchIds = actor.role === 'OWNER' ? undefined : actor.branchIds;
    const appointments = await this.database.trialAppointment.findMany({
      include: {
        group: { include: { branch: { select: { name: true } } } },
        lesson: true,
        student: { select: { firstName: true, lastName: true } },
      },
      orderBy: { lesson: { startsAt: 'asc' } },
      where: {
        ...(query.includeHistory ? {} : { supersededAt: null }),
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(query.leadId ? { externalLeadId: query.leadId } : {}),
        ...(query.studentId ? { studentId: query.studentId } : {}),
        ...(branchIds ? { group: { branchId: { in: branchIds } } } : {}),
      },
    });
    if (!appointments.length) return [];
    const remoteIds = [
      ...new Set(
        appointments
          .map(({ externalLeadId }) => externalLeadId)
          .filter((id) => !id.startsWith('student:')),
      ),
    ];
    const remote = query.leadId
      ? [await this.integration.getRemoteLead(this.context(actor), query.leadId)]
      : remoteIds.length
        ? (await this.integration.listRemoteLeads(this.context(actor), {})).leads
        : [];
    const leads = new Map(remote.map((lead) => [lead.id, lead]));
    const now = new Date();
    const from = query.dateFrom ? new Date(query.dateFrom) : undefined;
    const to = query.dateTo ? new Date(query.dateTo) : undefined;
    const studentIds = [
      ...new Set(
        appointments.flatMap((appointment) => {
          const studentId =
            appointment.studentId ?? leads.get(appointment.externalLeadId)?.convertedStudentCrmId;
          return studentId ? [studentId] : [];
        }),
      ),
    ];
    const [attendances, subscriptions] = await Promise.all([
      this.database.attendance.findMany({
        where: {
          OR: appointments.flatMap((appointment) => {
            const studentId =
              appointment.studentId ?? leads.get(appointment.externalLeadId)?.convertedStudentCrmId;
            return studentId ? [{ lessonId: appointment.lessonId, studentId }] : [];
          }),
        },
      }),
      studentIds.length
        ? this.database.subscription.findMany({
            select: { purchasedAt: true, studentId: true },
            where: { status: { not: 'CANCELLED' }, studentId: { in: studentIds } },
          })
        : [],
    ]);
    const attendanceBySubject = new Map(
      attendances.map((attendance) => [
        `${attendance.lessonId}:${attendance.studentId}`,
        attendance,
      ]),
    );
    const subscriptionsByStudent = new Map<string, Date[]>();
    for (const subscription of subscriptions) {
      const dates = subscriptionsByStudent.get(subscription.studentId) ?? [];
      dates.push(subscription.purchasedAt);
      subscriptionsByStudent.set(subscription.studentId, dates);
    }
    const summaries = appointments.map((appointment): TrialAppointmentSummary | undefined => {
      const lead = leads.get(appointment.externalLeadId);
      const studentId = appointment.studentId ?? lead?.convertedStudentCrmId;
      if (!lead && !appointment.student) return undefined;
      const attendance = studentId
        ? attendanceBySubject.get(`${appointment.lessonId}:${studentId}`)
        : undefined;
      const purchased = studentId
        ? subscriptionsByStudent
            .get(studentId)
            ?.some((purchasedAt) => purchasedAt >= appointment.lesson.startsAt)
        : false;
      const state = deriveTrialWorkflowState({
        attendanceStatus: attendance?.status,
        endsAt: appointment.lesson.endsAt,
        leadStatus: lead?.status,
        lessonStatus: appointment.lesson.status,
        now,
        outcome: appointment.outcome,
        purchased: Boolean(purchased),
        status: appointment.status,
        startsAt: appointment.lesson.startsAt,
      });
      const inRange =
        (!from || appointment.lesson.startsAt >= from) &&
        (!to || appointment.lesson.startsAt <= to);
      if (!inRange && !(query.includeFollowUp && state === 'FOLLOW_UP')) return undefined;
      return {
        ...(attendance ? { attendanceStatus: attendance.status } : {}),
        branchId: appointment.group.branchId,
        branchName: appointment.group.branch.name,
        endsAt: appointment.lesson.endsAt.toISOString(),
        groupId: appointment.groupId,
        groupName: appointment.group.name,
        id: appointment.id,
        ...(lead ? { leadId: lead.id } : {}),
        leadName:
          lead?.childName ??
          [appointment.student?.firstName, appointment.student?.lastName].filter(Boolean).join(' '),
        lessonId: appointment.lessonId,
        lessonStatus: appointment.lesson.status,
        startsAt: appointment.lesson.startsAt.toISOString(),
        state,
        ...(appointment.outcome ? { outcome: appointment.outcome } : {}),
        version: appointment.version,
        ...(studentId ? { studentId } : {}),
      };
    });
    return summaries.filter((item): item is TrialAppointmentSummary => Boolean(item));
  }

  private async withLocalCandidates(
    actor: AuthenticatedUser,
    lead: LeadDetail,
  ): Promise<LeadDetail> {
    if (actor.role !== 'OWNER' && lead.branchCrmId && !actor.branchIds.includes(lead.branchCrmId))
      throw new DomainError('AUTHORIZATION', 'Заявка относится к недоступному филиалу.');
    let phone: string;
    try {
      phone = normalizePhone(lead.phone);
    } catch {
      return lead;
    }
    const local = await this.database.student.findMany({
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { firstName: true, id: true, lastName: true },
      take: 10,
      where: {
        archivedAt: null,
        phone,
        ...(actor.role === 'OWNER' ? {} : { branchId: { in: actor.branchIds } }),
      },
    });
    const candidates = new Map(
      lead.existingStudentCandidates.map((candidate) => [candidate.crmStudentId, candidate]),
    );
    for (const student of local)
      candidates.set(student.id, {
        crmStudentId: student.id,
        displayName: `${student.lastName} ${student.firstName}`,
      });
    return { ...lead, existingStudentCandidates: [...candidates.values()] };
  }

  private async actor(token: string): Promise<AuthenticatedUser> {
    const actor = await this.application.authenticate(token);
    if (actor.role === 'COACH')
      throw new DomainError('AUTHORIZATION', 'Тренеру недоступен раздел заявок.');
    return actor;
  }

  private context(actor: AuthenticatedUser): CrmChatRequestContext {
    return {
      branchIds: actor.branchIds,
      name: actor.fullName,
      role: actor.role,
      userId: actor.id,
    };
  }
}
