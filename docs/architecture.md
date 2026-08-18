# ARAVA CRM architecture

## Design goals

The foundation favors explicit boundaries, strict typing, local-first performance, and incremental growth. Each package exposes a small public API and can be tested independently. npm workspaces keep dependency management predictable without introducing a second task runner.

## Desktop process model

The Electron main process owns all privileged capabilities: windows, file paths, logging, and database access. The renderer runs with `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. A narrow preload bridge exposes only named, typed operations. IPC inputs are parsed with Zod before they reach persistence.

External navigation is denied inside ARAVA and delegated to the operating system for HTTP(S) links. The application also holds a single-instance lock.

## Persistence

Website integration uses a transactional SQLite outbox, one isolated main-process worker and a versioned HTTPS API. Device identity and its encrypted credential live outside the database in Electron user data. React receives status and journal DTOs only; networking and secrets never enter the renderer. The server contract is documented in [integration-api-v1.md](./integration-api-v1.md).

SQLite is stored in Electron's per-user data directory. Prisma provides the typed query layer. The checked-in Prisma migration is the schema source of truth for development and deployment tooling. Local passwords use salted scrypt hashes with a memory cost of 64 MiB; only opaque session tokens reach the renderer and only their SHA-256 digests are persisted.

Packaged desktop software cannot assume that a Prisma CLI exists on an end user's machine, so startup also runs ordered, idempotently recorded SQL migrations through the Prisma connection. Every runtime migration has a stable identifier stored in `_AppMigration`. New schema changes must add both a Prisma migration and its equivalent runtime migration in the same change set.

Currency values are stored as integer minor units. For RUB, `100` represents one ruble. Conversion to and from user-facing decimal values happens only at validated IPC and UI boundaries.

Sprint 3 financial operations are isolated in `FinanceService`. Payments and refunds are immutable business records: corrections use explicit cancellation or append-only refund rows. Subscription usage is represented by `SubscriptionLedger`; `lessonsUsed` is a transactionally maintained projection for fast reads. Attendance write-offs, corrections, lesson-cancellation reversals, freezes, and manual adjustments update the projection and append the corresponding ledger and audit entries in the same SQLite transaction.

The attendance composite key is serialized into ledger `attendanceId` as `lessonId:studentId`. A write-off is applied at most once while it remains active. Corrections append a linked reversal before a replacement write-off is considered. Paid subscriptions are selected by the nearest expiry date, with non-expiring unlimited subscriptions ordered last.

## Renderer

React Router owns navigation, TanStack Query owns asynchronous desktop state, and Zustand owns small persisted client preferences and the opaque local session token. React Hook Form and Zod own form state and validation. Reusable visual primitives live in `@arava/ui`; application-specific compositions remain inside the desktop app.

The renderer uses hash routing because it is reliable under Electron's `file://` production loading model. Production and development both use the sandboxed preload bridge so authorization behavior cannot diverge between preview and packaged builds.

## Authorization

Every protected IPC call carries an opaque session token. The main-process application service resolves the current local user, rejects expired or disabled sessions, applies the role matrix, and enforces assigned-branch scope before querying or mutating data. Renderer guards and hidden actions are usability controls only; they are not security boundaries.

Sprint 2 studio operations are isolated in `StudioService`. It owns dance groups, enrolment history, recurring schedule templates, generated lessons, attendance, capacity enforcement, conflict detection, and audit writes. Owners and administrators have global studio access; branch managers are constrained to their assigned branches; coaches can only read assigned groups and students and mark attendance for assigned lessons. All of these rules run behind the IPC boundary.

Tariffs, subscriptions, payments, refunds, and finance metrics follow the same main-process authorization boundary. Branch managers can sell and receive payments only inside assigned branches, while refunds and unrestricted balance adjustments remain owner/administrator operations. Coaches receive only read-only subscription status for students in their assigned groups.

Enrolments and lessons are historical records. Removing a participant sets a departure date and status, while group removal archives the group. A unique group/start-time key makes lesson generation idempotent. Attendance uses a lesson/student composite key so immediate saves are atomic upserts rather than duplicate records.

Sprint 4.1B calendar operations are isolated in `CalendarService`. Rooms are branch-owned resources and are archived rather than deleted. Existing schedule and lesson rows retain their legacy nullable room label, while new records may also reference a nullable `Room`; this preserves historical databases without inventing assignments. Resource conflicts use half-open intervals (`start < otherEnd && end > otherStart`), so adjacent events are valid. Lessons, active rentals, and closures share the same room-availability checks. Trainer and group overlaps are enforced independently of rooms, which permits simultaneous lessons in different rooms. Calendar queries are date-range scoped and indexed by resource and start time.

