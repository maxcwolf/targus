import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';

import type {
  ApprovalChanges,
  BuildCompletion,
  ReviewCommit,
  SnapshotRecord,
} from '../ports/build-repository.ts';
import { approvalPairIs } from './approval.repository.ts';
import { tallyColumns, toSnapshotRow } from './build-rows.ts';
import { chunkForPostgres, type PostgresDatabase } from './database.ts';
import { approvals, builds, snapshots } from './schema.ts';

// The two guarded writes of ADR 0013 as Postgres transactions (ADR 0044). D1 has no interactive
// transaction, so its adapter sends one batch in which every statement repeats the guard. Here
// the transaction first locks the build's row and reads the guarded value under that lock: a
// second writer waits at the same lock and then sees what the first committed. The build's own
// update still comes last and still carries the guard, so its row count is the answer.

type Transaction = Parameters<Parameters<PostgresDatabase['transaction']>[0]>[0];

const snapshotColumnCount = Object.keys(getTableColumns(snapshots)).length;
const approvalColumnCount = Object.keys(getTableColumns(approvals)).length;

/**
 * Store a build's snapshots and move it out of `in_progress`, or write nothing and answer false
 * when it is no longer `in_progress`. A rejected snapshot rolls the whole transaction back.
 */
export function completeWithResults(
  db: PostgresDatabase,
  buildId: string,
  records: readonly SnapshotRecord[],
  completion: BuildCompletion,
): Promise<boolean> {
  const { status, tally, completedAt, resultsDigest } = completion;
  const rows = records.map((record) => toSnapshotRow(buildId, record));
  return db.transaction(async (tx) => {
    const [build] = await tx
      .select({ status: builds.status })
      .from(builds)
      .where(eq(builds.id, buildId))
      .for('update');
    if (build?.status !== 'in_progress') return false;
    // An `in_progress` build has no snapshots, unless its rows came from a D1 database that
    // still had a build wedged by the non-atomic write ADR 0013 replaced.
    await tx.delete(snapshots).where(eq(snapshots.buildId, buildId));
    for (const chunk of chunkForPostgres(rows, snapshotColumnCount)) {
      await tx.insert(snapshots).values(chunk);
    }
    const completed = await tx
      .update(builds)
      .set({ status, completedAt, resultsDigest, ...tallyColumns(tally) })
      .where(and(eq(builds.id, buildId), eq(builds.status, 'in_progress')))
      .returning({ id: builds.id });
    return completed.length === 1;
  });
}

/** Record and withdraw the approvals of one decision; a pair already approved keeps its row. */
async function applyApprovalChanges(tx: Transaction, changes: ApprovalChanges): Promise<void> {
  for (const pair of changes.withdraw) {
    await tx
      .delete(approvals)
      .where(
        approvalPairIs(pair.projectId, pair.storyId, pair.variant, pair.fromHash, pair.toHash),
      );
  }
  const rows = changes.record.map(({ id, approval }) => ({
    ...approval,
    id,
    approvedAt: new Date(approval.approvedAt),
  }));
  for (const chunk of chunkForPostgres(rows, approvalColumnCount)) {
    await tx.insert(approvals).values(chunk).onConflictDoNothing();
  }
}

/**
 * Write a review decision, its approvals and the build's new status and tally, and move the
 * build to the next review version; or write nothing and answer false when the build is no
 * longer at `readVersion`.
 */
export function commitReview(
  db: PostgresDatabase,
  buildId: string,
  readVersion: number,
  commit: ReviewCommit,
): Promise<boolean> {
  const { snapshotIds, review, reviewedBy, reviewedAt, status, tally } = commit;
  return db.transaction(async (tx) => {
    const [build] = await tx
      .select({ version: builds.reviewVersion })
      .from(builds)
      .where(eq(builds.id, buildId))
      .for('update');
    if (build?.version !== readVersion) return false;
    for (const ids of chunkForPostgres(snapshotIds, 1)) {
      await tx
        .update(snapshots)
        .set({ review, reviewedBy, reviewedAt })
        .where(and(inArray(snapshots.id, ids), eq(snapshots.buildId, buildId)));
    }
    await applyApprovalChanges(tx, commit.approvals);
    const folded = await tx
      .update(builds)
      .set({ status, ...tallyColumns(tally), reviewVersion: sql`${builds.reviewVersion} + 1` })
      .where(and(eq(builds.id, buildId), eq(builds.reviewVersion, readVersion)))
      .returning({ id: builds.id });
    return folded.length === 1;
  });
}
