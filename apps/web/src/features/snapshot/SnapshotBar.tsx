import { Link } from '@tanstack/react-router';
import type { BuildWithSummary, Snapshot } from '@targus/core/browser';
import type { ReactElement, ReactNode } from 'react';

import { ReviewBadge, StateBadge } from '../../components/Badges.tsx';
import { deviceLabel, formatDateTime } from '../../components/format.ts';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons.tsx';
import { StatusCircle } from '../../components/StatusCircle.tsx';
import { Tabs } from '../../components/Tabs.tsx';
import {
  componentTitle,
  isReviewable,
  type SnapshotFilter,
  storyNameWithVariant,
} from '../build/index.ts';
import type { ViewerMode, ViewerState } from './useViewer.ts';

const modes: readonly { id: ViewerMode; label: string }[] = [
  { id: 'one-up', label: '1 up' },
  { id: 'two-up', label: '2 up' },
  { id: 'slider', label: 'Slider' },
];

export interface SnapshotBarProps {
  readonly item: BuildWithSummary;
  readonly snapshot: Snapshot;
  readonly filter: SnapshotFilter;
  readonly viewer: ViewerState;
  readonly previous: Snapshot | undefined;
  readonly next: Snapshot | undefined;
  readonly position: string;
  readonly actions: ReactNode;
}

function StepLink(props: {
  readonly item: BuildWithSummary;
  readonly filter: SnapshotFilter;
  readonly target: Snapshot | undefined;
  readonly label: 'Previous' | 'Next';
  readonly title: string;
}): ReactElement {
  const icon = props.label === 'Previous' ? <ChevronLeftIcon /> : <ChevronRightIcon />;
  if (!props.target) {
    return (
      <span className="icon-button disabled" aria-disabled="true" title={props.title}>
        {icon}
      </span>
    );
  }
  return (
    <Link
      className="icon-button"
      to="/builds/$buildId/snapshots/$snapshotId"
      params={{ buildId: props.item.build.id, snapshotId: props.target.id }}
      search={{ filter: props.filter }}
      aria-label={props.label}
      title={props.title}
    >
      {icon}
    </Link>
  );
}

function TitleBlock({ item, snapshot, filter }: SnapshotBarProps): ReactElement {
  const { build, summary } = item;
  const title = `${componentTitle(snapshot)} : ${storyNameWithVariant(snapshot)}`;
  return (
    <div className="bar-title">
      <Link
        to="/builds/$buildId"
        params={{ buildId: build.id }}
        search={{ filter }}
        className="icon-button back"
        aria-label={`Back to build ${build.number}`}
        title="Back to the build (Esc)"
      >
        <ChevronLeftIcon />
      </Link>
      <div className="bar-title-text">
        <h1 className="snapshot-title" title={title}>
          {title}
        </h1>
        <p className="subline">
          <StatusCircle status={summary.status} size={8} />
          Build {build.number} on <span className="mono">{build.branch}</span> ·{' '}
          {deviceLabel(build)}
        </p>
        <p className="meta">
          <StateBadge state={snapshot.state} />
          {isReviewable(snapshot) ? <ReviewBadge review={snapshot.review} /> : null}
          {snapshot.reviewedBy && snapshot.reviewedAt ? (
            <span className="lighter">
              by {snapshot.reviewedBy} on {formatDateTime(snapshot.reviewedAt)}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

/** The sticky header: back + title, the mode switch, previous/next and the decision buttons. */
export function SnapshotBar(props: SnapshotBarProps): ReactElement {
  const { viewer } = props;
  return (
    <div className="snapshot-bar">
      <TitleBlock {...props} />
      <Tabs
        label="Viewer mode"
        items={modes}
        active={viewer.mode}
        onSelect={viewer.setMode}
        segmented
      />
      <div className="bar-actions">
        <nav className="snapshot-nav" aria-label="Snapshots">
          <StepLink
            item={props.item}
            filter={props.filter}
            target={props.previous}
            label="Previous"
            title="Previous (k or ←)"
          />
          <span className="position">{props.position}</span>
          <StepLink
            item={props.item}
            filter={props.filter}
            target={props.next}
            label="Next"
            title="Next (j or →)"
          />
        </nav>
        {props.actions}
      </div>
    </div>
  );
}
