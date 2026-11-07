// What the in-memory doubles copy from D1 so they cannot behave differently from it: text order
// and the rejection of a write that breaks a unique index, a primary key or a foreign key.

/** Order two strings as SQLite's default BINARY collation does: by code unit, case-sensitive. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The rejection a D1 write gets from a unique index or primary key; nothing is written. */
export function uniqueViolation(constraint: string): Promise<never> {
  return Promise.reject(new Error(`UNIQUE constraint failed: ${constraint}`));
}

const foreignKeyFailed = 'FOREIGN KEY constraint failed';

/**
 * The rejection a D1 write gets when a foreign key names a missing parent row; nothing is
 * written. D1 says only `FOREIGN KEY constraint failed`, and drizzle wraps that as the cause of
 * its own error; the double adds the column, for whoever reads a failing test.
 */
export function foreignKeyViolation(column: string): Promise<never> {
  return Promise.reject(new Error(`${foreignKeyFailed}: ${column}`));
}

/** Whether `error` is D1's foreign-key rejection, bare or wrapped by drizzle, or the double's. */
export function isForeignKeyViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes(foreignKeyFailed) || isForeignKeyViolation(error.cause);
}
