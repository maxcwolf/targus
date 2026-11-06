import type { ReviewState, SnapshotState } from '@targus/core/browser';
import type { ReactElement } from 'react';

const stateLabels: Record<SnapshotState, string> = {
  unchanged: 'Unchanged',
  changed: 'Changed',
  new: 'New',
  removed: 'Removed',
  unstable: 'Unstable',
  error: 'Error',
};

const reviewLabels: Record<ReviewState, string> = {
  pending: 'Unreviewed',
  approved: 'Approved',
  denied: 'Denied',
};

/** What comparing a snapshot with its baseline found. */
export function StateBadge({ state }: { readonly state: SnapshotState }): ReactElement {
  return (
    <span className={`pill state-${state}`} data-state={state}>
      {stateLabels[state]}
    </span>
  );
}

/** A reviewer's decision on a snapshot. */
export function ReviewBadge({ review }: { readonly review: ReviewState }): ReactElement {
  return (
    <span
      role="status"
      aria-label="Review"
      className={`pill review-${review}`}
      data-review={review}
    >
      {reviewLabels[review]}
    </span>
  );
}

const tableLabels: Record<ReviewState, string> = {
  pending: 'Unreviewed',
  approved: 'Accepted',
  denied: 'Denied',
};

/** The review as the build table words it (Chromatic says "Accepted" there). */
export function ReviewPill({ review }: { readonly review: ReviewState }): ReactElement {
  return <span className={`pill review-${review}`}>{tableLabels[review]}</span>;
}
