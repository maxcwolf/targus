import { Link } from '@tanstack/react-router';
import type { Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import { ReviewBadge, StateBadge } from '../../components/Badges.js';
import { formatPercent } from '../../components/format.js';
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

function SnapshotRow({ buildId, snapshot, filter }: SnapshotRowProps): ReactElement {
  return (
    <li className="snapshot-row">
      <Link
        to="/builds/$buildId/snapshots/$snapshotId"
        params={{ buildId, snapshotId: snapshot.id }}
        search={{ filter }}
      >
        {storyName(snapshot)}
      </Link>
      {snapshot.variant === 'default' ? null : <span className="muted">{snapshot.variant}</span>}
      <StateBadge state={snapshot.state} />
      {isReviewable(snapshot) ? <ReviewBadge review={snapshot.review} /> : null}
      {snapshot.diffRatio === null ? null : (
        <span className="diff-ratio">{formatPercent(snapshot.diffRatio)}</span>
      )}
    </li>
  );
}

/** The filtered snapshots, grouped by component title. */
export function SnapshotList({ buildId, snapshots, filter }: SnapshotListProps): ReactElement {
  if (snapshots.length === 0) {
    return <p className="muted">No snapshots match this filter.</p>;
  }
  return (
    <div className="snapshot-groups">
      {groupByTitle(snapshots).map((group) => (
        <section key={group.title} className="snapshot-group" aria-label={group.title}>
          <h2>{group.title}</h2>
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
