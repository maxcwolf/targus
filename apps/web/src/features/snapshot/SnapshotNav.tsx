import { Link } from '@tanstack/react-router';
import type { Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import { Kbd } from '../../components/Kbd.js';
import type { SnapshotFilter } from '../build/filters.js';

export interface SnapshotNavProps {
  readonly buildId: string;
  readonly filter: SnapshotFilter;
  readonly previous: Snapshot | undefined;
  readonly next: Snapshot | undefined;
  readonly position: string;
}

function NavLink(props: {
  readonly buildId: string;
  readonly filter: SnapshotFilter;
  readonly target: Snapshot | undefined;
  readonly label: string;
  readonly shortcut: string;
}): ReactElement {
  const { buildId, filter, target, label, shortcut } = props;
  if (!target) {
    return (
      <span className="button small nav-link disabled" aria-disabled="true">
        {label} <Kbd>{shortcut}</Kbd>
      </span>
    );
  }
  return (
    <Link
      className="button small nav-link"
      to="/builds/$buildId/snapshots/$snapshotId"
      params={{ buildId, snapshotId: target.id }}
      search={{ filter }}
      aria-label={label}
      aria-keyshortcuts={shortcut}
    >
      {label} <Kbd>{shortcut}</Kbd>
    </Link>
  );
}

/** Previous / next through the build's snapshots in the current filter's order. */
export function SnapshotNav({
  buildId,
  filter,
  previous,
  next,
  position,
}: SnapshotNavProps): ReactElement {
  return (
    <nav className="snapshot-nav" aria-label="Snapshots">
      <NavLink buildId={buildId} filter={filter} target={previous} label="Previous" shortcut="k" />
      <span className="position">{position}</span>
      <NavLink buildId={buildId} filter={filter} target={next} label="Next" shortcut="j" />
    </nav>
  );
}
