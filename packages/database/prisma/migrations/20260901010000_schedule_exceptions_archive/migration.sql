ALTER TABLE "Lesson" ADD COLUMN "makeupRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lesson" ADD COLUMN "makeupForLessonId" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "originalStartsAt" DATETIME;
ALTER TABLE "Lesson" ADD COLUMN "originalEndsAt" DATETIME;
ALTER TABLE "Lesson" ADD COLUMN "rescheduledFromRoomId" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "rescheduledFromCoachId" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "rescheduledAt" DATETIME;

CREATE UNIQUE INDEX "Lesson_makeupForLessonId_key" ON "Lesson"("makeupForLessonId");
CREATE INDEX "Lesson_makeupRequired_status_idx" ON "Lesson"("makeupRequired", "status");
