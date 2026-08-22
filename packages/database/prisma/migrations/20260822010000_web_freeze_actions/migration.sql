CREATE TABLE "WebAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "externalActionId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "crmStudentId" TEXT,
  "crmSubscriptionId" TEXT,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" DATETIME,
  "processedAt" DATETIME,
  "processedByUserId" TEXT,
  "safeResultJson" TEXT,
  "safeError" TEXT,
  "completionAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextCompletionAttemptAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "WebAction_externalActionId_key" ON "WebAction"("externalActionId");
CREATE INDEX "WebAction_status_receivedAt_idx" ON "WebAction"("status", "receivedAt");
CREATE INDEX "WebAction_crmStudentId_idx" ON "WebAction"("crmStudentId");
CREATE INDEX "WebAction_crmSubscriptionId_idx" ON "WebAction"("crmSubscriptionId");
CREATE INDEX "WebAction_nextCompletionAttemptAt_idx" ON "WebAction"("nextCompletionAttemptAt");
