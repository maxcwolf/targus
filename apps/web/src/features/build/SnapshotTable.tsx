import { Link } from '@tanstack/react-router';
import type { Snapshot } from '@targus/core';
import { type ReactElement, useState } from 'react';

import { ReviewPill, StateBadge } from '../../components/Badges.js';
import { formatPercent } from '../../components/format.js';
import { CaretIcon, OpenIcon } from '../../components/icons.js';
import { Initial } from '../../components/StatusCircle.js';
import {
  groupByTitle,
  isReviewable,
  type SnapshotFilter,
  type SnapshotGroup,
  storyName,
} from './filters.js';
import { ReviewProgress } from './ReviewProgress.js';

export interface SnapshotTableProps {
  readonly buildId: string;
  readonly snapshots: readonly Snapshot[];
  readonly filter: SnapshotFilter;
}

interface RowProps {
  readonly buildId: string;
  readonly snapshot: Snapshot;
  readonly filter: SnapshotFilter;
}

function Status({ snapshot }: { readonly snapshot: Snapshot }): ReactElement {
  if (!isReviewable(snapshot)) return <StateBadge state={snapshot.state} />;
  return (
    <span className="status-cell">
      <ReviewPill review={snapshot.review} />
      {snapshot.review !== 'pending' && snapshot.reviewedBy ? (
        <Initial login={snapshot.reviewedBy} />
      ) : null}
    </span>
  );
}

function StoryRow({ buildId, snapshot, filter }: RowProps): ReactElement {
  const to = '/builds/$buildId/snapshots/$snapshotId';
  const params = { buildId, snapshotId: snapshot.id };
  return (
    <tr className="story-row">
      <td className="story-cell">
        <Link to={to} params={params} search={{ filter }} className="story-link">
          {storyName(snapshot)}
        </Link>
        <span className="story-id">
          {snapshot.storyId}
          {snapshot.variant === 'default' ? '' : ` · ${snapshot.variant}`}
        </span>
        {snapshot.diffRatio === null ? null : (
          <span className="diff-ratio">{formatPercent(snapshot.diffRatio)}</span>
        )}
      </td>
      <td>
        <Status snapshot={snapshot} />
      </td>
      <td className="actions-cell">
        <Link
          to={to}
          params={params}
          search={{ filter }}
          className="icon-button"
          aria-label="Open snapshot"
          title="Open snapshot"
        >
          <OpenIcon />
        </Link>
      </td>
    </tr>
  );
}

function Group({
  group,
  buildId,
  filter,
}: { readonly group: SnapshotGroup } & Omit<RowProps, 'snapshot'>) {
  const [open, setOpen] = useState(true);
  return (
    <tbody aria-label={group.title}>
      <tr className="group-row">
        <td colSpan={3}>
          <button
            type="button"
            className={open ? 'group-toggle open' : 'group-toggle'}
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
            }}
          >
            <CaretIcon />
            <span className="group-title">{group.title}</span>
            <span className="lighter">· {group.snapshots.length}</span>
          </button>
          <ReviewProgress snapshots={group.snapshots} compact />
        </td>
      </tr>
      {open
        ? group.snapshots.map((snapshot) => (
            <StoryRow key={snapshot.id} buildId={buildId} snapshot={snapshot} filter={filter} />
          ))
        : null}
    </tbody>
  );
}

/** "Changes | Status | Actions": component rows with their stories indented under them. */
export function SnapshotTable({ buildId, snapshots, filter }: SnapshotTableProps): ReactElement {
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
    <table className="snap-table">
      <thead>
        <tr>
          <th>Changes</th>
          <th>Status</th>
          <th className="actions-cell">Actions</th>
        </tr>
      </thead>
      {groupByTitle(snapshots).map((group) => (
        <Group key={group.title} group={group} buildId={buildId} filter={filter} />
      ))}
    </table>
  );
}
