import { useNavigate } from '@tanstack/react-router';
import type { BuildWithSummary, ReviewDecision, Snapshot } from '@targus/core';

import {
  componentTitle,
  isReviewable,
  navigationList,
  type SnapshotFilter,
  storyName,
} from '../build/filters.js';
import { useReview } from './useReview.js';
import { useReviewKeys } from './useReviewKeys.js';

export interface SnapshotReviewInput {
  readonly item: BuildWithSummary;
  readonly snapshots: readonly Snapshot[];
  readonly snapshot: Snapshot;
  readonly filter: SnapshotFilter;
  readonly notify: (message: string) => void;
}

const isPending = (s: Snapshot): boolean => isReviewable(s) && s.review === 'pending';

/** In the Unreviewed filter, the next snapshot after `index` that still waits on a decision. */
function advanceTarget(
  list: readonly Snapshot[],
  index: number,
  filter: SnapshotFilter,
): Snapshot | undefined {
  return filter === 'unreviewed' ? list.slice(index + 1).find(isPending) : undefined;
}

/** j/k move, a/d decide. */
function useShortcuts(
  next: () => void,
  previous: () => void,
  decide: (decision: ReviewDecision) => void,
): void {
  useReviewKeys({
    next,
    previous,
    approve: () => {
      decide('approve');
    },
    deny: () => {
      decide('deny');
    },
  });
}

/**
 * The review mutation, prev/next within the filter and the j/k/a/d shortcuts for one snapshot.
 * In the Unreviewed filter a decision moves on to the next snapshot still pending, if any.
 */
export function useSnapshotReview({
  item,
  snapshots,
  snapshot,
  filter,
  notify,
}: SnapshotReviewInput) {
  const buildId = item.build.id;
  const navigate = useNavigate();
  const review = useReview(buildId, snapshot.id);
  const list = navigationList(snapshots, filter, snapshot.id);
  const index = list.findIndex((candidate) => candidate.id === snapshot.id);
  const previous = list[index - 1];
  const next = list[index + 1];
  const canReview = isReviewable(snapshot) && item.build.status !== 'in_progress';

  const goTo = (target: Snapshot | undefined): void => {
    if (!target) return;
    void navigate({
      to: '/builds/$buildId/snapshots/$snapshotId',
      params: { buildId, snapshotId: target.id },
      search: { filter },
    });
  };
  const decide = (decision: ReviewDecision): void => {
    if (!canReview || review.isPending) return;
    const advanceTo = advanceTarget(list, index, filter);
    const verb = decision === 'approve' ? 'Approved' : 'Denied';
    const message = `${verb} ${componentTitle(snapshot)} / ${storyName(snapshot)}`;
    // mutateAsync rather than callbacks passed to mutate(), which TanStack Query skips once the
    // observer has moved on. The cache is already updated when this resolves: toast, then go.
    review.mutateAsync(decision).then(
      () => {
        notify(message);
        goTo(advanceTo);
      },
      () => undefined, // the error is rendered from review.error
    );
  };
  useShortcuts(
    () => {
      goTo(next);
    },
    () => {
      goTo(previous);
    },
    decide,
  );
  return { review, list, index, previous, next, canReview, decide };
}
