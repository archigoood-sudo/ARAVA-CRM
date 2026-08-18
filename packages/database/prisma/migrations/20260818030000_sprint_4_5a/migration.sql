ALTER TABLE "SyncOutbox" ADD COLUMN "baseRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SyncEntityState" (
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "serverSequence" INTEGER NOT NULL,
  "sourceDeviceId" TEXT NOT NULL,
  "serverUpdatedAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  PRIMARY KEY ("entityType", "entityId")
);
CREATE INDEX "SyncEntityState_serverSequence_idx" ON "SyncEntityState"("serverSequence");

CREATE TABLE "SyncConflict" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "serverConflictId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "baseRevision" INTEGER NOT NULL,
  "canonicalRevision" INTEGER NOT NULL,
  "canonicalOperation" TEXT NOT NULL,
  "canonicalPayloadJson" TEXT NOT NULL,
  "candidateOperation" TEXT NOT NULL,
  "candidatePayloadJson" TEXT NOT NULL,
  "sourceDeviceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" DATETIME
);
CREATE UNIQUE INDEX "SyncConflict_serverConflictId_key" ON "SyncConflict"("serverConflictId");
CREATE INDEX "SyncConflict_status_createdAt_idx" ON "SyncConflict"("status","createdAt");
CREATE INDEX "SyncConflict_entityType_entityId_status_idx" ON "SyncConflict"("entityType","entityId","status");

DROP TRIGGER IF EXISTS "sync_branch_insert";
CREATE TRIGGER "sync_branch_insert" AFTER INSERT ON "Branch" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'BRANCH', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='BRANCH' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_branch_update";
CREATE TRIGGER "sync_branch_update" AFTER UPDATE ON "Branch" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'BRANCH', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='BRANCH' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_room_insert";
CREATE TRIGGER "sync_room_insert" AFTER INSERT ON "Room" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'ROOM', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='ROOM' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_room_update";
CREATE TRIGGER "sync_room_update" AFTER UPDATE ON "Room" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'ROOM', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='ROOM' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_trainer_insert";
CREATE TRIGGER "sync_trainer_insert" AFTER INSERT ON "User" WHEN (NEW."role" = 'COACH') AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'TRAINER', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='TRAINER' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_trainer_update";
CREATE TRIGGER "sync_trainer_update" AFTER UPDATE ON "User" WHEN (OLD."role" = 'COACH' OR NEW."role" = 'COACH') AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'TRAINER', NEW."id", CASE WHEN NEW."role" != 'COACH' THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='TRAINER' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_group_insert";
CREATE TRIGGER "sync_group_insert" AFTER INSERT ON "DanceGroup" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'GROUP', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='GROUP' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_group_update";
CREATE TRIGGER "sync_group_update" AFTER UPDATE ON "DanceGroup" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'GROUP', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL OR NEW."status" = 'ARCHIVED' THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='GROUP' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_student_insert";
CREATE TRIGGER "sync_student_insert" AFTER INSERT ON "Student" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'STUDENT_IDENTITY', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='STUDENT_IDENTITY' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_student_update";
CREATE TRIGGER "sync_student_update" AFTER UPDATE ON "Student" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'STUDENT_IDENTITY', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL OR NEW."status" = 'ARCHIVED' THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='STUDENT_IDENTITY' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_student_contact_insert";
CREATE TRIGGER "sync_student_contact_insert" AFTER INSERT ON "StudentContact" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'STUDENT_CONTACT', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='STUDENT_CONTACT' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_student_contact_update";
CREATE TRIGGER "sync_student_contact_update" AFTER UPDATE ON "StudentContact" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'STUDENT_CONTACT', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='STUDENT_CONTACT' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_enrollment_insert";
CREATE TRIGGER "sync_enrollment_insert" AFTER INSERT ON "Enrollment" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'GROUP_MEMBERSHIP', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='GROUP_MEMBERSHIP' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_enrollment_update";
CREATE TRIGGER "sync_enrollment_update" AFTER UPDATE ON "Enrollment" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'GROUP_MEMBERSHIP', NEW."id", CASE WHEN NEW."status" = 'LEFT' OR NEW."leftAt" IS NOT NULL THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='GROUP_MEMBERSHIP' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_schedule_insert";
CREATE TRIGGER "sync_schedule_insert" AFTER INSERT ON "WeeklySchedule" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'SCHEDULE', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='SCHEDULE' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_schedule_update";
CREATE TRIGGER "sync_schedule_update" AFTER UPDATE ON "WeeklySchedule" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'SCHEDULE', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='SCHEDULE' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_lesson_insert";
CREATE TRIGGER "sync_lesson_insert" AFTER INSERT ON "Lesson" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'LESSON', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='LESSON' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_lesson_update";
CREATE TRIGGER "sync_lesson_update" AFTER UPDATE ON "Lesson" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'LESSON', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='LESSON' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_substitution_insert";
CREATE TRIGGER "sync_substitution_insert" AFTER INSERT ON "TrainerSubstitution" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'SUBSTITUTION', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='SUBSTITUTION' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_card_insert";
CREATE TRIGGER "sync_card_insert" AFTER INSERT ON "MembershipCard" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'CARD', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='CARD' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_card_update";
CREATE TRIGGER "sync_card_update" AFTER UPDATE ON "MembershipCard" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'CARD', NEW."id", CASE WHEN NEW."status" = 'ARCHIVED' OR NEW."archivedAt" IS NOT NULL THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='CARD' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_tariff_insert";
CREATE TRIGGER "sync_tariff_insert" AFTER INSERT ON "Tariff" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'TARIFF', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='TARIFF' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_tariff_update";
CREATE TRIGGER "sync_tariff_update" AFTER UPDATE ON "Tariff" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'TARIFF', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='TARIFF' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_subscription_insert";
CREATE TRIGGER "sync_subscription_insert" AFTER INSERT ON "Subscription" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'SUBSCRIPTION', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='SUBSCRIPTION' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_subscription_update";
CREATE TRIGGER "sync_subscription_update" AFTER UPDATE ON "Subscription" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'SUBSCRIPTION', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='SUBSCRIPTION' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_ledger_insert";
CREATE TRIGGER "sync_ledger_insert" AFTER INSERT ON "SubscriptionLedger" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'SUBSCRIPTION_LEDGER', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='SUBSCRIPTION_LEDGER' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_attendance_insert";
CREATE TRIGGER "sync_attendance_insert" AFTER INSERT ON "Attendance" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'ATTENDANCE', NEW."lessonId" || ':' || NEW."studentId", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='ATTENDANCE' AND "entityId"=(NEW."lessonId" || ':' || NEW."studentId")),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_attendance_update";
CREATE TRIGGER "sync_attendance_update" AFTER UPDATE ON "Attendance" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'ATTENDANCE', NEW."lessonId" || ':' || NEW."studentId", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='ATTENDANCE' AND "entityId"=(NEW."lessonId" || ':' || NEW."studentId")),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_student_note_insert";
CREATE TRIGGER "sync_student_note_insert" AFTER INSERT ON "StudentNote" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'STUDENT_NOTE', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='STUDENT_NOTE' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_student_note_update";
CREATE TRIGGER "sync_student_note_update" AFTER UPDATE ON "StudentNote" WHEN (1=1) AND COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true' BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'STUDENT_NOTE', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='STUDENT_NOTE' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);
END;
