import { useNavigate } from '@tanstack/react-router';
import type { BuildWithSummary, ReviewDecision, Snapshot } from '@targus/core/browser';
import { type RefObject, useEffect, useRef } from 'react';

import {
  componentTitle,
  isReviewable,
  navigationList,
  type SnapshotFilter,
  storyName,
} from '../build/index.ts';
import { useReview } from './useReview.ts';
import { useHotkeys } from './useHotkeys.ts';

export interface SnapshotReviewInput {
  readonly item: BuildWithSummary;
  readonly snapshots: readonly Snapshot[];
  readonly snapshot: Snapshot;
  readonly filter: SnapshotFilter;
  /** Whether every image on screen for `snapshot` has loaded: no decision on unseen pixels. */
  readonly imagesLoaded: boolean;
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

/** The id of the snapshot on screen, or null once the page has gone, for async callbacks. */
function useShownId(snapshotId: string): RefObject<string | null> {
  const shown = useRef<string | null>(null);
  useEffect(() => {
    shown.current = snapshotId;
    return () => {
      shown.current = null;
    };
  }, [snapshotId]);
  return shown;
}

/**
 * Whether the snapshot can be decided now: reviewable, its build finished, its images seen, and
 * no decision on it already in flight (two in flight could settle in either order).
 */
function canDecide(
  item: BuildWithSummary,
  snapshot: Snapshot,
  imagesLoaded: boolean,
  inFlight: boolean,
): boolean {
  return isReviewable(snapshot) && item.build.status !== 'in_progress' && imagesLoaded && !inFlight;
}

/** The decision keys act once per press: holding one must not decide snapshot after snapshot. */
const decisionKeys: readonly string[] = ['a', 'd'];

/** j/k and ←/→ move (and repeat while held), a/d decide, Esc goes back to the build. */
function useShortcuts(
  move: (target: 'next' | 'previous') => void,
  decide: (decision: ReviewDecision) => void,
  back: () => void,
): void {
  const next = (): void => {
    move('next');
  };
  const previous = (): void => {
    move('previous');
  };
  useHotkeys(
    {
      j: next,
      ArrowRight: next,
      k: previous,
      ArrowLeft: previous,
      a: () => {
        decide('approve');
      },
      d: () => {
        decide('deny');
      },
      Escape: back,
    },
    decisionKeys,
  );
}

/**
 * The review mutation, prev/next within the filter and the review shortcuts for one snapshot.
 * In the Unreviewed filter a decision moves on to the next snapshot still pending, if any.
 */
export function useSnapshotReview({
  item,
  snapshots,
  snapshot,
  filter,
  imagesLoaded,
  notify,
}: SnapshotReviewInput) {
  const buildId = item.build.id;
  const navigate = useNavigate();
  const review = useReview(buildId, snapshot.id);
  const shown = useShownId(snapshot.id);
  const list = navigationList(snapshots, filter, snapshot.id);
  const index = list.findIndex((candidate) => candidate.id === snapshot.id);
  const previous = list[index - 1];
  const next = list[index + 1];
  const canReview = canDecide(item, snapshot, imagesLoaded, review.isPending);

  const goTo = (target: Snapshot | undefined): void => {
    if (!target) return;
    void navigate({
      to: '/builds/$buildId/snapshots/$snapshotId',
      params: { buildId, snapshotId: target.id },
      search: { filter },
    });
  };
  const decide = (decision: ReviewDecision): void => {
    if (!canReview) return;
    const advanceTo = advanceTarget(list, index, filter);
    const verb = decision === 'approve' ? 'Approved' : 'Denied';
    const message = `${verb} ${componentTitle(snapshot)} / ${storyName(snapshot)}`;
    // A promise rather than callbacks passed to mutate(), which TanStack Query skips once the
    // observer has moved on. The cache is already updated when this resolves: toast, then go,
    // unless the reviewer has meanwhile moved to another snapshot or left the page.
    review.decide(decision).then(
      () => {
        notify(message);
        if (shown.current === snapshot.id) goTo(advanceTo);
      },
      () => undefined, // FailedDecisions lists the failure, wherever the reviewer is by then
    );
  };
  useShortcuts(
    (direction) => {
      goTo(direction === 'next' ? next : previous);
    },
    decide,
    () => {
      void navigate({ to: '/builds/$buildId', params: { buildId }, search: { filter } });
    },
  );
  return { review, list, index, previous, next, canReview, decide };
}
