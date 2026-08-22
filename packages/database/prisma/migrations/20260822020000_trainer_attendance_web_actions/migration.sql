ALTER TABLE "WebAction" ADD COLUMN "crmTrainerId" TEXT;
ALTER TABLE "WebAction" ADD COLUMN "crmLessonId" TEXT;
ALTER TABLE "WebAction" ADD COLUMN "payloadJson" TEXT;

CREATE INDEX "WebAction_crmTrainerId_idx" ON "WebAction"("crmTrainerId");
CREATE INDEX "WebAction_crmLessonId_idx" ON "WebAction"("crmLessonId");
