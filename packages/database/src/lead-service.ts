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
  TrialListQuery,
  TrialScheduleInput,
} from '@arava/shared';
import { randomUUID } from 'node:crypto';

import type { CrmChatRequestContext, IntegrationService } from './integration-service';
import { DomainError } from './security';
import { normalizePhone } from './security';
import type { DatabaseClient } from './index';
import type { ApplicationService } from './services';
import type { StudioService } from './studio-service';

export class LeadService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
    private readonly integration: IntegrationService,
    private readonly studio: StudioService,
  ) {}

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
    return this.integration.convertRemoteLead(
      this.context(actor),
      id,
      crmStudentId,
      `lead-convert:${id}:${crmStudentId}`,
    );
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
          joinedAt: new Date().toISOString().slice(0, 10),
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
    return { lead: converted, membershipCreated, student: created.student };
  }

  async scheduleTrial(token: string, input: TrialScheduleInput): Promise<TrialAppointmentSummary> {
    const actor = await this.actor(token);
    const [lead, group, lesson] = await Promise.all([
      this.integration.getRemoteLead(this.context(actor), input.leadId),
      this.studio.getGroup(token, input.groupId),
      this.studio.getLesson(token, input.lessonId),
    ]);
    if (group.archivedAt || !['ACTIVE', 'RECRUITING'].includes(group.status))
      throw new DomainError('VALIDATION', 'Для пробного доступна только действующая группа.');
    if (lesson.groupId !== group.id)
      throw new DomainError('VALIDATION', 'Выбранное занятие относится к другой группе.');
    if (lesson.status === 'CANCELLED')
      throw new DomainError('VALIDATION', 'Нельзя записать на отменённое занятие.');
    if (new Date(lesson.endsAt) <= new Date())
      throw new DomainError('VALIDATION', 'Выберите текущее или предстоящее занятие.');

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

    const appointment = await this.database.$transaction(async (transaction) => {
      const now = new Date();
      await transaction.trialAppointment.updateMany({
        data: { supersededAt: now },
        where: { externalLeadId: lead.id, supersededAt: null, lessonId: { not: lesson.id } },
      });
      const saved = await transaction.trialAppointment.upsert({
        create: {
          createdByUserId: actor.id,
          externalLeadId: lead.id,
          groupId: group.id,
          lessonId: lesson.id,
        },
        update: { groupId: group.id, supersededAt: null },
        where: { externalLeadId_lessonId: { externalLeadId: lead.id, lessonId: lesson.id } },
      });
      await transaction.auditLog.create({
        data: {
          action: 'TRIAL_SCHEDULED',
          actorUserId: actor.id,
          detail: JSON.stringify({ groupId: group.id, lessonId: lesson.id }),
          entityId: saved.id,
          entityType: 'TrialAppointment',
        },
      });
      return saved;
    });
    const [result] = await this.listTrials(token, { leadId: lead.id });
    if (result?.id !== appointment.id)
      throw new DomainError('NOT_FOUND', 'Запись на пробное не найдена после сохранения.');
    return result;
  }

  async listTrials(token: string, query: TrialListQuery): Promise<TrialAppointmentSummary[]> {
    const actor = await this.actor(token);
    const branchIds = actor.role === 'OWNER' ? undefined : actor.branchIds;
    const appointments = await this.database.trialAppointment.findMany({
      include: {
        group: { include: { branch: { select: { name: true } } } },
        lesson: true,
      },
      orderBy: { lesson: { startsAt: 'asc' } },
      where: {
        supersededAt: null,
        ...(query.leadId ? { externalLeadId: query.leadId } : {}),
        ...(branchIds ? { group: { branchId: { in: branchIds } } } : {}),
      },
    });
    if (!appointments.length) return [];
    const remote = query.leadId
      ? [await this.integration.getRemoteLead(this.context(actor), query.leadId)]
      : (await this.integration.listRemoteLeads(this.context(actor), {})).leads;
    const leads = new Map(remote.map((lead) => [lead.id, lead]));
    const now = new Date();
    const from = query.dateFrom ? new Date(query.dateFrom) : undefined;
    const to = query.dateTo ? new Date(query.dateTo) : undefined;
    const summaries = await Promise.all(
      appointments.map(async (appointment): Promise<TrialAppointmentSummary | undefined> => {
        const lead = leads.get(appointment.externalLeadId);
        if (!lead) return undefined;
        const studentId = lead.convertedStudentCrmId;
        if (query.studentId && studentId !== query.studentId) return undefined;
        const attendance = studentId
          ? await this.database.attendance.findUnique({
              where: { lessonId_studentId: { lessonId: appointment.lessonId, studentId } },
            })
          : null;
        const purchased = studentId
          ? await this.database.subscription.findFirst({
              where: {
                purchasedAt: { gte: appointment.lesson.startsAt },
                status: { not: 'CANCELLED' },
                studentId,
              },
            })
          : null;
        const state = this.trialState({
          attendanceStatus: attendance?.status,
          endsAt: appointment.lesson.endsAt,
          leadStatus: lead.status,
          lessonStatus: appointment.lesson.status,
          now,
          purchased: Boolean(purchased),
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
          leadId: lead.id,
          leadName: lead.childName,
          lessonId: appointment.lessonId,
          lessonStatus: appointment.lesson.status,
          startsAt: appointment.lesson.startsAt.toISOString(),
          state,
          ...(studentId ? { studentId } : {}),
        };
      }),
    );
    return summaries.filter((item): item is TrialAppointmentSummary => Boolean(item));
  }

  private trialState(input: {
    attendanceStatus?: string | undefined;
    endsAt: Date;
    leadStatus: LeadStatus;
    lessonStatus: string;
    now: Date;
    purchased: boolean;
    startsAt: Date;
  }): TrialAppointmentSummary['state'] {
    if (input.leadStatus === 'REJECTED' || input.leadStatus === 'NOT_RELEVANT') return 'CLOSED';
    if (input.lessonStatus === 'CANCELLED') return 'CANCELLED';
    if (input.purchased) return 'SUBSCRIPTION_PURCHASED';
    const attended =
      input.leadStatus === 'TRIAL_ATTENDED' ||
      ['PRESENT', 'LATE', 'TRIAL'].includes(input.attendanceStatus ?? '');
    if (attended) return 'FOLLOW_UP';
    if (['ABSENT', 'EXCUSED'].includes(input.attendanceStatus ?? '')) return 'MISSED';
    if (input.leadStatus === 'NO_ANSWER' && input.startsAt <= input.now) return 'MISSED';
    const start = new Date(input.startsAt);
    const today = new Date(input.now);
    start.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return start.getTime() === today.getTime() ? 'TODAY' : 'SCHEDULED';
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
