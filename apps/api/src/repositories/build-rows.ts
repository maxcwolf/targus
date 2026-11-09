import type { Build, Snapshot, SnapshotTally } from '@targus/core';
import { getTableColumns, sql, type Query, type SQL } from 'drizzle-orm';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';

import { builds, snapshots } from '../db/schema.ts';
import { chunkForD1 } from './d1-limits.ts';

// Row mappings of `builds` and `snapshots`, and the guarded statements their writes share.

/** A stored snapshot: the wire `Snapshot` plus the capture-hygiene fields only D1 keeps. */
export interface SnapshotRecord extends Snapshot {
  readonly blank: boolean;
  /** The render error of an `error` snapshot, else null. */
  readonly error: string | null;
}

/** A stored build: the wire `Build` plus its persisted snapshot tally. */
export interface BuildRecord extends Build {
  readonly tally: SnapshotTally;
}

type SnapshotRow = typeof snapshots.$inferSelect;
type BuildRow = typeof builds.$inferSelect;

/** The tally as the eight `builds` count columns. */
export function tallyColumns(tally: SnapshotTally) {
  return {
    pendingCount: tally.pendingCount,
    deniedCount: tally.deniedCount,
    unchangedCount: tally.counts.unchanged,
    changedCount: tally.counts.changed,
    newCount: tally.counts.new,
    removedCount: tally.counts.removed,
    unstableCount: tally.counts.unstable,
    errorCount: tally.counts.error,
  };
}

function toTally(row: BuildRow): SnapshotTally {
  return {
    counts: {
      unchanged: row.unchangedCount,
      changed: row.changedCount,
      new: row.newCount,
      removed: row.removedCount,
      unstable: row.unstableCount,
      error: row.errorCount,
    },
    pendingCount: row.pendingCount,
    deniedCount: row.deniedCount,
  };
}

/** Every `Build` column with ISO timestamps, plus the tally. */
/**
 * A claim on creating a build's check run, as stored in `check_run_id`: minus the claim's time
 * in ms. Real check run ids are positive, so a claim is told apart by its sign and its age by
 * its value, without a column of its own; `toBuildRecord` reads it as no check run.
 */
export function checkRunClaim(claimedAt: Date): number {
  return -claimedAt.getTime();
}

export function toBuildRecord(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    number: row.number,
    sha: row.sha,
    branch: row.branch,
    prNumber: row.prNumber,
    mergeBaseSha: row.mergeBaseSha,
    baselineBuildId: row.baselineBuildId,
    trigger: row.trigger,
    device: row.device,
    appearance: row.appearance,
    platform: row.platform,
    pixelRatio: row.pixelRatio,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    checkRunId: row.checkRunId !== null && row.checkRunId > 0 ? row.checkRunId : null,
    tally: toTally(row),
  };
}

export function toSnapshotRecord(row: SnapshotRow): SnapshotRecord {
  return { ...row, reviewedAt: row.reviewedAt === null ? null : row.reviewedAt.toISOString() };
}

export function toSnapshotRow(buildId: string, record: SnapshotRecord): SnapshotRow {
  const reviewedAt = record.reviewedAt === null ? null : new Date(record.reviewedAt);
  return { ...record, buildId, reviewedAt };
}

/** True while `buildId` is still waiting for its results. Binds two parameters. */
export function buildInProgress(buildId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${builds} WHERE ${builds.id} = ${buildId} AND ${builds.status} = ${'in_progress'})`;
}

const columns = Object.entries(getTableColumns(snapshots)) as [
  keyof SnapshotRow,
  (typeof snapshots)[keyof SnapshotRow],
][];

/** One `VALUES` tuple, each value encoded by its column (timestamps, booleans). */
function tuple(row: SnapshotRow): SQL {
  const values = columns.map(([key, column]) => sql.param(row[key], column));
  return sql`(${sql.join(values, sql`, `)})`;
}

const dialect = new SQLiteAsyncDialect();

/**
 * Run compiled statements as one D1 batch, which D1 executes as a single transaction. Drizzle's
 * own `batch` cannot bind the parameters of a raw `sql` statement, hence D1's directly.
 */
export function runBatch(database: D1Database, queries: readonly Query[]): Promise<D1Result[]> {
  return database.batch(queries.map((query) => database.prepare(query.sql).bind(...query.params)));
}

/**
 * `INSERT` statements for `rows`, each a no-op unless `guard` holds when it runs. Drizzle's
 * insert builder cannot take a condition, so this is `INSERT ... SELECT ... WHERE guard`.
 * Each statement stays under D1's parameter limit with `guardParameters` to spare.
 */
export function guardedSnapshotInserts(
  rows: readonly SnapshotRow[],
  guard: SQL,
  guardParameters: number,
): Query[] {
  const names = sql.join(
    columns.map(([, column]) => sql.identifier(column.name)),
    sql`, `,
  );
  return chunkForD1(rows, columns.length, guardParameters).map((chunk) =>
    dialect.sqlToQuery(
      sql`INSERT INTO ${snapshots} (${names}) SELECT * FROM (VALUES ${sql.join(chunk.map(tuple), sql`, `)}) WHERE ${guard}`,
    ),
  );
}
