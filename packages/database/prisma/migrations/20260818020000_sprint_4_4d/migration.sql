CREATE TABLE "Publication" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "audienceMode" TEXT NOT NULL,
  "mediaLocalPath" TEXT,
  "mediaFileName" TEXT,
  "mediaContentType" TEXT,
  "mediaRef" TEXT,
  "publishAt" DATETIME,
  "expiresAt" DATETIME,
  "eventStartsAt" DATETIME,
  "eventLocation" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "archivedAt" DATETIME,
  CONSTRAINT "Publication_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PublicationAudienceTarget" (
  "publicationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  PRIMARY KEY ("publicationId", "type", "targetId"),
  CONSTRAINT "PublicationAudienceTarget_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Publication_status_publishAt_createdAt_idx" ON "Publication"("status", "publishAt", "createdAt");
CREATE INDEX "Publication_createdByUserId_idx" ON "Publication"("createdByUserId");
CREATE INDEX "PublicationAudienceTarget_type_targetId_idx" ON "PublicationAudienceTarget"("type", "targetId");
