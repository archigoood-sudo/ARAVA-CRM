CREATE TABLE "SyncOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "operation" TEXT NOT NULL DEFAULT 'UPSERT',
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "payloadJson" TEXT NOT NULL DEFAULT '{}',
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" DATETIME,
  "lastErrorCode" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "syncedAt" DATETIME
);

CREATE TABLE "SyncLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "outboxId" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "operation" TEXT,
  "result" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "message" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "SyncOutbox_idempotencyKey_key" ON "SyncOutbox"("idempotencyKey");
CREATE INDEX "SyncOutbox_status_nextAttemptAt_createdAt_idx" ON "SyncOutbox"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "SyncOutbox_entityType_entityId_createdAt_idx" ON "SyncOutbox"("entityType", "entityId", "createdAt");
CREATE INDEX "SyncLog_createdAt_idx" ON "SyncLog"("createdAt");
CREATE INDEX "SyncLog_result_createdAt_idx" ON "SyncLog"("result", "createdAt");

CREATE TRIGGER "sync_branch_insert" AFTER INSERT ON "Branch" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'BRANCH', NEW."id", 'UPSERT', lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_branch_update" AFTER UPDATE ON "Branch" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'BRANCH', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL OR NEW."isActive" = false THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_room_insert" AFTER INSERT ON "Room" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'ROOM', NEW."id", 'UPSERT', lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_room_update" AFTER UPDATE ON "Room" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'ROOM', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL OR NEW."isActive" = false THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_trainer_insert" AFTER INSERT ON "User" WHEN NEW."role" = 'COACH' BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'TRAINER', NEW."id", 'UPSERT', lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_trainer_update" AFTER UPDATE ON "User" WHEN OLD."role" = 'COACH' OR NEW."role" = 'COACH' BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'TRAINER', NEW."id", CASE WHEN NEW."role" != 'COACH' OR NEW."isActive" = false THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_group_insert" AFTER INSERT ON "DanceGroup" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'GROUP', NEW."id", 'UPSERT', lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_group_update" AFTER UPDATE ON "DanceGroup" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'GROUP', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL OR NEW."status" = 'ARCHIVED' THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_student_insert" AFTER INSERT ON "Student" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'STUDENT_IDENTITY', NEW."id", 'UPSERT', lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_student_update" AFTER UPDATE ON "Student" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'STUDENT_IDENTITY', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL OR NEW."status" = 'ARCHIVED' THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_enrollment_insert" AFTER INSERT ON "Enrollment" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'GROUP_MEMBERSHIP', NEW."id", 'UPSERT', lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_enrollment_update" AFTER UPDATE ON "Enrollment" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'GROUP_MEMBERSHIP', NEW."id", CASE WHEN NEW."status" = 'LEFT' OR NEW."leftAt" IS NOT NULL THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_schedule_insert" AFTER INSERT ON "WeeklySchedule" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'SCHEDULE', NEW."id", 'UPSERT', lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_schedule_update" AFTER UPDATE ON "WeeklySchedule" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'SCHEDULE', NEW."id", CASE WHEN NEW."isActive" = false THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_lesson_insert" AFTER INSERT ON "Lesson" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'LESSON', NEW."id", 'UPSERT', lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_lesson_update" AFTER UPDATE ON "Lesson" BEGIN
  INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "updatedAt")
  VALUES (lower(hex(randomblob(16))), 'LESSON', NEW."id", CASE WHEN NEW."status" = 'CANCELLED' THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), CURRENT_TIMESTAMP);
END;
