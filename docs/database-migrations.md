# Database migrations

1. Update `packages/database/prisma/schema.prisma`.
2. Set `DATABASE_URL` to a development SQLite database.
3. Run `npm run db:migrate -- --name <migration_name>`.
4. Add the equivalent ordered statements to `packages/database/src/runtime-migrations.ts` using the generated migration identifier.
5. Run type checking, lint, unit tests, the production build, and the desktop end-to-end test.

`migration-compatibility.test.ts` applies every Prisma SQL migration to one temporary database and every packaged runtime migration to another, then compares tables, columns, foreign keys, and indexes. This test must remain green for every schema change.

Never edit an already released migration. Add a new migration so existing customer databases remain upgradeable.

Sprint 2 is introduced by `20260805000000_sprint_2`. It adds `DanceGroup`, `Enrollment`, `WeeklySchedule`, `Lesson`, `Attendance`, and `AuditLog` without rebuilding or deleting Sprint 1 tables.

Sprint 3 is introduced by `20260806000000_sprint_3`. It adds `Tariff`, `Subscription`, `Payment`, `Refund`, and the append-only `SubscriptionLedger`, including all foreign keys and lookup indexes required by the finance and automatic write-off services.

Sprint 4.1B is introduced by `20260809010000_sprint_4_1b`. It adds `Room`, `RoomRental`, `RoomClosure`, `CalendarException`, and `TrainerSubstitution`, plus nullable `roomId` references on `WeeklySchedule` and `Lesson`. Existing lessons without a room remain unchanged and readable as «Зал не указан». The migration only adds tables, columns, and indexes; it never recreates or clears the customer database.
