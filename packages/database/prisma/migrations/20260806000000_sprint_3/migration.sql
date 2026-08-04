CREATE TABLE "Tariff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "branchId" TEXT,
    "type" TEXT NOT NULL,
    "lessonCount" INTEGER,
    "validityDays" INTEGER,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "freezeDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME,
    CONSTRAINT "Tariff_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "purchasedAt" DATETIME NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "expiresAt" DATETIME,
    "lessonLimit" INTEGER,
    "lessonsUsed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "freezeStartedAt" DATETIME,
    "freezeEndsAt" DATETIME,
    "frozenDaysUsed" INTEGER NOT NULL DEFAULT 0,
    "salePrice" INTEGER NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Subscription_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Subscription_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Subscription_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "branchId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "paidAt" DATETIME NOT NULL,
    "comment" TEXT,
    "externalReference" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refundedAt" DATETIME NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Refund_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SubscriptionLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT,
    "attendanceId" TEXT,
    "type" TEXT NOT NULL,
    "lessonDelta" INTEGER NOT NULL DEFAULT 0,
    "amountDelta" INTEGER,
    "comment" TEXT,
    "createdByUserId" TEXT,
    "reversesLedgerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionLedger_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionLedger_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionLedger_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionLedger_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionLedger_reversesLedgerId_fkey" FOREIGN KEY ("reversesLedgerId") REFERENCES "SubscriptionLedger" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Tariff_branchId_isActive_idx" ON "Tariff"("branchId", "isActive");
CREATE INDEX "Tariff_type_isActive_idx" ON "Tariff"("type", "isActive");
CREATE INDEX "Tariff_name_idx" ON "Tariff"("name");
CREATE INDEX "Tariff_archivedAt_idx" ON "Tariff"("archivedAt");
CREATE INDEX "Subscription_studentId_status_idx" ON "Subscription"("studentId", "status");
CREATE INDEX "Subscription_branchId_status_idx" ON "Subscription"("branchId", "status");
CREATE INDEX "Subscription_tariffId_idx" ON "Subscription"("tariffId");
CREATE INDEX "Subscription_startsAt_expiresAt_idx" ON "Subscription"("startsAt", "expiresAt");
CREATE INDEX "Subscription_createdByUserId_idx" ON "Subscription"("createdByUserId");
CREATE INDEX "Payment_studentId_paidAt_idx" ON "Payment"("studentId", "paidAt");
CREATE INDEX "Payment_subscriptionId_idx" ON "Payment"("subscriptionId");
CREATE INDEX "Payment_branchId_paidAt_idx" ON "Payment"("branchId", "paidAt");
CREATE INDEX "Payment_paymentMethod_paidAt_idx" ON "Payment"("paymentMethod", "paidAt");
CREATE INDEX "Payment_status_paidAt_idx" ON "Payment"("status", "paidAt");
CREATE INDEX "Payment_createdByUserId_paidAt_idx" ON "Payment"("createdByUserId", "paidAt");
CREATE INDEX "Payment_externalReference_idx" ON "Payment"("externalReference");
CREATE INDEX "Refund_paymentId_refundedAt_idx" ON "Refund"("paymentId", "refundedAt");
CREATE INDEX "Refund_createdByUserId_refundedAt_idx" ON "Refund"("createdByUserId", "refundedAt");
CREATE UNIQUE INDEX "SubscriptionLedger_reversesLedgerId_key" ON "SubscriptionLedger"("reversesLedgerId");
CREATE INDEX "SubscriptionLedger_subscriptionId_createdAt_idx" ON "SubscriptionLedger"("subscriptionId", "createdAt");
CREATE INDEX "SubscriptionLedger_studentId_createdAt_idx" ON "SubscriptionLedger"("studentId", "createdAt");
CREATE INDEX "SubscriptionLedger_lessonId_idx" ON "SubscriptionLedger"("lessonId");
CREATE INDEX "SubscriptionLedger_attendanceId_type_idx" ON "SubscriptionLedger"("attendanceId", "type");
CREATE INDEX "SubscriptionLedger_createdByUserId_idx" ON "SubscriptionLedger"("createdByUserId");
