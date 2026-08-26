ALTER TABLE "TrialAppointment" ADD COLUMN "studentId" TEXT;
ALTER TABLE "TrialAppointment" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'BOOKED';
ALTER TABLE "TrialAppointment" ADD COLUMN "outcome" TEXT;
ALTER TABLE "TrialAppointment" ADD COLUMN "cancelledAt" DATETIME;
ALTER TABLE "TrialAppointment" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "TrialAppointment_studentId_supersededAt_idx"
ON "TrialAppointment"("studentId", "supersededAt");
