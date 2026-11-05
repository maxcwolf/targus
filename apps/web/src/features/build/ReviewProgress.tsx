import type { Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import { isReviewable } from './filters.js';

/** "2 of 7 changes reviewed · 1 denied" over a thin approved / denied / remaining bar. */
export function ReviewProgress({
  snapshots,
}: {
  readonly snapshots: readonly Snapshot[];
}): ReactElement | null {
  const reviewable = snapshots.filter(isReviewable);
  if (reviewable.length === 0) return null;
  const approved = reviewable.filter((s) => s.review === 'approved').length;
  const denied = reviewable.filter((s) => s.review === 'denied').length;
  const total = reviewable.length;
  const percent = (count: number): string => `${(count / total) * 100}%`;
  return (
    <div className="review-progress">
      <p className="progress-text">
        {approved + denied} of {total} {total === 1 ? 'change' : 'changes'} reviewed
        {denied > 0 ? ` · ${denied} denied` : ''}
      </p>
      <div className="progress-bar" aria-hidden="true">
        <span className="progress-approved" style={{ width: percent(approved) }} />
        <span className="progress-denied" style={{ width: percent(denied) }} />
      </div>
    </div>
  );
}
