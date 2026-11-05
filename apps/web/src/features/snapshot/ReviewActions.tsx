import type { ReviewDecision, ReviewState } from '@targus/core';
import type { ReactElement } from 'react';

export interface ReviewActionsProps {
  readonly review: ReviewState;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onDecide: (decision: ReviewDecision) => void;
}

/** Approve and Deny. Both stay clickable after a decision so it can be reversed. */
export function ReviewActions({
  review,
  disabled,
  busy,
  onDecide,
}: ReviewActionsProps): ReactElement {
  return (
    <div className="button-group review-actions">
      <button
        type="button"
        className="button approve"
        aria-pressed={review === 'approved'}
        aria-keyshortcuts="a"
        disabled={disabled || busy}
        onClick={() => {
          onDecide('approve');
        }}
      >
        Approve
      </button>
      <button
        type="button"
        className="button deny"
        aria-pressed={review === 'denied'}
        aria-keyshortcuts="d"
        disabled={disabled || busy}
        onClick={() => {
          onDecide('deny');
        }}
      >
        Deny
      </button>
    </div>
  );
}
