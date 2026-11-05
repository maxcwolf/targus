import type { SnapshotCounts } from '@targus/core';
import type { ReactElement } from 'react';

const shown = ['changed', 'new', 'removed', 'unstable'] as const;

/** The per-state counts of one build: always the four review states, errors only when present. */
export function BuildCounts({ counts }: { readonly counts: SnapshotCounts }): ReactElement {
  return (
    <span className="counts">
      {shown.map((state) => (
        <span key={state} className={`count count-${state}`}>
          {counts[state]} {state}
        </span>
      ))}
      {counts.error > 0 ? (
        <span className="count count-error">
          {counts.error} {counts.error === 1 ? 'error' : 'errors'}
        </span>
      ) : null}
    </span>
  );
}
