import type {
  StudentDocumentAttachmentInput,
  StudentDocumentInput,
  StudentDocumentPackInfo,
  StudentDocumentStatus,
  StudentDocumentSummary,
} from '@arava/shared';
import { Prisma, type StudentDocumentType } from '@prisma/client';

import type { DatabaseClient } from './index';
import { assertBranchAccess, assertPermission } from './permissions';
import { DomainError } from './security';
import type { ApplicationService } from './services';

const STATUSES: Record<StudentDocumentType, readonly StudentDocumentStatus[]> = {
  CONTRACT: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
  MEDIA_CONSENT: ['ALLOWED', 'NOT_ALLOWED', 'REVOKED', 'NOT_PROVIDED'],
  PERSONAL_DATA_CONSENT: ['CONSENTED', 'REVOKED', 'NOT_PROVIDED'],
};

const includeDocument = {
  contractDetail: true,
  representativeContact: { select: { fullName: true } },
  statusHistory: { orderBy: { changedAt: 'desc' as const } },
} as const;

type DocumentRow = Prisma.StudentDocumentGetPayload<{ include: typeof includeDocument }>;

function localDate(value: string): Date {
  const result = new Date(`${value}T12:00:00`);
  if (Number.isNaN(result.getTime()))
    throw new DomainError('VALIDATION', 'Укажите дату документа.');
  return result;
}

function summary(row: DocumentRow): StudentDocumentSummary {
  return {
    createdAt: row.createdAt.toISOString(),
    documentDate: row.documentDate.toISOString().slice(0, 10),
    documentType: row.documentType,
    id: row.id,
    source: row.source,
    status: row.status as StudentDocumentStatus,
    statusHistory: row.statusHistory.map((entry) => ({
      changedAt: entry.changedAt.toISOString(),
      ...(entry.previousStatus ? { previousStatus: entry.previousStatus } : {}),
      status: entry.status,
    })),
    studentId: row.studentId,
    updatedAt: row.updatedAt.toISOString(),
    ...(row.attachmentMediaId && row.attachmentFileName && row.attachmentMimeType
      ? {
          attachment: {
            fileName: row.attachmentFileName,
            mediaId: row.attachmentMediaId,
            mimeType: row.attachmentMimeType as 'application/pdf' | 'image/jpeg' | 'image/png',
          },
        }
      : {}),
    ...(row.contractDetail ? { contractNumber: row.contractDetail.contractNumber } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.representativeContactId
      ? { representativeContactId: row.representativeContactId }
      : {}),
    ...(row.representativeContact?.fullName
      ? { representativeName: row.representativeContact.fullName }
      : {}),
  };
}

