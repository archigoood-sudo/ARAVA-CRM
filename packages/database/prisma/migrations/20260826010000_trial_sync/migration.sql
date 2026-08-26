DROP TRIGGER IF EXISTS "sync_trial_appointment_insert";
CREATE TRIGGER "sync_trial_appointment_insert"
AFTER INSERT ON "TrialAppointment"
WHEN COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true'
BEGIN
  INSERT INTO "SyncOutbox"
    ("id", "entityType", "entityId", "operation", "idempotencyKey", "baseRevision", "updatedAt")
  VALUES
    (lower(hex(randomblob(16))), 'TRIAL_APPOINTMENT', NEW."id", 'UPSERT', lower(hex(randomblob(16))),
     COALESCE((SELECT "revision" FROM "SyncEntityState"
       WHERE "entityType" = 'TRIAL_APPOINTMENT' AND "entityId" = NEW."id"), 0), CURRENT_TIMESTAMP);
END;

DROP TRIGGER IF EXISTS "sync_trial_appointment_update";
CREATE TRIGGER "sync_trial_appointment_update"
AFTER UPDATE ON "TrialAppointment"
WHEN COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'integration.applyingRemote'), 'false') != 'true'
BEGIN
  INSERT INTO "SyncOutbox"
    ("id", "entityType", "entityId", "operation", "idempotencyKey", "baseRevision", "updatedAt")
  VALUES
    (lower(hex(randomblob(16))), 'TRIAL_APPOINTMENT', NEW."id", 'UPSERT', lower(hex(randomblob(16))),
     COALESCE((SELECT "revision" FROM "SyncEntityState"
       WHERE "entityType" = 'TRIAL_APPOINTMENT' AND "entityId" = NEW."id"), 0), CURRENT_TIMESTAMP);
END;
