import { Link } from '@tanstack/react-router';
import type { BuildWithSummary, ProjectSummary, Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import { ReviewBadge, StateBadge } from '../../components/Badges.js';
import { formatDateTime } from '../../components/format.js';
import { Skeleton } from '../../components/Skeleton.js';
import { Toast } from '../../components/Toast.js';
import {
  componentTitle,
  effectiveFilter,
  isReviewable,
  type SnapshotFilter,
  storyName,
} from '../build/filters.js';
import { useBuildData } from '../build/useBuildData.js';
import { ErrorView, NotFound } from '../errors/ErrorView.js';
import { ReviewActions } from './ReviewActions.js';
import { SnapshotNav } from './SnapshotNav.js';
import { SnapshotSidebar } from './SnapshotSidebar.js';
import { SnapshotViewer } from './SnapshotViewer.js';
import { StateNotice } from './StateNotice.js';
import { useSnapshotReview } from './useSnapshotReview.js';
import { useToast } from './useToast.js';

export interface SnapshotPageProps {
  readonly buildId: string;
  readonly snapshotId: string;
  readonly filter: SnapshotFilter | undefined;
}

interface DetailProps {
  readonly item: BuildWithSummary;
  readonly project: ProjectSummary | undefined;
  readonly snapshots: readonly Snapshot[];
  readonly snapshot: Snapshot;
  readonly filter: SnapshotFilter;
}

function SnapshotHeading({ item, project, snapshot, filter }: DetailProps): ReactElement {
  const { build } = item;
  return (
    <div className="snapshot-heading">
      <p className="breadcrumb">
        {project ? (
          <>
            <Link to="/projects/$projectId" params={{ projectId: project.id }}>
              {project.name}
            </Link>
            <span className="crumb-sep">›</span>
          </>
        ) : null}
        <Link to="/builds/$buildId" params={{ buildId: build.id }} search={{ filter }}>
          Build #{build.number}
        </Link>
      </p>
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
    </div>
  );
}

function SnapshotDetail(props: DetailProps): ReactElement {
  const { item, snapshot, filter } = props;
  const toast = useToast();
  const { review, list, index, previous, next, canReview, decide } = useSnapshotReview({
    ...props,
    notify: toast.show,
  });
  const actions = (
    <>
      <ReviewActions
        review={snapshot.review}
        disabled={!canReview}
        busy={review.isPending}
        onDecide={decide}
      />
      <SnapshotNav
        buildId={item.build.id}
        filter={filter}
        previous={previous}
        next={next}
        position={`${index + 1} of ${list.length}`}
      />
    </>
  );
  return (
    <div className="snapshot-layout">
      <SnapshotSidebar
        buildId={item.build.id}
        snapshots={list}
        currentId={snapshot.id}
        filter={filter}
      />
      <section className="snapshot-main">
        <SnapshotHeading {...props} />
        {review.isError ? (
          <p role="alert" className="error-text">
            {review.error.message}
          </p>
        ) : null}
        <StateNotice state={snapshot.state} />
        <SnapshotViewer snapshot={snapshot} actions={actions} />
      </section>
      <Toast message={toast.message} id={toast.id} />
    </div>
  );
}

/** `/builds/$buildId/snapshots/$snapshotId`: one story's comparison and its review. */
export function SnapshotPage({ buildId, snapshotId, filter }: SnapshotPageProps): ReactElement {
  const data = useBuildData(buildId);
  if (data.status === 'pending') return <Skeleton label="Loading snapshot…" variant="viewer" />;
  if (data.status === 'error') return <ErrorView error={data.error} />;
  const snapshot = data.snapshots.find((candidate) => candidate.id === snapshotId);
  if (!snapshot) return <NotFound message="This build has no such snapshot." />;
  return (
    <SnapshotDetail
      item={data.build}
      project={data.project}
      snapshots={data.snapshots}
      snapshot={snapshot}
      filter={effectiveFilter(filter, data.snapshots)}
    />
  );
}
