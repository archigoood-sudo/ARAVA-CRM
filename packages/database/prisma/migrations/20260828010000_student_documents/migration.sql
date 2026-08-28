CREATE TABLE "StudentDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentDate" DATETIME NOT NULL,
  "status" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "representativeContactId" TEXT,
  "attachmentMediaId" TEXT,
  "attachmentFileName" TEXT,
  "attachmentMimeType" TEXT,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "StudentDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StudentDocument_representativeContactId_fkey" FOREIGN KEY ("representativeContactId") REFERENCES "StudentContact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "StudentContractDetail" (
  "documentId" TEXT NOT NULL PRIMARY KEY,
  "contractNumber" TEXT NOT NULL,
  CONSTRAINT "StudentContractDetail_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StudentDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StudentDocumentStatusHistory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "documentId" TEXT NOT NULL,
  "previousStatus" TEXT,
  "status" TEXT NOT NULL,
  "changedByUserId" TEXT NOT NULL,
  "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentDocumentStatusHistory_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StudentDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ContractNumberSequence" (
  "year" INTEGER NOT NULL PRIMARY KEY,
  "nextNumber" INTEGER NOT NULL,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "StudentDocument_studentId_documentType_documentDate_idx" ON "StudentDocument"("studentId", "documentType", "documentDate");
CREATE INDEX "StudentDocument_representativeContactId_idx" ON "StudentDocument"("representativeContactId");
CREATE UNIQUE INDEX "StudentContractDetail_contractNumber_key" ON "StudentContractDetail"("contractNumber");
CREATE INDEX "StudentDocumentStatusHistory_documentId_changedAt_idx" ON "StudentDocumentStatusHistory"("documentId", "changedAt");
