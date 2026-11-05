import { Link } from '@tanstack/react-router';
import type { Snapshot } from '@targus/core';
import { type ReactElement, useEffect, useRef } from 'react';

import { formatPercent } from '../../components/format.js';
import { PathText } from '../../components/PathText.js';
import { groupByTitle, isReviewable, type SnapshotFilter, storyName } from '../build/filters.js';

export interface SnapshotSidebarProps {
  readonly buildId: string;
  readonly snapshots: readonly Snapshot[];
  readonly currentId: string;
  readonly filter: SnapshotFilter;
}

/** The dot colour: the review for reviewable snapshots, otherwise the state. */
function dotClass(snapshot: Snapshot): string {
  return isReviewable(snapshot) ? `dot review-${snapshot.review}` : `dot state-${snapshot.state}`;
}

/** The build's snapshots in navigation order, grouped by title, with the current one marked. */
export function SnapshotSidebar(props: SnapshotSidebarProps): ReactElement {
  const { buildId, snapshots, currentId, filter } = props;
  const currentRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);
  return (
    <nav className="sidebar" aria-label="Build snapshots">
      {groupByTitle(snapshots).map((group) => (
        <section key={group.title} className="sidebar-group">
          <h2>
            <PathText text={group.title} />
          </h2>
          <ul>
            {group.snapshots.map((snapshot) => {
              const current = snapshot.id === currentId;
              return (
                <li key={snapshot.id} ref={current ? currentRow : undefined}>
                  <Link
                    to="/builds/$buildId/snapshots/$snapshotId"
                    params={{ buildId, snapshotId: snapshot.id }}
                    search={{ filter }}
                    className={current ? 'sidebar-link current' : 'sidebar-link'}
                    aria-current={current ? 'page' : undefined}
                    aria-label={storyName(snapshot)}
                  >
                    <span className={dotClass(snapshot)} aria-hidden="true" />
                    <span className="sidebar-name">{storyName(snapshot)}</span>
                    {snapshot.diffRatio === null ? null : (
                      <span className="diff-ratio">{formatPercent(snapshot.diffRatio)}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
