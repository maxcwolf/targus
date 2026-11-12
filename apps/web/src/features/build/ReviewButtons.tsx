import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReviewDecision, Snapshot } from '@targus/core/browser';
import type { ReactElement } from 'react';

import { reviewSnapshots } from '../../api-client/index.ts';
import { CheckIcon, CloseIcon } from '../../components/icons.tsx';
import { applyBuildUpdate } from './cache.ts';

export interface ReviewButtonsProps {
  readonly buildId: string;
  /** The changed or new snapshots the buttons decide: one story's, or a component's unreviewed. */
  readonly snapshots: readonly Snapshot[];
  /** What they are, for the buttons' names: "Primary", or "Button". */
  readonly name: string;
  /** Show how many snapshots each button decides ("Approve 3"), for a component's row. */
  readonly counted?: boolean;
}

const reviewOf: Record<ReviewDecision, Snapshot['review']> = {
  approve: 'approved',
  deny: 'denied',
};

/**
 * Approve and Deny for some snapshots of a build, from the build page: a story's row decides
 * that story, a component's row every unreviewed story under it. A button is pressed when all of
 * them already have its decision. The page shows the result once the build has been read again.
 */
export function ReviewButtons(props: ReviewButtonsProps): ReactElement {
  const { buildId, snapshots, name, counted = false } = props;
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (decision: ReviewDecision) =>
      reviewSnapshots(
        buildId,
        decision,
        snapshots.map((snapshot) => snapshot.id),
      ),
    onSuccess: (response) => applyBuildUpdate(queryClient, response),
  });
  const button = (decision: ReviewDecision, label: string, icon: ReactElement): ReactElement => {
    const done = snapshots.every((snapshot) => snapshot.review === reviewOf[decision]);
    return (
      <button
        type="button"
        className={counted ? `button small ${decision}` : `icon-button ${decision}`}
        aria-label={`${label} ${name}`}
        title={counted ? `${label} every unreviewed change of ${name}` : `${label} ${name}`}
        aria-pressed={done}
        disabled={done || mutation.isPending}
        onClick={() => {
          mutation.mutate(decision);
        }}
      >
        {counted ? `${label} ${String(snapshots.length)}` : icon}
      </button>
    );
  };
  return (
    <span className="review-buttons">
      {mutation.isError ? (
        <span role="alert" className="error-text">
          {mutation.error.message}
        </span>
      ) : null}
      {button('deny', 'Deny', <CloseIcon />)}
      {button('approve', 'Approve', <CheckIcon />)}
    </span>
  );
}
