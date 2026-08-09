CREATE TABLE "ExpenseCategory" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "branchId" TEXT,
  "description" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  "archivedAt" DATETIME,
  CONSTRAINT "ExpenseCategory_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "Expense" (
  "id" TEXT NOT NULL PRIMARY KEY, "branchId" TEXT NOT NULL, "categoryId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL, "spentAt" DATETIME NOT NULL, "paymentMethod" TEXT NOT NULL,
  "vendor" TEXT, "description" TEXT NOT NULL, "documentNumber" TEXT, "attachmentPath" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT', "createdByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Expense_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Expense_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "CashRegister" (
  "id" TEXT NOT NULL PRIMARY KEY, "branchId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "type" TEXT NOT NULL, "openingBalance" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CashRegister_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "CashTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY, "cashRegisterId" TEXT NOT NULL, "branchId" TEXT NOT NULL,
  "type" TEXT NOT NULL, "amount" INTEGER NOT NULL, "sourceType" TEXT NOT NULL,
  "sourceId" TEXT, "occurredAt" DATETIME NOT NULL, "comment" TEXT,
  "createdByUserId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashTransaction_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "CashRegister" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashTransaction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashTransaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "PayrollRule" (
  "id" TEXT NOT NULL PRIMARY KEY, "coachId" TEXT NOT NULL, "branchId" TEXT NOT NULL,
  "groupId" TEXT, "type" TEXT NOT NULL, "fixedAmount" INTEGER, "amountPerAttendee" INTEGER,
  "percent" REAL, "monthlyAmount" INTEGER, "validFrom" DATETIME NOT NULL, "validTo" DATETIME,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PayrollRule_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollRule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DanceGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "PayrollPeriod" (
  "id" TEXT NOT NULL PRIMARY KEY, "dateFrom" DATETIME NOT NULL, "dateTo" DATETIME NOT NULL,
  "branchId" TEXT, "status" TEXT NOT NULL DEFAULT 'DRAFT', "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PayrollPeriod_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollPeriod_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollPeriod_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "PayrollAccrual" (
  "id" TEXT NOT NULL PRIMARY KEY, "payrollPeriodId" TEXT NOT NULL, "coachId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL, "groupId" TEXT, "lessonId" TEXT, "type" TEXT NOT NULL,
  "baseAmount" INTEGER NOT NULL, "attendeeCount" INTEGER, "revenueBase" INTEGER,
  "calculatedAmount" INTEGER NOT NULL, "manualAdjustment" INTEGER NOT NULL DEFAULT 0,
  "finalAmount" INTEGER NOT NULL, "comment" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollAccrual_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollAccrual_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollAccrual_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollAccrual_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DanceGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollAccrual_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ExpenseCategory_branchId_isActive_idx" ON "ExpenseCategory"("branchId", "isActive");
CREATE INDEX "ExpenseCategory_name_idx" ON "ExpenseCategory"("name");
CREATE INDEX "ExpenseCategory_archivedAt_idx" ON "ExpenseCategory"("archivedAt");
CREATE INDEX "Expense_branchId_spentAt_idx" ON "Expense"("branchId", "spentAt");
CREATE INDEX "Expense_categoryId_spentAt_idx" ON "Expense"("categoryId", "spentAt");
CREATE INDEX "Expense_status_spentAt_idx" ON "Expense"("status", "spentAt");
CREATE INDEX "Expense_paymentMethod_spentAt_idx" ON "Expense"("paymentMethod", "spentAt");
CREATE INDEX "Expense_createdByUserId_spentAt_idx" ON "Expense"("createdByUserId", "spentAt");
CREATE INDEX "Expense_documentNumber_idx" ON "Expense"("documentNumber");
CREATE INDEX "CashRegister_branchId_isActive_idx" ON "CashRegister"("branchId", "isActive");
CREATE INDEX "CashRegister_type_isActive_idx" ON "CashRegister"("type", "isActive");
CREATE INDEX "CashTransaction_cashRegisterId_occurredAt_idx" ON "CashTransaction"("cashRegisterId", "occurredAt");
CREATE INDEX "CashTransaction_branchId_occurredAt_idx" ON "CashTransaction"("branchId", "occurredAt");
CREATE INDEX "CashTransaction_sourceType_sourceId_idx" ON "CashTransaction"("sourceType", "sourceId");
CREATE INDEX "CashTransaction_createdByUserId_occurredAt_idx" ON "CashTransaction"("createdByUserId", "occurredAt");
CREATE INDEX "PayrollRule_coachId_branchId_groupId_isActive_idx" ON "PayrollRule"("coachId", "branchId", "groupId", "isActive");
CREATE INDEX "PayrollRule_validFrom_validTo_idx" ON "PayrollRule"("validFrom", "validTo");
CREATE INDEX "PayrollPeriod_branchId_dateFrom_dateTo_idx" ON "PayrollPeriod"("branchId", "dateFrom", "dateTo");
CREATE INDEX "PayrollPeriod_status_dateFrom_idx" ON "PayrollPeriod"("status", "dateFrom");
CREATE UNIQUE INDEX "PayrollAccrual_payrollPeriodId_coachId_lessonId_type_key" ON "PayrollAccrual"("payrollPeriodId", "coachId", "lessonId", "type");
CREATE INDEX "PayrollAccrual_payrollPeriodId_coachId_idx" ON "PayrollAccrual"("payrollPeriodId", "coachId");
CREATE INDEX "PayrollAccrual_branchId_coachId_idx" ON "PayrollAccrual"("branchId", "coachId");
CREATE INDEX "PayrollAccrual_lessonId_idx" ON "PayrollAccrual"("lessonId");
