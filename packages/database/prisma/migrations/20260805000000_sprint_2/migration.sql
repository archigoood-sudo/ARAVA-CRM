CREATE TABLE "DanceGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "ageFrom" INTEGER,
    "ageTo" INTEGER,
    "coachId" TEXT,
    "assistantCoachId" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 20,
    "status" TEXT NOT NULL DEFAULT 'RECRUITING',
    "description" TEXT,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME,
    CONSTRAINT "DanceGroup_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DanceGroup_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DanceGroup_assistantCoachId_fkey" FOREIGN KEY ("assistantCoachId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL,
    "leftAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Enrollment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DanceGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WeeklySchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "room" TEXT,
    "coachId" TEXT,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeeklySchedule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DanceGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeeklySchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WeeklySchedule_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "coachId" TEXT,
    "scheduleTemplateId" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "room" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "cancellationReason" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lesson_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DanceGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Lesson_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Lesson_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lesson_scheduleTemplateId_fkey" FOREIGN KEY ("scheduleTemplateId") REFERENCES "WeeklySchedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Attendance" (
    "lessonId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "markedByUserId" TEXT NOT NULL,
    "markedAt" DATETIME NOT NULL,
    "comment" TEXT,
    PRIMARY KEY ("lessonId", "studentId"),
    CONSTRAINT "Attendance_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attendance_markedByUserId_fkey" FOREIGN KEY ("markedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "DanceGroup_branchId_status_idx" ON "DanceGroup"("branchId", "status");
CREATE INDEX "DanceGroup_coachId_idx" ON "DanceGroup"("coachId");
CREATE INDEX "DanceGroup_assistantCoachId_idx" ON "DanceGroup"("assistantCoachId");
CREATE INDEX "DanceGroup_name_idx" ON "DanceGroup"("name");
CREATE INDEX "DanceGroup_direction_idx" ON "DanceGroup"("direction");
CREATE INDEX "DanceGroup_archivedAt_idx" ON "DanceGroup"("archivedAt");
CREATE INDEX "Enrollment_studentId_status_idx" ON "Enrollment"("studentId", "status");
CREATE INDEX "Enrollment_groupId_status_idx" ON "Enrollment"("groupId", "status");
CREATE INDEX "Enrollment_groupId_leftAt_idx" ON "Enrollment"("groupId", "leftAt");
CREATE INDEX "WeeklySchedule_branchId_weekday_isActive_idx" ON "WeeklySchedule"("branchId", "weekday", "isActive");
CREATE INDEX "WeeklySchedule_groupId_isActive_idx" ON "WeeklySchedule"("groupId", "isActive");
CREATE INDEX "WeeklySchedule_coachId_weekday_isActive_idx" ON "WeeklySchedule"("coachId", "weekday", "isActive");
CREATE INDEX "WeeklySchedule_room_weekday_isActive_idx" ON "WeeklySchedule"("room", "weekday", "isActive");
CREATE INDEX "Lesson_branchId_startsAt_idx" ON "Lesson"("branchId", "startsAt");
CREATE INDEX "Lesson_coachId_startsAt_idx" ON "Lesson"("coachId", "startsAt");
CREATE INDEX "Lesson_scheduleTemplateId_idx" ON "Lesson"("scheduleTemplateId");
CREATE INDEX "Lesson_status_startsAt_idx" ON "Lesson"("status", "startsAt");
CREATE UNIQUE INDEX "Lesson_groupId_startsAt_key" ON "Lesson"("groupId", "startsAt");
CREATE INDEX "Attendance_studentId_markedAt_idx" ON "Attendance"("studentId", "markedAt");
CREATE INDEX "Attendance_markedByUserId_idx" ON "Attendance"("markedByUserId");
CREATE INDEX "Attendance_status_idx" ON "Attendance"("status");
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
