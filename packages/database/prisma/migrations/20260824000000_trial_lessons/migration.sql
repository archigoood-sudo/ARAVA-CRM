CREATE TABLE "TrialAppointment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "externalLeadId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "lessonId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "supersededAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TrialAppointment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DanceGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TrialAppointment_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TrialAppointment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TrialAppointment_externalLeadId_lessonId_key" ON "TrialAppointment"("externalLeadId", "lessonId");
CREATE INDEX "TrialAppointment_externalLeadId_supersededAt_idx" ON "TrialAppointment"("externalLeadId", "supersededAt");
CREATE INDEX "TrialAppointment_lessonId_supersededAt_idx" ON "TrialAppointment"("lessonId", "supersededAt");
CREATE INDEX "TrialAppointment_groupId_supersededAt_idx" ON "TrialAppointment"("groupId", "supersededAt");
CREATE INDEX "TrialAppointment_createdByUserId_idx" ON "TrialAppointment"("createdByUserId");
