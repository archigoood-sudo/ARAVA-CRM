export function getErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  const message = error.message.replace(/^Error invoking remote method '[^']+': Error: /u, '');
  if (
    /PrismaClient|Invalid `.*prisma|SQLITE_|SQLite|constraint failed|database is locked|\n\s*at\s/u.test(
      message,
    )
  )
    return fallback;
  return message;
}
