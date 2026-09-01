ALTER TABLE "Lesson" ADD COLUMN "payoutCategory" TEXT NOT NULL DEFAULT 'REGULAR_ATTENDANCE';

CREATE TABLE "TrainerPayoutRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "trainerId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "mode" TEXT,
  "amount" INTEGER,
  "percentageBasisPoints" INTEGER,
  "effectiveFrom" DATETIME NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TrainerPayoutRule_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TrainerPayoutRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TrainerPayoutRule_trainerId_category_effectiveFrom_key" ON "TrainerPayoutRule"("trainerId", "category", "effectiveFrom");
CREATE INDEX "TrainerPayoutRule_trainerId_category_effectiveFrom_idx" ON "TrainerPayoutRule"("trainerId", "category", "effectiveFrom");
CREATE INDEX "TrainerPayoutRule_effectiveFrom_idx" ON "TrainerPayoutRule"("effectiveFrom");

ALTER TABLE "PayrollAccrual" ADD COLUMN "payoutCategory" TEXT;
ALTER TABLE "PayrollAccrual" ADD COLUMN "payoutMode" TEXT;
ALTER TABLE "PayrollAccrual" ADD COLUMN "payoutAmount" INTEGER;
ALTER TABLE "PayrollAccrual" ADD COLUMN "payoutPercentageBasisPoints" INTEGER;
ALTER TABLE "PayrollAccrual" ADD COLUMN "payoutRuleId" TEXT;
ALTER TABLE "PayrollAccrual" ADD COLUMN "payoutRuleEffectiveFrom" DATETIME;

DROP INDEX "PayrollAccrual_payrollPeriodId_coachId_lessonId_type_key";
CREATE UNIQUE INDEX "PayrollAccrual_payrollPeriodId_coachId_lessonId_payoutCategory_key" ON "PayrollAccrual"("payrollPeriodId", "coachId", "lessonId", "payoutCategory");
