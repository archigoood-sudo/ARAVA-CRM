CREATE TABLE "PaymentOperation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "idempotencyKey" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "branchId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "purpose" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CREATED',
  "providerType" TEXT NOT NULL DEFAULT 'NONE',
  "providerOperationId" TEXT,
  "paymentId" TEXT,
  "completedAt" DATETIME,
  "failureReason" TEXT,
  "cancellationReason" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PaymentOperation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentOperation_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentOperation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentOperation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentOperation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PaymentOperation_idempotencyKey_key" ON "PaymentOperation"("idempotencyKey");
CREATE UNIQUE INDEX "PaymentOperation_paymentId_key" ON "PaymentOperation"("paymentId");
CREATE UNIQUE INDEX "PaymentOperation_providerType_providerOperationId_key" ON "PaymentOperation"("providerType", "providerOperationId");
CREATE INDEX "PaymentOperation_studentId_createdAt_idx" ON "PaymentOperation"("studentId", "createdAt");
CREATE INDEX "PaymentOperation_subscriptionId_createdAt_idx" ON "PaymentOperation"("subscriptionId", "createdAt");
CREATE INDEX "PaymentOperation_branchId_status_createdAt_idx" ON "PaymentOperation"("branchId", "status", "createdAt");
CREATE INDEX "PaymentOperation_status_updatedAt_idx" ON "PaymentOperation"("status", "updatedAt");
CREATE INDEX "PaymentOperation_createdByUserId_createdAt_idx" ON "PaymentOperation"("createdByUserId", "createdAt");
