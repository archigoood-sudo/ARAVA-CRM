import type {
  AuthenticatedUser,
  LeadCreateInput,
  LeadDetail,
  LeadListQuery,
  LeadListResult,
  LeadStatus,
} from '@arava/shared';
import { randomUUID } from 'node:crypto';

import type { CrmChatRequestContext, IntegrationService } from './integration-service';
import { DomainError } from './security';
import type { ApplicationService } from './services';

export class LeadService {
  constructor(
    private readonly application: ApplicationService,
    private readonly integration: IntegrationService,
  ) {}

  async list(token: string, query: LeadListQuery): Promise<LeadListResult> {
    const actor = await this.actor(token);
    return this.integration.listRemoteLeads(this.context(actor), query);
  }

  async get(token: string, id: string): Promise<LeadDetail> {
    const actor = await this.actor(token);
    return this.integration.getRemoteLead(this.context(actor), id);
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
    return this.integration.convertRemoteLead(
      this.context(actor),
      id,
      crmStudentId,
      `lead-convert:${randomUUID()}`,
    );
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
