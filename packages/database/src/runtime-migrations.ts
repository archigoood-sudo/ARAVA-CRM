export interface RuntimeMigration {
  id: string;
  statements: readonly string[];
}

export const runtimeMigrations: readonly RuntimeMigration[] = [
  {
    id: '20260803000000_initial',
    statements: [
      `CREATE TABLE "Contact" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "firstName" TEXT NOT NULL,
        "lastName" TEXT NOT NULL,
        "email" TEXT,
        "phone" TEXT,
        "status" TEXT NOT NULL DEFAULT 'lead',
        "companyId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`,
      `CREATE TABLE "Company" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "website" TEXT,
        "industry" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )`,
      `CREATE TABLE "Opportunity" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "value" INTEGER NOT NULL DEFAULT 0,
        "stage" TEXT NOT NULL DEFAULT 'lead',
        "companyId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "Opportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`,
      `CREATE TABLE "ActivityEvent" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "detail" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE "AppSetting" (
        "key" TEXT NOT NULL PRIMARY KEY,
        "value" TEXT NOT NULL,
        "updatedAt" DATETIME NOT NULL
      )`,
      'CREATE UNIQUE INDEX "Contact_email_key" ON "Contact"("email")',
      'CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId")',
      'CREATE INDEX "Contact_status_idx" ON "Contact"("status")',
      'CREATE INDEX "Company_name_idx" ON "Company"("name")',
      'CREATE INDEX "Opportunity_companyId_idx" ON "Opportunity"("companyId")',
      'CREATE INDEX "Opportunity_stage_idx" ON "Opportunity"("stage")',
      'CREATE INDEX "ActivityEvent_createdAt_idx" ON "ActivityEvent"("createdAt")',
    ],
  },
  {
    id: '20260804000000_sprint_1',
    statements: [
      `CREATE TABLE "User" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "email" TEXT NOT NULL,
        "fullName" TEXT NOT NULL,
        "passwordHash" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )`,
      `CREATE TABLE "Session" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "tokenHash" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "expiresAt" DATETIME NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE TABLE "Branch" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "address" TEXT NOT NULL,
        "phone" TEXT NOT NULL,
        "description" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )`,
      `CREATE TABLE "UserBranch" (
        "userId" TEXT NOT NULL,
        "branchId" TEXT NOT NULL,
        CONSTRAINT "UserBranch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "UserBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        PRIMARY KEY ("userId", "branchId")
      )`,
      `CREATE TABLE "Student" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "firstName" TEXT NOT NULL,
        "lastName" TEXT NOT NULL,
        "middleName" TEXT,
        "birthDate" DATETIME,
        "gender" TEXT,
        "phone" TEXT,
        "email" TEXT,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "branchId" TEXT NOT NULL,
        "notes" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "archivedAt" DATETIME,
        CONSTRAINT "Student_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )`,
      `CREATE TABLE "StudentContact" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "studentId" TEXT NOT NULL,
        "fullName" TEXT NOT NULL,
        "relationship" TEXT NOT NULL,
        "phone" TEXT NOT NULL,
        "secondaryPhone" TEXT,
        "email" TEXT,
        "telegram" TEXT,
        "whatsapp" BOOLEAN NOT NULL DEFAULT false,
        "isPrimary" BOOLEAN NOT NULL DEFAULT false,
        "notes" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "StudentContact_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      'CREATE UNIQUE INDEX "User_email_key" ON "User"("email")',
      'CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive")',
      'CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash")',
      'CREATE INDEX "Session_userId_idx" ON "Session"("userId")',
      'CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt")',
      'CREATE INDEX "Branch_name_idx" ON "Branch"("name")',
      'CREATE INDEX "Branch_isActive_idx" ON "Branch"("isActive")',
      'CREATE INDEX "UserBranch_branchId_idx" ON "UserBranch"("branchId")',
      'CREATE INDEX "Student_branchId_status_idx" ON "Student"("branchId", "status")',
      'CREATE INDEX "Student_lastName_firstName_idx" ON "Student"("lastName", "firstName")',
      'CREATE INDEX "Student_phone_idx" ON "Student"("phone")',
      'CREATE INDEX "Student_archivedAt_idx" ON "Student"("archivedAt")',
      'CREATE INDEX "StudentContact_studentId_idx" ON "StudentContact"("studentId")',
      'CREATE INDEX "StudentContact_studentId_isPrimary_idx" ON "StudentContact"("studentId", "isPrimary")',
      'CREATE INDEX "StudentContact_phone_idx" ON "StudentContact"("phone")',
      'CREATE UNIQUE INDEX "StudentContact_one_primary_key" ON "StudentContact"("studentId") WHERE "isPrimary" = true',
    ],
  },
];
