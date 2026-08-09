CREATE TABLE "MembershipCard" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "barcode" TEXT NOT NULL,
  "studentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'FREE',
  "issuedAt" DATETIME,
  "unassignedAt" DATETIME,
  "blockedAt" DATETIME,
  "archivedAt" DATETIME,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MembershipCard_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MembershipCard_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "CardEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "cardId" TEXT NOT NULL,
  "studentId" TEXT,
  "eventType" TEXT NOT NULL,
  "performedByUserId" TEXT,
  "relatedCardId" TEXT,
  "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "comment" TEXT,
  CONSTRAINT "CardEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "MembershipCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CardEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CardEvent_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CardEvent_relatedCardId_fkey" FOREIGN KEY ("relatedCardId") REFERENCES "MembershipCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "CardScanEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "barcode" TEXT NOT NULL,
  "cardId" TEXT,
  "studentId" TEXT,
  "performedByUserId" TEXT,
  "result" TEXT NOT NULL,
  "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardScanEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "MembershipCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CardScanEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CardScanEvent_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MembershipCard_barcode_key" ON "MembershipCard"("barcode");
CREATE UNIQUE INDEX "MembershipCard_studentId_assigned_key" ON "MembershipCard"("studentId") WHERE "status" = 'ASSIGNED';
CREATE INDEX "MembershipCard_studentId_status_idx" ON "MembershipCard"("studentId", "status");
CREATE INDEX "MembershipCard_status_createdAt_idx" ON "MembershipCard"("status", "createdAt");
CREATE INDEX "MembershipCard_createdByUserId_idx" ON "MembershipCard"("createdByUserId");
CREATE INDEX "CardEvent_cardId_occurredAt_idx" ON "CardEvent"("cardId", "occurredAt");
CREATE INDEX "CardEvent_studentId_occurredAt_idx" ON "CardEvent"("studentId", "occurredAt");
CREATE INDEX "CardEvent_performedByUserId_occurredAt_idx" ON "CardEvent"("performedByUserId", "occurredAt");
CREATE INDEX "CardEvent_eventType_occurredAt_idx" ON "CardEvent"("eventType", "occurredAt");
CREATE INDEX "CardScanEvent_barcode_occurredAt_idx" ON "CardScanEvent"("barcode", "occurredAt");
CREATE INDEX "CardScanEvent_cardId_occurredAt_idx" ON "CardScanEvent"("cardId", "occurredAt");
CREATE INDEX "CardScanEvent_studentId_occurredAt_idx" ON "CardScanEvent"("studentId", "occurredAt");
CREATE INDEX "CardScanEvent_performedByUserId_occurredAt_idx" ON "CardScanEvent"("performedByUserId", "occurredAt");
CREATE INDEX "CardScanEvent_result_occurredAt_idx" ON "CardScanEvent"("result", "occurredAt");
