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
];
