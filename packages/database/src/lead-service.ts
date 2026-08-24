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
