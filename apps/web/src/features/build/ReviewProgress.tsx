import type { Snapshot } from '@targus/core/browser';
import type { ReactElement } from 'react';

import { isReviewable } from './filters.ts';

export interface ReviewTally {
  readonly approved: number;
  readonly denied: number;
  readonly unreviewed: number;
  readonly total: number;
}

export function reviewTally(snapshots: readonly Snapshot[]): ReviewTally {
  const reviewable = snapshots.filter(isReviewable);
  const approved = reviewable.filter((s) => s.review === 'approved').length;
  const denied = reviewable.filter((s) => s.review === 'denied').length;
  return {
    approved,
    denied,
    unreviewed: reviewable.length - approved - denied,
    total: reviewable.length,
  };
}

function describe({ approved, denied, total }: ReviewTally): string {
  const reviewed = `${approved + denied} of ${total} ${total === 1 ? 'change' : 'changes'} reviewed`;
  return denied > 0 ? `${reviewed}, ${denied} denied` : reviewed;
}

/** A thin bar: accepted green, denied red, unreviewed gold. Nothing when nothing is reviewable. */
export function ReviewProgress({
  snapshots,
  compact = false,
}: {
  readonly snapshots: readonly Snapshot[];
  readonly compact?: boolean;
}): ReactElement | null {
  const tally = reviewTally(snapshots);
  if (tally.total === 0) return null;
  const width = (count: number): string => `${(count / tally.total) * 100}%`;
  return (
    <div
      className={compact ? 'progress-bar compact' : 'progress-bar'}
      role="img"
      aria-label={describe(tally)}
    >
      <span className="progress-approved" style={{ width: width(tally.approved) }} />
      <span className="progress-denied" style={{ width: width(tally.denied) }} />
      <span className="progress-unreviewed" style={{ width: width(tally.unreviewed) }} />
    </div>
  );
}
