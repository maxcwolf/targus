import type { SnapshotTally } from '@targus/core';

import type { BuildRecord, SnapshotRecord } from '../ports/build-repository.ts';
import type { builds, snapshots } from './schema.ts';

// Row mappings of `builds` and `snapshots`. They mirror the D1 adapter's; the build contract
// suites hold the two to the same records.

export type SnapshotRow = typeof snapshots.$inferSelect;
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

/**
 * A claim on creating a build's check run, as stored in `check_run_id`: minus the claim's time
 * in ms. Real check run ids are positive, so a claim is told apart by its sign and its age by
 * its value, without a column of its own; `toBuildRecord` reads it as no check run.
 */
export function checkRunClaim(claimedAt: Date): number {
  return -claimedAt.getTime();
}

/** Every `Build` column with ISO timestamps, plus the tally. */
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
