import { and, eq, getTableColumns, inArray, sql, type Query, type SQL } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';

import { approvals, builds, snapshots } from '../db/schema.ts';
import type { ApprovalChanges, ReviewCommit } from '../ports/build-repository.ts';
import { approvalPairIs } from './approval.repository.ts';
import { tallyColumns } from './build-rows.ts';
import { chunkForD1 } from './d1-limits.ts';

// The statements of `commitReview`'s one D1 batch (ADR 0013, ADR 0026).

type ApprovalRow = typeof approvals.$inferSelect;

const approvalColumns = Object.entries(getTableColumns(approvals)) as [
  keyof ApprovalRow,
  (typeof approvals)[keyof ApprovalRow],
][];

const dialect = new SQLiteAsyncDialect();

/** `INSERT ... SELECT ... WHERE guard`, as drizzle's insert builder cannot take a condition. */
function guardedApprovalInserts(changes: ApprovalChanges, guard: SQL): Query[] {
  const rows: ApprovalRow[] = changes.record.map(({ id, approval }) => ({
    ...approval,
    id,
    approvedAt: new Date(approval.approvedAt),
  }));
  const names = sql.join(
    approvalColumns.map(([, column]) => sql.identifier(column.name)),
    sql`, `,
  );
  const tuple = (row: ApprovalRow) =>
    sql`(${sql.join(
      approvalColumns.map(([key, column]) => sql.param(row[key], column)),
      sql`, `,
    )})`;
  // The guard binds two parameters. No conflict target: either identity index makes a row a
  // no-op, as in `ApprovalRepository.create`.
  return chunkForD1(rows, approvalColumns.length, 2).map((chunk) =>
    dialect.sqlToQuery(
      sql`INSERT INTO ${approvals} (${names}) SELECT * FROM (VALUES ${sql.join(chunk.map(tuple), sql`, `)}) WHERE ${guard} ON CONFLICT DO NOTHING`,
    ),
  );
}

/**
 * The batch of one review: the snapshot decisions, then the approvals it records or withdraws,
 * each guarded by the build still being at `readVersion`, then the build's update, which bumps
 * the version under the same guard and so must come last.
 */
export function reviewCommitStatements(
  db: DrizzleD1Database,
  buildId: string,
  readVersion: number,
  commit: ReviewCommit,
): Query[] {
  const { snapshotIds, review, reviewedBy, reviewedAt, status, tally } = commit;
  const atVersion = sql`EXISTS (SELECT 1 FROM ${builds} WHERE ${builds.id} = ${buildId} AND ${builds.reviewVersion} = ${readVersion})`;
  // Each chunk binds its ids, the three SET values, the build id and the two guard values.
  const decisions = chunkForD1(snapshotIds, 1, 6).map((ids) =>
    db
      .update(snapshots)
      .set({ review, reviewedBy, reviewedAt })
      .where(and(inArray(snapshots.id, ids), eq(snapshots.buildId, buildId), atVersion))
      .toSQL(),
  );
  const withdrawals = commit.approvals.withdraw.map((pair) =>
    db
      .delete(approvals)
      .where(
        and(
          approvalPairIs(pair.projectId, pair.storyId, pair.variant, pair.fromHash, pair.toHash),
          atVersion,
        ),
      )
      .toSQL(),
  );
  const fold = db
    .update(builds)
    .set({ status, ...tallyColumns(tally), reviewVersion: sql`${builds.reviewVersion} + 1` })
    .where(and(eq(builds.id, buildId), eq(builds.reviewVersion, readVersion)))
    .returning({ id: builds.id })
    .toSQL();
  return [
    ...decisions,
    ...withdrawals,
    ...guardedApprovalInserts(commit.approvals, atVersion),
    fold,
  ];
}
