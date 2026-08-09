ALTER TABLE "Branch" ADD COLUMN "archivedAt" DATETIME;

CREATE TABLE "Room" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "branchId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "capacity" INTEGER,
  "description" TEXT,
  "floor" TEXT,
  "areaSquareMeters" REAL,
  "colorKey" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" DATETIME,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Room_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "WeeklySchedule" ADD COLUMN "roomId" TEXT REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD COLUMN "roomId" TEXT REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "RoomRental" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "branchId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "startAt" DATETIME NOT NULL,
  "endAt" DATETIME NOT NULL,
  "clientName" TEXT,
  "phone" TEXT,
  "amount" INTEGER,
  "comment" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RoomRental_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoomRental_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoomRental_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RoomClosure" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "roomId" TEXT NOT NULL,
  "startAt" DATETIME NOT NULL,
  "endAt" DATETIME NOT NULL,
  "reason" TEXT NOT NULL,
  "comment" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomClosure_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoomClosure_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "CalendarException" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "branchId" TEXT,
  "startAt" DATETIME NOT NULL,
  "endAt" DATETIME NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "comment" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CalendarException_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "TrainerSubstitution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "lessonId" TEXT NOT NULL,
  "originalTrainerId" TEXT,
  "substituteTrainerId" TEXT NOT NULL,
  "reason" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainerSubstitution_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TrainerSubstitution_originalTrainerId_fkey" FOREIGN KEY ("originalTrainerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TrainerSubstitution_substituteTrainerId_fkey" FOREIGN KEY ("substituteTrainerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TrainerSubstitution_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Room_branchId_name_key" ON "Room"("branchId", "name");
CREATE INDEX "Room_branchId_isActive_sortOrder_idx" ON "Room"("branchId", "isActive", "sortOrder");
CREATE INDEX "Room_archivedAt_idx" ON "Room"("archivedAt");
CREATE INDEX "Branch_archivedAt_idx" ON "Branch"("archivedAt");
CREATE INDEX "WeeklySchedule_roomId_weekday_isActive_idx" ON "WeeklySchedule"("roomId", "weekday", "isActive");
CREATE INDEX "Lesson_roomId_startsAt_idx" ON "Lesson"("roomId", "startsAt");
CREATE INDEX "Lesson_groupId_startsAt_idx" ON "Lesson"("groupId", "startsAt");
CREATE INDEX "RoomRental_branchId_startAt_idx" ON "RoomRental"("branchId", "startAt");
CREATE INDEX "RoomRental_roomId_startAt_endAt_idx" ON "RoomRental"("roomId", "startAt", "endAt");
CREATE INDEX "RoomRental_status_startAt_idx" ON "RoomRental"("status", "startAt");
CREATE INDEX "RoomClosure_roomId_startAt_endAt_idx" ON "RoomClosure"("roomId", "startAt", "endAt");
CREATE INDEX "CalendarException_branchId_startAt_endAt_idx" ON "CalendarException"("branchId", "startAt", "endAt");
CREATE INDEX "CalendarException_type_startAt_idx" ON "CalendarException"("type", "startAt");
CREATE UNIQUE INDEX "TrainerSubstitution_lessonId_key" ON "TrainerSubstitution"("lessonId");
CREATE INDEX "TrainerSubstitution_substituteTrainerId_createdAt_idx" ON "TrainerSubstitution"("substituteTrainerId", "createdAt");
