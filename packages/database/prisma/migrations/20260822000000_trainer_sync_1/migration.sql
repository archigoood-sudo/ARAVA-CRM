ALTER TABLE "User" ADD COLUMN "trainerDescription" TEXT;

DROP TRIGGER IF EXISTS "sync_group_insert";
CREATE TRIGGER "sync_group_insert" AFTER INSERT ON "DanceGroup"
WHEN COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true'
BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'GROUP', NEW."id", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='GROUP' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);

  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  SELECT lower(hex(randomblob(16))), 'TRAINER', NEW."coachId", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='TRAINER' AND "entityId"=NEW."coachId"),0), CURRENT_TIMESTAMP
  WHERE NEW."coachId" IS NOT NULL;
END;

DROP TRIGGER IF EXISTS "sync_group_update";
CREATE TRIGGER "sync_group_update" AFTER UPDATE ON "DanceGroup"
WHEN COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true'
BEGIN
  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  VALUES (lower(hex(randomblob(16))), 'GROUP', NEW."id", CASE WHEN NEW."archivedAt" IS NOT NULL OR NEW."status" = 'ARCHIVED' THEN 'ARCHIVE' ELSE 'UPSERT' END, lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='GROUP' AND "entityId"=NEW."id"),0), CURRENT_TIMESTAMP);

  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  SELECT lower(hex(randomblob(16))), 'TRAINER', OLD."coachId", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='TRAINER' AND "entityId"=OLD."coachId"),0), CURRENT_TIMESTAMP
  WHERE OLD."coachId" IS NOT NULL
    AND (OLD."coachId" IS NOT NEW."coachId" OR OLD."direction" IS NOT NEW."direction" OR OLD."archivedAt" IS NOT NEW."archivedAt" OR OLD."status" IS NOT NEW."status");

  INSERT INTO "SyncOutbox" ("id","entityType","entityId","operation","idempotencyKey","baseRevision","updatedAt")
  SELECT lower(hex(randomblob(16))), 'TRAINER', NEW."coachId", 'UPSERT', lower(hex(randomblob(16))), COALESCE((SELECT "revision" FROM "SyncEntityState" WHERE "entityType"='TRAINER' AND "entityId"=NEW."coachId"),0), CURRENT_TIMESTAMP
  WHERE NEW."coachId" IS NOT NULL
    AND NEW."coachId" IS NOT OLD."coachId";
END;
