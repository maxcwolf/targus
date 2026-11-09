import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// What the Postgres repositories share: the client type they take and the few places where
// Postgres has to be told to behave as the contract suites require (ADR 0044).

/**
 * Any drizzle Postgres client. A host passes `drizzle-orm/node-postgres` over its pool; the tests
 * pass `drizzle-orm/pglite`. The repositories use nothing a single driver adds.
 */
export type PostgresDatabase = PgDatabase<PgQueryResultHKT>;

/** Postgres's wire protocol counts a statement's bound parameters in 16 bits. */
export const postgresMaxBoundParameters = 65_535;

/** Split rows for multi-row statements so no statement binds more than Postgres allows. */
export function chunkForPostgres<T>(rows: readonly T[], parametersPerRow: number): T[][] {
  const size = Math.max(1, Math.floor(postgresMaxBoundParameters / parametersPerRow));
  const chunks: T[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    chunks.push(rows.slice(start, start + size));
  }
  return chunks;
}

/**
 * `column` for an `ORDER BY`, compared byte by byte. A database's default collation is its
 * locale's (on most hosts `en_US.UTF-8`, where "a" sorts before "B"); every repository and the
 * in-memory doubles order text as D1 does, by code unit, so the order is stated, not inherited.
 */
export function byteOrder(column: PgColumn): SQL {
  return sql`${column} COLLATE "C"`;
}

/**
 * Membership test against a list bound as one JSON parameter, so a list of any length is one
 * parameter and the statement text does not change with its length.
 */
export function inJson(column: PgColumn, values: readonly string[]): SQL {
  return sql`${column} IN (SELECT json_array_elements_text(${JSON.stringify(values)}::json))`;
}

/** The one row a `RETURNING` statement that always writes a row gives back. */
export function returned<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('the statement returned no row');
  return row;
}
