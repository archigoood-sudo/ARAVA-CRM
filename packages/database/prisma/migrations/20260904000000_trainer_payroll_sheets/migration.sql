ALTER TABLE "PayrollPeriod" ADD COLUMN "trainerId" TEXT;
ALTER TABLE "PayrollPeriod" ADD COLUMN "trainerName" TEXT;
ALTER TABLE "PayrollPeriod" ADD COLUMN "sheetNumber" TEXT;
CREATE UNIQUE INDEX "PayrollPeriod_sheetNumber_key" ON "PayrollPeriod"("sheetNumber");
CREATE INDEX "PayrollPeriod_trainerId_dateFrom_dateTo_idx" ON "PayrollPeriod"("trainerId", "dateFrom", "dateTo");

ALTER TABLE "PayrollAccrual" ADD COLUMN "lessonStartsAtSnapshot" DATETIME;
ALTER TABLE "PayrollAccrual" ADD COLUMN "groupNameSnapshot" TEXT;
ALTER TABLE "PayrollAccrual" ADD COLUMN "branchNameSnapshot" TEXT;
ALTER TABLE "PayrollAccrual" ADD COLUMN "manualAddedAt" DATETIME;
ALTER TABLE "PayrollAccrual" ADD COLUMN "manualAddedByUserId" TEXT;
ALTER TABLE "PayrollAccrual" ADD COLUMN "manualAdditionReason" TEXT;

CREATE TABLE "PayrollSheetSequence" (
  "year" INTEGER NOT NULL PRIMARY KEY,
  "nextNumber" INTEGER NOT NULL,
  "updatedAt" DATETIME NOT NULL
);
