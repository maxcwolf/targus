import type { SnapshotCounts } from '@targus/core';
import type { ReactElement } from 'react';

const shown = ['changed', 'new', 'removed', 'unstable', 'error'] as const;

/** Non-zero per-state counts as small coloured chips, then a muted unchanged count. */
export function BuildCounts({ counts }: { readonly counts: SnapshotCounts }): ReactElement {
  return (
    <span className="counts">
      {shown
        .filter((state) => counts[state] > 0)
        .map((state) => (
          <span key={state} className={`count-chip state-${state}`}>
            {counts[state]} {state === 'error' && counts.error > 1 ? 'errors' : state}
          </span>
        ))}
      <span className="muted">{counts.unchanged} unchanged</span>
    </span>
  );
}
