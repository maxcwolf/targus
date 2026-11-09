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

/** SQLSTATE `foreign_key_violation`, which Postgres puts in the `code` of the error it raises. */
const postgresForeignKeyViolation = '23503';

/**
 * Whether `error` is a foreign-key rejection: D1's, bare or wrapped by drizzle, the double's, or
 * Postgres's. Each engine words it its own way and no service reads it, so the contract suites
 * ask only that the engine itself called the write a foreign-key violation (ADR 0044).
 */
export function isForeignKeyViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.includes(foreignKeyFailed)) return true;
  if ('code' in error && error.code === postgresForeignKeyViolation) return true;
  return isForeignKeyViolation(error.cause);
}
