import { useQuery } from '@tanstack/react-query';
import type { BuildWithSummary, ProjectSummary, Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import { getBuild, queryKeys } from '../../api-client/index.ts';
import { shortSha } from '../../components/format.ts';
import { Skeleton } from '../../components/Skeleton.tsx';
import { Toast } from '../../components/Toast.tsx';
import { effectiveFilter, type SnapshotFilter } from '../build/filters.ts';
import { useBuildData } from '../build/useBuildData.ts';
import { ErrorView, NotFound } from '../errors/ErrorView.tsx';
import { ReviewActions } from './ReviewActions.tsx';
import { SnapshotBar } from './SnapshotBar.tsx';
import { SnapshotSidebar } from './SnapshotSidebar.tsx';
import { SnapshotViewer, type ViewerLabels } from './SnapshotViewer.tsx';
import { StateNotice } from './StateNotice.tsx';
import { useSnapshotReview } from './useSnapshotReview.ts';
import { useToast } from './useToast.ts';
import { useViewer, type ViewerState } from './useViewer.ts';

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

/** The baseline build, for "Build 11 on main" and the BASELINE line. Null when there is none. */
function useBaseline(baselineBuildId: string | null): BuildWithSummary | null | undefined {
  const baseline = useQuery({
    queryKey: queryKeys.build(baselineBuildId ?? ''),
    queryFn: () => getBuild(baselineBuildId ?? ''),
    enabled: baselineBuildId !== null,
  });
  return baselineBuildId === null ? null : baseline.data;
}

function BaselineSection({ baseline }: { readonly baseline: BuildWithSummary | null | undefined }) {
  return (
    <section className="baseline-section">
      <p className="section-label">Baseline</p>
      <p className="muted">
        {baseline === null
          ? 'No baseline: first build on this branch'
          : baseline
            ? `Compared with build ${baseline.build.number} (${shortSha(baseline.build.sha)})`
            : 'Compared with the baseline build'}
      </p>
    </section>
  );
}

function viewerLabels(
  item: BuildWithSummary,
  baseline: BuildWithSummary | null | undefined,
): ViewerLabels {
  const on = (b: BuildWithSummary): string => `Build ${b.build.number} on ${b.build.branch}`;
  return {
    baseline: baseline ? on(baseline) : baseline === null ? 'none' : '…',
    current: on(item),
  };
}

function SnapshotContent(props: {
  readonly snapshot: Snapshot;
  readonly viewer: ViewerState;
  readonly labels: ViewerLabels;
  readonly baseline: BuildWithSummary | null | undefined;
  readonly error: Error | null;
}): ReactElement {
  return (
    <div className="snapshot-content">
      {props.error ? (
        <p role="alert" className="error-text">
          {props.error.message}
        </p>
      ) : null}
      <StateNotice state={props.snapshot.state} />
      <SnapshotViewer snapshot={props.snapshot} viewer={props.viewer} labels={props.labels} />
      <BaselineSection baseline={props.baseline} />
    </div>
  );
}

function SnapshotDetail(props: DetailProps): ReactElement {
  const { item, snapshot, filter } = props;
  const toast = useToast();
  const viewer = useViewer(snapshot);
  const baseline = useBaseline(item.build.baselineBuildId);
  const { review, list, index, previous, next, canReview, decide } = useSnapshotReview({
    ...props,
    notify: toast.show,
  });
  return (
    <div className="snapshot-layout">
      <SnapshotSidebar
        buildId={item.build.id}
        snapshots={list}
        currentId={snapshot.id}
        filter={filter}
      />
      <section className="snapshot-main">
        <SnapshotBar
          item={item}
          snapshot={snapshot}
          filter={filter}
          viewer={viewer}
          previous={previous}
          next={next}
          position={`${index + 1} of ${list.length}`}
          actions={
            <ReviewActions
              review={snapshot.review}
              disabled={!canReview}
              busy={review.isPending}
              onDecide={decide}
            />
          }
        />
        <SnapshotContent
          snapshot={snapshot}
          viewer={viewer}
          labels={viewerLabels(item, baseline)}
          baseline={baseline}
          error={review.error}
        />
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
