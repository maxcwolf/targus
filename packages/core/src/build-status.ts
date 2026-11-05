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
 * Only `changed` and `new` snapshots wait on a reviewer. `unchanged` needs nothing, `removed`
 * is informational, `unstable` never blocks the check (plan.md section 5.1), and `error` fails
 * the build without review.
 */
function needsReview(state: SnapshotState): boolean {
  return state === 'changed' || state === 'new';
}

function count(snapshots: readonly SnapshotOutcome[], review: ReviewState): number {
  return snapshots.filter((snapshot) => snapshot.review === review).length;
}

/**
 * Fold snapshot states into a build status and check run conclusion:
 * any errored story fails the build outright; otherwise any denied change fails it as `denied`;
 * otherwise any pending change keeps it pending; otherwise it is `accepted` when a reviewer
 * approved something and `passed` when nothing needed review.
 */
export function buildStatus(snapshots: readonly SnapshotOutcome[]): BuildStatusResult {
  const reviewable = snapshots.filter((snapshot) => needsReview(snapshot.state));
  const counts = {
    pendingCount: count(reviewable, 'pending'),
    deniedCount: count(reviewable, 'denied'),
    errorCount: snapshots.filter((snapshot) => snapshot.state === 'error').length,
  };

  if (counts.errorCount > 0) return { status: 'failed', conclusion: 'failure', ...counts };
  if (counts.deniedCount > 0) return { status: 'denied', conclusion: 'failure', ...counts };
  if (counts.pendingCount > 0) return { status: 'pending', conclusion: null, ...counts };
  const status = reviewable.length > 0 ? 'accepted' : 'passed';
  return { status, conclusion: 'success', ...counts };
}
