# Database migrations

1. Update `packages/database/prisma/schema.prisma`.
2. Set `DATABASE_URL` to a development SQLite database.
3. Run `npm run db:migrate -- --name <migration_name>`.
4. Add the equivalent ordered statements to `packages/database/src/runtime-migrations.ts` using the generated migration identifier.
5. Run type checking, lint, unit tests, the production build, and the desktop end-to-end test.

Never edit an already released migration. Add a new migration so existing customer databases remain upgradeable.
