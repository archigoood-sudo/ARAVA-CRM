# ARAVA CRM

ARAVA CRM is a local-first commercial CRM desktop application built with Electron, React, TypeScript, Prisma, and SQLite.

## Requirements

- Node.js 22.12 or newer
- npm 10.9 or newer
- Windows 10/11 for producing and validating the final NSIS installer

## Getting started

```bash
npm install
npm run dev
```

The desktop app creates its SQLite database under Electron's per-user application data directory. Prisma CLI commands use `DATABASE_URL`; copy `.env.example` to `.env` when developing schema changes.

The installed application stores `arava.db` in Electron's `userData` directory and keeps local backups in its `backups` subdirectory by default. An OWNER can change the backup folder, create or validate a copy, export one to another disk, and perform a guarded restore from Settings → «Резервные копии». Automatic backups run at most once per 24 hours while the application is used; the latest 30 automatic copies are retained, while manual and pre-restore safety copies are never removed automatically.

On a fresh database, ARAVA creates `owner@arava.local` with the temporary password `Arava!ChangeMe1`. The owner must replace it immediately after the first login. Production deployments may override these one-time values with `ARAVA_INITIAL_OWNER_EMAIL` and `ARAVA_INITIAL_OWNER_PASSWORD` during first startup.

## Quality commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:e2e:packaged
```

Build the Windows NSIS installer on Windows with:

```bash
npm run build:win
```

The artifact is written to `apps/desktop/release/`.

## Workspace map

- `apps/desktop` — Electron main/preload processes and React renderer
- `packages/config` — application constants and shared toolchain policy
- `packages/database` — Prisma schema, generated client boundary, and startup migrations
- `packages/shared` — cross-process contracts and validation schemas
- `packages/ui` — reusable presentation primitives
- `docs` — architectural and operational decisions
- `scripts` — repository automation

See [Architecture](docs/architecture.md) for process boundaries and design decisions.
