ALTER TABLE "Lesson" ADD COLUMN "attendanceCompletedAt" DATETIME;

CREATE INDEX "Lesson_attendanceCompletedAt_idx" ON "Lesson"("attendanceCompletedAt");
