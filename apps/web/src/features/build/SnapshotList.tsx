import { Link } from '@tanstack/react-router';
import type { Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import { imageUrl } from '../../api-client/index.js';
import { ReviewBadge, StateBadge } from '../../components/Badges.js';
import { formatPercent } from '../../components/format.js';
import { SnapshotImage } from '../../components/SnapshotImage.js';
import { groupByTitle, isReviewable, type SnapshotFilter, storyName } from './filters.js';

export interface SnapshotListProps {
  readonly buildId: string;
  readonly snapshots: readonly Snapshot[];
  readonly filter: SnapshotFilter;
}

interface SnapshotRowProps {
  readonly buildId: string;
  readonly snapshot: Snapshot;
  readonly filter: SnapshotFilter;
}

/** The current capture, or the baseline for a removed story; a blank box when there is none. */
function Thumbnail({ snapshot }: { readonly snapshot: Snapshot }): ReactElement {
  const hash = snapshot.imageHash ?? snapshot.baselineHash;
  if (hash === null) return <span className="thumb thumb-empty" aria-hidden="true" />;
  return <SnapshotImage src={imageUrl(hash)} alt="" className="thumb" />;
}

function SnapshotRow({ buildId, snapshot, filter }: SnapshotRowProps): ReactElement {
  return (
    <li className="snapshot-row">
      <Thumbnail snapshot={snapshot} />
      <div className="snapshot-name">
        <Link
          to="/builds/$buildId/snapshots/$snapshotId"
          params={{ buildId, snapshotId: snapshot.id }}
          search={{ filter }}
          className="stretched-link"
        >
          {storyName(snapshot)}
        </Link>
        <span className="story-id">
          {snapshot.storyId}
          {snapshot.variant === 'default' ? '' : ` · ${snapshot.variant}`}
        </span>
      </div>
      <StateBadge state={snapshot.state} />
      {isReviewable(snapshot) ? <ReviewBadge review={snapshot.review} /> : null}
      <span className="diff-ratio">
        {snapshot.diffRatio === null ? '' : formatPercent(snapshot.diffRatio)}
      </span>
      <span className="chevron" aria-hidden="true">
        ›
      </span>
    </li>
  );
}

/** The filtered snapshots, grouped by component title. */
export function SnapshotList({ buildId, snapshots, filter }: SnapshotListProps): ReactElement {
  if (snapshots.length === 0) {
    return (
      <div className="empty-state">
        <p>Nothing to review</p>
        <Link to="/builds/$buildId" params={{ buildId }} search={{ filter: 'all' }}>
          Show all snapshots
        </Link>
      </div>
    );
  }
  return (
    <div className="snapshot-groups">
      {groupByTitle(snapshots).map((group) => (
        <section key={group.title} className="snapshot-group" aria-label={group.title}>
          <h2>
            {group.title} <span className="muted">· {group.snapshots.length}</span>
          </h2>
          <ul>
            {group.snapshots.map((snapshot) => (
              <SnapshotRow
                key={snapshot.id}
                buildId={buildId}
                snapshot={snapshot}
                filter={filter}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
