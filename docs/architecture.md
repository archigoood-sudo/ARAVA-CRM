# ARAVA CRM architecture

## Design goals

The foundation favors explicit boundaries, strict typing, local-first performance, and incremental growth. Each package exposes a small public API and can be tested independently. npm workspaces keep dependency management predictable without introducing a second task runner.

## Desktop process model

The Electron main process owns all privileged capabilities: windows, file paths, logging, and database access. The renderer runs with `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. A narrow preload bridge exposes only named, typed operations. IPC inputs are parsed with Zod before they reach persistence.

External navigation is denied inside ARAVA and delegated to the operating system for HTTP(S) links. The application also holds a single-instance lock.

## Persistence

SQLite is stored in Electron's per-user data directory. Prisma provides the typed query layer. The checked-in Prisma migration is the schema source of truth for development and deployment tooling.

Packaged desktop software cannot assume that a Prisma CLI exists on an end user's machine, so startup also runs ordered, idempotently recorded SQL migrations through the Prisma connection. Every runtime migration has a stable identifier stored in `_AppMigration`. New schema changes must add both a Prisma migration and its equivalent runtime migration in the same change set.

Currency values are stored as integer minor units when monetary records are introduced. The current opportunity `value` column is an integer and must be interpreted consistently at the product boundary before customer data is enabled.

## Renderer

React Router owns navigation, TanStack Query owns asynchronous desktop state, and Zustand owns small persisted client preferences and the local foundation session. React Hook Form and Zod own form state and validation. Reusable visual primitives live in `@arava/ui`; application-specific compositions remain inside the desktop app.

The renderer uses hash routing because it is reliable under Electron's `file://` production loading model. A browser-only API adapter supplies deterministic preview data for UI development; production always receives the preload bridge.

## Configuration and observability

Runtime configuration is parsed at startup. `electron-log` writes `arava-crm.log` beneath Electron's standard logs directory and mirrors development messages to the console. Secrets must never be logged or stored in renderer persistence.

## Packaging

Electron Builder produces a configurable NSIS x64 installer for Windows. Prisma engine files are unpacked from ASAR so its native query engine can load at runtime. The CI workflow verifies the source on Linux and produces a Windows installer artifact on `windows-latest`.
