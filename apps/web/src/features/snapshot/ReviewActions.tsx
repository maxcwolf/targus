import type { ReviewDecision, ReviewState } from '@targus/core';
import type { ReactElement } from 'react';

import { CheckIcon, CloseIcon } from '../../components/icons.js';

export interface ReviewActionsProps {
  readonly review: ReviewState;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onDecide: (decision: ReviewDecision) => void;
}

/** "Deny ✕" (outline) and "Approve ✓" (primary). Both stay clickable to reverse a decision. */
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
        className="button deny"
        aria-label="Deny"
        title="Deny (d)"
        aria-pressed={review === 'denied'}
        aria-keyshortcuts="d"
        disabled={disabled || busy}
        onClick={() => {
          onDecide('deny');
        }}
      >
        Deny <CloseIcon />
      </button>
      <button
        type="button"
        className="button primary approve"
        aria-label="Approve"
        title="Approve (a)"
        aria-pressed={review === 'approved'}
        aria-keyshortcuts="a"
        disabled={disabled || busy}
        onClick={() => {
          onDecide('approve');
        }}
      >
        Approve <CheckIcon />
      </button>
    </div>
  );
}
