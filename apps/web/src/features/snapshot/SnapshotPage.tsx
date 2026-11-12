import { useQuery } from '@tanstack/react-query';
import {
  displayPixelRatio,
  type Build,
  type BuildWithSummary,
  type ProjectSummary,
  type Snapshot,
} from '@targus/core/browser';
import type { ReactElement } from 'react';

import { getBuild, queryKeys } from '../../api-client/index.ts';
import { shortSha } from '../../components/format.ts';
import { Skeleton } from '../../components/Skeleton.tsx';
import { Toast } from '../../components/Toast.tsx';
import {
  effectiveFilter,
  FailedDecisions,
  type SnapshotFilter,
  useBuildData,
} from '../build/index.ts';
import { ErrorView, NotFound, RefetchNotice } from '../errors/index.ts';
import { StoryHistory } from '../history/index.ts';
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
  readonly refetchError: Error | null;
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
  readonly build: Build;
  readonly snapshots: readonly Snapshot[];
  readonly snapshot: Snapshot;
  readonly viewer: ViewerState;
  readonly labels: ViewerLabels;
  readonly baseline: BuildWithSummary | null | undefined;
}): ReactElement {
  return (
    <div className="snapshot-content">
      <FailedDecisions buildId={props.build.id} snapshots={props.snapshots} />
      <StateNotice state={props.snapshot.state} />
      <SnapshotViewer
        snapshot={props.snapshot}
        viewer={props.viewer}
        labels={props.labels}
        pixelRatio={displayPixelRatio(props.build)}
      />
      <BaselineSection baseline={props.baseline} />
      <StoryHistory
        projectId={props.build.projectId}
        story={{
          storyId: props.snapshot.storyId,
          variant: props.snapshot.variant,
          platform: props.build.platform,
        }}
        currentSnapshotId={props.snapshot.id}
      />
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
    imagesLoaded: viewer.imagesLoaded,
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
        <RefetchNotice error={props.refetchError} />
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
          build={item.build}
          snapshots={props.snapshots}
          snapshot={snapshot}
          viewer={viewer}
          labels={viewerLabels(item, baseline)}
          baseline={baseline}
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
      refetchError={data.refetchError}
    />
  );
}