export class StudentDocumentService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  private async actorAndStudent(token: string, studentId: string, manage = false) {
    const actor = await this.application.authenticate(token);
    assertPermission(actor, manage ? 'documents:manage' : 'documents:read');
    const student = await this.database.student.findUnique({
      select: { branchId: true, id: true },
      where: { id: studentId },
    });
    if (!student) throw new DomainError('NOT_FOUND', 'Ученик не найден.');
    assertBranchAccess(actor, student.branchId);
    return { actor, student };
  }

  private assertStatus(documentType: StudentDocumentType, status: StudentDocumentStatus): void {
    if (!STATUSES[documentType].includes(status)) {
      throw new DomainError('VALIDATION', 'Некорректное состояние документа.');
    }
  }

  async list(token: string, studentId: string): Promise<StudentDocumentSummary[]> {
    await this.actorAndStudent(token, studentId);
    const rows = await this.database.studentDocument.findMany({
      include: includeDocument,
      orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
      where: { studentId },
    });
    return rows.map(summary);
  }

  async packInfo(
    token: string,
    studentId: string,
    representativeContactId?: string,
  ): Promise<StudentDocumentPackInfo> {
    await this.actorAndStudent(token, studentId, true);
    const student = await this.database.student.findUniqueOrThrow({
      select: {
        birthDate: true,
        firstName: true,
        lastName: true,
        middleName: true,
      },
      where: { id: studentId },
    });
    if (!student.birthDate) {
      throw new DomainError('VALIDATION', 'Укажите дату рождения ученика.');
    }
    const now = new Date();
    let age = now.getFullYear() - student.birthDate.getFullYear();
    if (
      now.getMonth() < student.birthDate.getMonth() ||
      (now.getMonth() === student.birthDate.getMonth() &&
        now.getDate() < student.birthDate.getDate())
    ) {
      age -= 1;
    }
    const isAdult = age >= 18;
    const contract = await this.database.studentDocument.findFirst({
      include: { contractDetail: true },
      orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
      where: {
        contractDetail: { isNot: null },
        documentType: 'CONTRACT',
        status: { not: 'CANCELLED' },
        studentId,
      },
    });
    if (!contract?.contractDetail) {
      throw new DomainError('VALIDATION', 'Сначала оформите договор');
    }
    let representative: { fullName: string; id: string } | undefined;
    if (!isAdult && representativeContactId) {
      representative =
        (await this.database.studentContact.findFirst({
          select: { fullName: true, id: true },
          where: { archivedAt: null, id: representativeContactId, studentId },
        })) ?? undefined;
      if (!representative) {
        throw new DomainError('VALIDATION', 'Выбранный представитель недоступен.');
      }
    }
    const studentName = [student.lastName, student.firstName, student.middleName]
      .filter(Boolean)
      .join(' ');
    return {
      contractNumber: contract.contractDetail.contractNumber,
      isAdult,
      parts: isAdult
        ? [
            'Договор',
            'Приложение №1 / Правила посещения',
            'Согласие на обработку персональных данных',
            'Согласие на фото/видео и использование изображения',
          ]
        : [
            'Договор',
            'Приложение №1 / Правила посещения',
            'Согласие родителя на обработку персональных данных',
            'Согласие родителя на фото/видео',
          ],
      ...(representative
        ? {
            representativeContactId: representative.id,
            representativeName: representative.fullName,
          }
        : {}),
      studentName,
    };
  }

  async attachGeneratedPack(
    token: string,
    studentId: string,
    attachment: StudentDocumentAttachmentInput,
  ): Promise<StudentDocumentSummary> {
    const { actor } = await this.actorAndStudent(token, studentId, true);
    const contract = await this.database.studentDocument.findFirst({
      include: includeDocument,
      orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
      where: {
        contractDetail: { isNot: null },
        documentType: 'CONTRACT',
        status: { not: 'CANCELLED' },
        studentId,
      },
    });
    if (!contract) throw new DomainError('VALIDATION', 'Сначала оформите договор');
    if (contract.attachmentMediaId) {
      throw new DomainError(
        'CONFLICT',
        'У договора уже есть файл. Удалите его вручную перед добавлением нового комплекта.',
      );
    }
    const updated = await this.database.$transaction(async (transaction) => {
      const document = await transaction.studentDocument.update({
        data: {
          attachmentFileName: attachment.fileName,
          attachmentMediaId: attachment.mediaId,
          attachmentMimeType: attachment.mimeType,
        },
        include: includeDocument,
        where: { id: contract.id },
      });
      await transaction.auditLog.create({
        data: {
          action: 'DOCUMENT_ATTACHMENT_ADDED',
          actorUserId: actor.id,
          detail: JSON.stringify({ studentId }),
          entityId: contract.id,
          entityType: 'StudentDocument',
        },
      });
      return document;
    });
    return summary(updated);
  }

  async auditPackAction(
    token: string,
    studentId: string,
    action: 'DOCUMENT_PACK_GENERATED' | 'DOCUMENT_PACK_PDF_SAVED' | 'DOCUMENT_PACK_PRINT_REQUESTED',
  ): Promise<void> {
    const { actor } = await this.actorAndStudent(token, studentId, true);
    await this.database.auditLog.create({
      data: {
        action,
        actorUserId: actor.id,
        detail: JSON.stringify({ studentId }),
        entityId: studentId,
        entityType: 'Student',
      },
    });
  }

  async create(
    token: string,
    studentId: string,
    input: StudentDocumentInput,
  ): Promise<StudentDocumentSummary> {
    const { actor } = await this.actorAndStudent(token, studentId, true);
    this.assertStatus(input.documentType, input.status);
    if (input.documentType !== 'CONTRACT' && input.contractNumber) {
      throw new DomainError('VALIDATION', 'Номер доступен только для договора.');
    }
    if (input.source === 'GENERATED' && input.documentType !== 'CONTRACT') {
      throw new DomainError('VALIDATION', 'Генерация согласий пока недоступна.');
    }
    if (input.documentType === 'CONTRACT' && input.source === 'EXISTING' && !input.contractNumber) {
      throw new DomainError('VALIDATION', 'Укажите номер существующего договора.');
    }
    if (input.representativeContactId) {
      const representative = await this.database.studentContact.findFirst({
        select: { id: true },
        where: { archivedAt: null, id: input.representativeContactId, studentId },
      });
      if (!representative)
        throw new DomainError('VALIDATION', 'Выбранный представитель недоступен.');
    }
    const date = localDate(input.documentDate);
    try {
      const created = await this.database.$transaction(async (transaction) => {
        let contractNumber = input.contractNumber?.trim();
        if (input.documentType === 'CONTRACT' && input.source === 'GENERATED') {
          const year = date.getFullYear();
          const sequence = await transaction.contractNumberSequence.upsert({
            create: { nextNumber: 2, year },
            update: { nextNumber: { increment: 1 } },
            where: { year },
          });
          contractNumber = `${String(year).slice(-2)}-${String(sequence.nextNumber - 1).padStart(4, '0')}`;
        }
        const document = await transaction.studentDocument.create({
          data: {
            ...(input.attachment
              ? {
                  attachmentFileName: input.attachment.fileName,
                  attachmentMediaId: input.attachment.mediaId,
                  attachmentMimeType: input.attachment.mimeType,
                }
              : {}),
            ...(input.documentType === 'CONTRACT' && contractNumber
              ? { contractDetail: { create: { contractNumber } } }
              : {}),
            documentDate: date,
            documentType: input.documentType,
            ...(input.note ? { note: input.note } : {}),
            ...(input.representativeContactId
              ? { representativeContact: { connect: { id: input.representativeContactId } } }
              : {}),
            source: input.source,
            status: input.status,
            statusHistory: { create: { changedByUserId: actor.id, status: input.status } },
            student: { connect: { id: studentId } },
          },
          include: includeDocument,
        });
        const actions = [
          input.source === 'EXISTING' ? 'EXISTING_DOCUMENT_ADDED' : 'STUDENT_DOCUMENT_CREATED',
          ...(input.documentType === 'CONTRACT'
            ? [input.source === 'EXISTING' ? 'CONTRACT_EXISTING_ADDED' : 'CONTRACT_CREATED']
            : []),
          ...(input.attachment ? ['DOCUMENT_ATTACHMENT_ADDED'] : []),
        ];
        await transaction.auditLog.createMany({
          data: actions.map((action) => ({
            action,
            actorUserId: actor.id,
            detail: JSON.stringify({ documentType: input.documentType, studentId }),
            entityId: document.id,
            entityType: 'StudentDocument',
          })),
        });
        return document;
      });
      return summary(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DomainError('CONFLICT', 'Такой номер договора уже используется');
      }
      throw error;
    }
  }

  private async requireDocument(token: string, id: string, manage: boolean) {
    const row = await this.database.studentDocument.findUnique({
      include: { student: { select: { branchId: true } } },
      where: { id },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Документ не найден.');
    const actor = await this.application.authenticate(token);
    assertPermission(actor, manage ? 'documents:manage' : 'documents:read');
    assertBranchAccess(actor, row.student.branchId);
    return { actor, row };
  }

  async changeStatus(
    token: string,
    id: string,
    status: StudentDocumentStatus,
  ): Promise<StudentDocumentSummary> {
    const { actor, row } = await this.requireDocument(token, id, true);
    this.assertStatus(row.documentType, status);
    if (row.status === status) {
      return summary(
        await this.database.studentDocument.findUniqueOrThrow({
          include: includeDocument,
          where: { id },
        }),
      );
    }
    const updated = await this.database.$transaction(async (transaction) => {
      const document = await transaction.studentDocument.update({
        data: {
          status,
          statusHistory: {
            create: { changedByUserId: actor.id, previousStatus: row.status, status },
          },
        },
        include: includeDocument,
        where: { id },
      });
      await transaction.auditLog.createMany({
        data: [
          {
            action: 'DOCUMENT_STATUS_CHANGED',
            actorUserId: actor.id,
            detail: JSON.stringify({
              previousStatus: row.status,
              status,
              studentId: row.studentId,
            }),
            entityId: id,
            entityType: 'StudentDocument',
          },
          ...(status === 'REVOKED'
            ? [
                {
                  action: 'CONSENT_REVOKED',
                  actorUserId: actor.id,
                  detail: JSON.stringify({ studentId: row.studentId }),
                  entityId: id,
                  entityType: 'StudentDocument',
                },
              ]
            : []),
          ...(row.documentType === 'CONTRACT'
            ? [
                {
                  action: 'CONTRACT_STATUS_CHANGED',
                  actorUserId: actor.id,
                  detail: JSON.stringify({
                    previousStatus: row.status,
                    status,
                    studentId: row.studentId,
                  }),
                  entityId: id,
                  entityType: 'StudentDocument',
                },
              ]
            : []),
        ],
      });
      return document;
    });
    return summary(updated);
  }

  async attachment(token: string, id: string): Promise<{ mediaId: string } | undefined> {
    const { row } = await this.requireDocument(token, id, false);
    return row.attachmentMediaId ? { mediaId: row.attachmentMediaId } : undefined;
  }

  async removeAttachment(token: string, id: string): Promise<StudentDocumentSummary> {
    const { actor, row } = await this.requireDocument(token, id, true);
    const updated = await this.database.$transaction(async (transaction) => {
      const document = await transaction.studentDocument.update({
        data: { attachmentFileName: null, attachmentMediaId: null, attachmentMimeType: null },
        include: includeDocument,
        where: { id },
      });
      if (row.attachmentMediaId) {
        await transaction.auditLog.create({
          data: {
            action: 'DOCUMENT_ATTACHMENT_REMOVED',
            actorUserId: actor.id,
            detail: JSON.stringify({ studentId: row.studentId }),
            entityId: id,
            entityType: 'StudentDocument',
          },
        });
      }
      return document;
    });
    return summary(updated);
  }
}