## Local backup and restore

`BackupService` owns all privileged filesystem and SQLite backup operations. The production database path is always derived from Electron's `app.getPath('userData')`; the application never embeds a Windows username or replaces `arava.db` during a normal update. Development and E2E runs use the same rule, with Playwright supplying an isolated `--user-data-dir`.

Backups use SQLite `VACUUM INTO`, producing a consistent, self-contained database while the active application remains open, including when SQLite is using WAL. Every created copy is reopened on a single SQLite connection and checked with `PRAGMA quick_check`; an explicit user validation uses `PRAGMA integrity_check`. A small JSON sidecar records the backup type and validation result. The default folder is `<userData>/backups`; a writable custom directory may be selected through a native dialog. If a configured removable directory is unavailable during an automatic run, ARAVA records the failure and attempts a clearly reported local fallback. Automatic backups run no more than once per 24 hours and retain 30 automatic copies. Manual and pre-restore copies are excluded from retention.

Restore input is selected by a native file dialog or the managed history list. Renderer code receives only a short-lived selection identifier, never generic filesystem methods. Before replacement, the main process verifies the SQLite header, required ARAVA tables, migration identifiers, and full integrity. Unknown newer migration identifiers block downgrade. Older supported copies are duplicated to a staging file, upgraded through packaged runtime migrations, and checked again without changing the source backup. ARAVA then creates a safety backup, closes SQLite, moves the current database to a rollback path, installs the staged database, reconnects, and verifies it. Any replacement failure restores the rollback file. Restore events are written to the database audit before replacement and to `<userData>/backup-restore.log`, because restoring older data can roll back database-resident audit history.

Trainer substitution changes the actual lesson coach and appends an audit record while retaining the original coach in `TrainerSubstitution`. Payroll therefore attributes a completed lesson to the trainer who actually taught it, without double-paying the original trainer. Global audit retrieval is capability-protected and remains OWNER-only; ADMIN actions are still recorded.

Sprint 4.1C pre-printed client cards are isolated in `CardService`. Registration, assignment, replacement, status changes, branch isolation, immutable card events, and privacy-scoped scan resolution are enforced behind IPC. A scan may navigate to an accessible student profile, but never creates attendance or changes subscription and financial records. USB/Bluetooth keyboard scanners are detected from fast printable-key sequences followed by Enter; editable controls are excluded, and the minimum barcode length is configurable.

Sprint 4.1D global search is an offline, typed main-process service. It limits each entity category and applies branch/group visibility before results cross IPC. Payroll uses only `Attendance.status = PRESENT`; `Lesson.attendanceCompletedAt` distinguishes an explicitly completed sheet with zero present students from unfinished attendance.

Sprint 4.2A makes `StudentProfileService` the bounded read model for the student workspace. It delegates subscription balances to `FinanceService`, limits recent attendance, payments, lessons, notes, and activity, and returns a reduced TRAINER projection without contacts, cards, notes, or financial data. Existing mutation services remain the only write paths.

Sprint 4.2B adds `AttentionService` as a derived, permission-aware operational read model. It batches active student, subscription, debt, attendance, payroll, card, room, schedule, and substitution state without duplicating those records. Stable item keys support renderer reconciliation, while resolution happens automatically when the source data changes. OWNER sees all branches; ADMIN queries are scoped in SQLite before results cross IPC; COACH cannot call the administrative service. Shared thresholds in `attention-rules.ts` keep student-profile and global subscription warnings aligned. No persistent notification inbox or snooze table is introduced in this sprint.

Sprint 4.3D keeps trainers in the existing `User` model with role `COACH`. `TrainerProfileService` builds a bounded, permission-aware read model from assigned branches, active groups, current weekly schedules, a selected activity month, limited upcoming lessons and substitutions, and existing payroll accruals. `Lesson.coachId` remains the actual trainer after a substitution; the original scheduled trainer comes from `TrainerSubstitution`. Attendance metrics count only `PRESENT`, and profile payroll never recalculates or mutates approved or paid periods. OWNER sees the complete profile, ADMIN data is filtered to assigned branches before IPC, and COACH can request only their own profile. Trainer profile query keys include user, role, and branch access context to prevent cross-session cache disclosure.

## Configuration and observability

Runtime configuration is parsed at startup. `electron-log` writes `arava-crm.log` beneath Electron's standard logs directory and mirrors development messages to the console. Secrets must never be logged or stored in renderer persistence.

## Packaging

Electron Builder produces a configurable NSIS x64 installer for Windows. Prisma engine files are unpacked from ASAR so its native query engine can load at runtime. The CI workflow verifies the source on Linux and produces a Windows installer artifact on `windows-latest`.
