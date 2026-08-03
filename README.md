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

## Quality commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
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
