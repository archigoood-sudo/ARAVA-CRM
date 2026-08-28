import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeDatabase,
  createDatabaseClient,
  initializeDatabase,
  INITIAL_OWNER_EMAIL,
  INITIAL_OWNER_PASSWORD,
  toSqliteUrl,
  type DatabaseClient,
} from './index';
import { ApplicationService } from './services';
import { StudentDocumentService } from './student-document-service';

describe('Sprint 5.3A student documents', () => {
  let application: ApplicationService;
  let database: DatabaseClient;
  let directory: string;
  let documents: StudentDocumentService;
  let ownerToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arava-documents-'));
    database = createDatabaseClient(
      `${toSqliteUrl(join(directory, 'arava.db'))}?connection_limit=1`,
    );
    await initializeDatabase(database);
    application = new ApplicationService(database);
    documents = new StudentDocumentService(database, application);
    ownerToken = (
      await application.login({ email: INITIAL_OWNER_EMAIL, password: INITIAL_OWNER_PASSWORD })
    ).token;
    await application.changePassword(ownerToken, {
      currentPassword: INITIAL_OWNER_PASSWORD,
      newPassword: 'Owner!Documents2026',
    });
  });

  afterEach(async () => {
    await closeDatabase(database);
    await rm(directory, { force: true, recursive: true });
  });

  async function fixture() {
    const branch = await application.createBranch(ownerToken, { name: 'Документы' });
    const otherBranch = await application.createBranch(ownerToken, { name: 'Другой филиал' });
    const student = await application.createStudent(ownerToken, {
      branchId: branch.id,
      firstName: 'Лев',
      lastName: 'Документов',
      status: 'ACTIVE',
    });
    const contact = await application.createContact(ownerToken, student.id, {
      fullName: 'Анна Документова',
      isPrimary: true,
      phone: '+79990000001',
      relationship: 'Мама',
      whatsapp: false,
    });
    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'documents-admin@arava.local',
      fullName: 'Администратор Документов',
      password: 'Admin!Documents2026',
      role: 'ADMIN',
    });
    await application.createUser(ownerToken, {
      branchIds: [branch.id],
      email: 'documents-coach@arava.local',
      fullName: 'Тренер Документов',
      password: 'Coach!Documents2026',
      role: 'COACH',
    });
    return { branch, contact, otherBranch, student };
  }

  it('creates unique readable generated contract numbers and rejects duplicate legacy numbers', async () => {
    const { student } = await fixture();
    const [first, second] = await Promise.all([
      documents.create(ownerToken, student.id, {
        documentDate: '2026-08-28',
        documentType: 'CONTRACT',
        source: 'GENERATED',
        status: 'ACTIVE',
      }),
      documents.create(ownerToken, student.id, {
        documentDate: '2026-08-28',
        documentType: 'CONTRACT',
        source: 'GENERATED',
        status: 'ACTIVE',
      }),
    ]);
    expect(new Set([first.contractNumber, second.contractNumber]).size).toBe(2);
    expect(first.contractNumber).toMatch(/^26-\d{4}$/u);
    const existing = await documents.create(ownerToken, student.id, {
      contractNumber: 'OLD-2024-17',
      documentDate: '2024-05-10',
      documentType: 'CONTRACT',
      source: 'EXISTING',
      status: 'COMPLETED',
    });
    expect(existing).toMatchObject({ contractNumber: 'OLD-2024-17', source: 'EXISTING' });
    await expect(
      documents.create(ownerToken, student.id, {
        contractNumber: 'OLD-2024-17',
        documentDate: '2024-05-10',
        documentType: 'CONTRACT',
        source: 'EXISTING',
        status: 'ACTIVE',
      }),
    ).rejects.toThrow('Такой номер договора уже используется');
  });

  it('keeps personal and media consents independent and preserves revoke history', async () => {
    const { contact, student } = await fixture();
    const personal = await documents.create(ownerToken, student.id, {
      documentDate: '2026-08-28',
      documentType: 'PERSONAL_DATA_CONSENT',
      representativeContactId: contact.id,
      source: 'EXISTING',
      status: 'CONSENTED',
    });
    const media = await documents.create(ownerToken, student.id, {
      documentDate: '2026-08-28',
      documentType: 'MEDIA_CONSENT',
      source: 'EXISTING',
      status: 'NOT_ALLOWED',
    });
    expect(personal).toMatchObject({ representativeName: 'Анна Документова', status: 'CONSENTED' });
    expect(media.status).toBe('NOT_ALLOWED');
    const revoked = await documents.changeStatus(ownerToken, personal.id, 'REVOKED');
    expect(revoked.statusHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ previousStatus: 'CONSENTED', status: 'REVOKED' }),
        expect.objectContaining({ status: 'CONSENTED' }),
      ]),
    );
    expect(
      (await documents.list(ownerToken, student.id)).find(({ id }) => id === media.id)?.status,
    ).toBe('NOT_ALLOWED');
    expect(
      await database.auditLog.count({
        where: { action: 'CONSENT_REVOKED', entityId: personal.id },
      }),
    ).toBe(1);
  });

  it('persists existing records with or without attachments across a database restart', async () => {
    const { student } = await fixture();
    await documents.create(ownerToken, student.id, {
      attachment: {
        fileName: 'scan.pdf',
        mediaId: '00000000-0000-0000-0000-000000000001.pdf',
        mimeType: 'application/pdf',
      },
      documentDate: '2026-08-28',
      documentType: 'MEDIA_CONSENT',
      source: 'EXISTING',
      status: 'NOT_ALLOWED',
    });
    await documents.create(ownerToken, student.id, {
      documentDate: '2026-08-28',
      documentType: 'PERSONAL_DATA_CONSENT',
      source: 'EXISTING',
      status: 'NOT_PROVIDED',
    });
    await closeDatabase(database);
    database = createDatabaseClient(
      `${toSqliteUrl(join(directory, 'arava.db'))}?connection_limit=1`,
    );
    await initializeDatabase(database);
    application = new ApplicationService(database);
    documents = new StudentDocumentService(database, application);
    ownerToken = (
      await application.login({ email: INITIAL_OWNER_EMAIL, password: 'Owner!Documents2026' })
    ).token;
    const restored = await documents.list(ownerToken, student.id);
    expect(restored).toHaveLength(2);
    expect(
      restored.find(({ documentType }) => documentType === 'MEDIA_CONSENT')?.attachment?.fileName,
    ).toBe('scan.pdf');
  });

  it('enforces branch scope and denies COACH document DTO access', async () => {
    const { otherBranch, student } = await fixture();
    const adminToken = (
      await application.login({
        email: 'documents-admin@arava.local',
        password: 'Admin!Documents2026',
      })
    ).token;
    await application.changePassword(adminToken, {
      currentPassword: 'Admin!Documents2026',
      newPassword: 'Admin!DocumentsReady2026',
    });
    const coachToken = (
      await application.login({
        email: 'documents-coach@arava.local',
        password: 'Coach!Documents2026',
      })
    ).token;
    await application.changePassword(coachToken, {
      currentPassword: 'Coach!Documents2026',
      newPassword: 'Coach!DocumentsReady2026',
    });
    await expect(documents.list(adminToken, student.id)).resolves.toEqual([]);
    await expect(documents.list(coachToken, student.id)).rejects.toThrow('недостаточно прав');
    const hidden = await application.createStudent(ownerToken, {
      branchId: otherBranch.id,
      firstName: 'Закрытый',
      lastName: 'Ученик',
      status: 'ACTIVE',
    });
    await expect(documents.list(adminToken, hidden.id)).rejects.toThrow('нет доступа');
  });
});
