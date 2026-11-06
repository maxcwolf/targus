// What the in-memory doubles copy from D1 so they cannot behave differently from it: text order
// and the rejection of a write that breaks a unique index or primary key.

/** Order two strings as SQLite's default BINARY collation does: by code unit, case-sensitive. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The rejection a D1 write gets from a unique index or primary key; nothing is written. */
export function uniqueViolation(constraint: string): Promise<never> {
  return Promise.reject(new Error(`UNIQUE constraint failed: ${constraint}`));
}
