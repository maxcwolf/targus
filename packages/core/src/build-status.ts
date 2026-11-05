import type { SnapshotCounts } from './contracts/build-summary.js';
import type { ReviewState, SnapshotState } from './contracts/snapshot.js';

/** The two snapshot fields `buildStatus` folds over. */
export interface SnapshotOutcome {
  readonly state: SnapshotState;
  readonly review: ReviewState;
}

/** The review status of a captured build, as shown on the builds list. */
export type BuildReviewStatus = 'pending' | 'accepted' | 'denied' | 'passed' | 'failed';

/**
 * A build's status plus the matching GitHub check run conclusion (plan.md section 5.2):
 * `null` while the check run stays `in_progress`.
 */
export interface BuildStatusResult {
  readonly status: BuildReviewStatus;
  readonly conclusion: 'success' | 'failure' | null;
  /** Changes still waiting on a reviewer, for the "N changes awaiting review" summary. */
  readonly pendingCount: number;
  readonly deniedCount: number;
  /** Stories whose render errored; any one fails the build (ADR 0004, rule 6). */
  readonly errorCount: number;
}

/**
 * Everything `buildStatus` needs, as numbers: how many snapshots are in each state, and how
 * many of the reviewable ones are still pending or were denied. The API stores this on the
 * build row so the builds list never reads snapshots.
 */
export interface SnapshotTally {
  readonly counts: SnapshotCounts;
  readonly pendingCount: number;
  readonly deniedCount: number;
}

export const emptyTally: SnapshotTally = {
  counts: { unchanged: 0, changed: 0, new: 0, removed: 0, unstable: 0, error: 0 },
  pendingCount: 0,
  deniedCount: 0,
};

/**
 * Only `changed` and `new` snapshots wait on a reviewer. `unchanged` needs nothing, `removed`
 * is informational, `unstable` never blocks the check (plan.md section 5.1), and `error` fails
 * the build without review.
 */
export function needsReview(state: SnapshotState): boolean {
  return state === 'changed' || state === 'new';
}

/** Count a build's snapshots by state, and the reviewable ones by review. */
export function tallySnapshots(snapshots: readonly SnapshotOutcome[]): SnapshotTally {
  const counts = { ...emptyTally.counts };
  let pendingCount = 0;
  let deniedCount = 0;
  for (const snapshot of snapshots) {
    counts[snapshot.state] += 1;
    if (!needsReview(snapshot.state)) continue;
    if (snapshot.review === 'pending') pendingCount += 1;
    if (snapshot.review === 'denied') deniedCount += 1;
  }
  return { counts, pendingCount, deniedCount };
}

/**
 * Fold a tally into a build status and check run conclusion:
 * any errored story fails the build outright; otherwise any denied change fails it as `denied`;
 * otherwise any pending change keeps it pending; otherwise it is `accepted` when a reviewer
 * approved something and `passed` when nothing needed review.
 */
export function buildStatusFromTally(tally: SnapshotTally): BuildStatusResult {
  const { pendingCount, deniedCount } = tally;
  const errorCount = tally.counts.error;
  const counts = { pendingCount, deniedCount, errorCount };

  if (errorCount > 0) return { status: 'failed', conclusion: 'failure', ...counts };
  if (deniedCount > 0) return { status: 'denied', conclusion: 'failure', ...counts };
  if (pendingCount > 0) return { status: 'pending', conclusion: null, ...counts };
  const reviewable = tally.counts.changed + tally.counts.new;
  const status = reviewable > 0 ? 'accepted' : 'passed';
  return { status, conclusion: 'success', ...counts };
}

/** `buildStatusFromTally` over the snapshots themselves. */
export function buildStatus(snapshots: readonly SnapshotOutcome[]): BuildStatusResult {
  return buildStatusFromTally(tallySnapshots(snapshots));
}
