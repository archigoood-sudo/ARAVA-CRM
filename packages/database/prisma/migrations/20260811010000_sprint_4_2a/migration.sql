CREATE TABLE "StudentNote" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "archivedAt" DATETIME,
  CONSTRAINT "StudentNote_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StudentNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "StudentNote_studentId_archivedAt_createdAt_idx" ON "StudentNote"("studentId", "archivedAt", "createdAt");
CREATE INDEX "StudentNote_authorUserId_createdAt_idx" ON "StudentNote"("authorUserId", "createdAt");

ALTER TABLE "StudentContact" ADD COLUMN "archivedAt" DATETIME;
DROP INDEX "StudentContact_studentId_idx";
CREATE INDEX "StudentContact_studentId_archivedAt_idx" ON "StudentContact"("studentId", "archivedAt");
