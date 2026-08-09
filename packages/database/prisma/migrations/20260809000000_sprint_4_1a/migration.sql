UPDATE "User" SET "role" = 'ADMIN' WHERE "role" = 'BRANCH_MANAGER';

ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "securityVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN "recoveryCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "recoveryCodeCreatedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "recoveryFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "recoveryLockedUntil" DATETIME;

ALTER TABLE "Session" ADD COLUMN "securityVersion" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "User_lockedUntil_idx" ON "User"("lockedUntil");
CREATE INDEX "Session_userId_securityVersion_idx" ON "Session"("userId", "securityVersion");
