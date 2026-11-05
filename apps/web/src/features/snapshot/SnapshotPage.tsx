import { Link, useNavigate } from '@tanstack/react-router';
import type { BuildWithSummary, ReviewDecision, Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import { ReviewBadge, StateBadge } from '../../components/Badges.js';
import { formatDateTime } from '../../components/format.js';
import {
  componentTitle,
  effectiveFilter,
  isReviewable,
  navigationList,
  type SnapshotFilter,
  storyName,
} from '../build/filters.js';
import { useBuildData } from '../build/useBuildData.js';
import { ErrorView, NotFound } from '../errors/ErrorView.js';
import { ReviewActions } from './ReviewActions.js';
import { SnapshotNav } from './SnapshotNav.js';
import { SnapshotViewer } from './SnapshotViewer.js';
import { StateNotice } from './StateNotice.js';
import { useReview } from './useReview.js';
import { useReviewKeys } from './useReviewKeys.js';

export interface SnapshotPageProps {
  readonly buildId: string;
  readonly snapshotId: string;
  readonly filter: SnapshotFilter | undefined;
}

interface DetailProps {
  readonly item: BuildWithSummary;
  readonly snapshots: readonly Snapshot[];
  readonly snapshot: Snapshot;
  readonly filter: SnapshotFilter;
}

/** Review mutation, prev/next within the filter, and the j/k/a/d shortcuts for one snapshot. */
function useSnapshotReview(
  item: BuildWithSummary,
  snapshots: readonly Snapshot[],
  snapshot: Snapshot,
  filter: SnapshotFilter,
) {
  const buildId = item.build.id;
  const navigate = useNavigate();
  const review = useReview(buildId, snapshot.id);
  const list = navigationList(snapshots, filter, snapshot.id);
  const index = list.findIndex((candidate) => candidate.id === snapshot.id);
  const previous = list[index - 1];
  const next = list[index + 1];
  const canReview = isReviewable(snapshot) && item.build.status !== 'in_progress';

  const go = (target: Snapshot | undefined) => () => {
    if (!target) return;
    void navigate({
      to: '/builds/$buildId/snapshots/$snapshotId',
      params: { buildId, snapshotId: target.id },
      search: { filter },
    });
  };
  const decide = (decision: ReviewDecision) => () => {
    if (canReview && !review.isPending) review.mutate(decision);
  };
  useReviewKeys({
    next: go(next),
    previous: go(previous),
    approve: decide('approve'),
    deny: decide('deny'),
  });
  return { review, list, index, previous, next, canReview };
}

function SnapshotDetail({ item, snapshots, snapshot, filter }: DetailProps): ReactElement {
  const buildId = item.build.id;
  const { review, list, index, previous, next, canReview } = useSnapshotReview(
    item,
    snapshots,
    snapshot,
    filter,
  );

  return (
    <section className="snapshot-page">
      <p className="breadcrumb">
        <Link to="/builds/$buildId" params={{ buildId }} search={{ filter }}>
          Build #{item.build.number}
        </Link>{' '}
        / {componentTitle(snapshot)}
      </p>
      <SnapshotHeading snapshot={snapshot} />
      <div className="review-bar">
        <ReviewActions
          review={snapshot.review}
          disabled={!canReview}
          busy={review.isPending}
          onDecide={(decision) => {
            review.mutate(decision);
          }}
        />
        <SnapshotNav
          buildId={buildId}
          filter={filter}
          previous={previous}
          next={next}
          position={`${index + 1} of ${list.length}`}
        />
      </div>
      {review.isError ? (
        <p role="alert" className="error-text">
          {review.error.message}
        </p>
      ) : null}
      <StateNotice state={snapshot.state} />
      <SnapshotViewer snapshot={snapshot} />
    </section>
  );
}

function SnapshotHeading({ snapshot }: { readonly snapshot: Snapshot }): ReactElement {
  return (
    <>
      <h1>
        {componentTitle(snapshot)} <span className="muted">/</span> {storyName(snapshot)}
      </h1>
      <p className="meta">
        <StateBadge state={snapshot.state} />
        {isReviewable(snapshot) ? <ReviewBadge review={snapshot.review} /> : null}
        {snapshot.reviewedBy && snapshot.reviewedAt ? (
          <span className="muted">
            by {snapshot.reviewedBy} on {formatDateTime(snapshot.reviewedAt)}
          </span>
        ) : null}
      </p>
    </>
  );
}

/** `/builds/$buildId/snapshots/$snapshotId`: one story's comparison and its review. */
export function SnapshotPage({ buildId, snapshotId, filter }: SnapshotPageProps): ReactElement {
  const data = useBuildData(buildId);
  if (data.status === 'pending') return <p className="muted">Loading snapshot…</p>;
  if (data.status === 'error') return <ErrorView error={data.error} />;
  const snapshot = data.snapshots.find((candidate) => candidate.id === snapshotId);
  if (!snapshot) return <NotFound message="This build has no such snapshot." />;
  return (
    <SnapshotDetail
      item={data.build}
      snapshots={data.snapshots}
      snapshot={snapshot}
      filter={effectiveFilter(filter, data.snapshots)}
    />
  );
}
