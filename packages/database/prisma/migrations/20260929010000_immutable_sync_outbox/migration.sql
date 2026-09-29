ALTER TABLE "SyncOutbox" ADD COLUMN "envelopeJson" TEXT;

INSERT INTO "SyncOutbox" ("id", "entityType", "entityId", "operation", "idempotencyKey", "baseRevision", "updatedAt")
SELECT lower(hex(randomblob(16))), 'SUBSCRIPTION', "entityId", 'UPSERT', lower(hex(randomblob(16))), MAX("baseRevision"), CURRENT_TIMESTAMP
FROM "SyncOutbox" WHERE "entityType" = 'SUBSCRIPTION' AND "status" IN ('PENDING', 'PROCESSING') AND ("lastAttemptAt" IS NOT NULL OR "attemptCount" > 0)
GROUP BY "entityId";

UPDATE "SyncOutbox" SET "status" = CASE WHEN "entityType" = 'SUBSCRIPTION' THEN 'SUPERSEDED' ELSE 'FAILED' END,
"syncedAt" = NULL, "lastErrorCode" = 'LEGACY_ENVELOPE_UNAVAILABLE'
WHERE "entityType" NOT IN ('CHAT_MESSAGE', 'ATTENDANCE_CHECKIN') AND "status" IN ('PENDING', 'PROCESSING') AND ("lastAttemptAt" IS NOT NULL OR "attemptCount" > 0);

CREATE TRIGGER "sync_outbox_envelope_immutable" BEFORE UPDATE ON "SyncOutbox"
WHEN OLD."envelopeJson" IS NOT NULL AND (NEW."envelopeJson" IS NOT OLD."envelopeJson" OR NEW."idempotencyKey" IS NOT OLD."idempotencyKey")
BEGIN SELECT RAISE(ABORT, 'SYNC_ENVELOPE_IMMUTABLE'); END;

UPDATE "SyncOutbox" SET "status" = 'CONFLICT', "syncedAt" = NULL
WHERE "status" = 'SYNCED' AND "lastErrorCode" = 'SYNC_CONFLICT';
