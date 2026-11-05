import type { SnapshotCounts } from '@targus/core';
import type { ReactElement } from 'react';

import { changeCount, plural, storyCount, storyLabel } from '../../components/format.js';

/**
 * "6 changes · 1 new · 1 removed", where changes are changed plus new (as on the build page),
 * with only the non-zero extras, then the story count.
 */
export function BuildCounts({ counts }: { readonly counts: SnapshotCounts }): ReactElement {
  const parts = [
    plural(changeCount(counts), 'change'),
    counts.new > 0 ? `${counts.new} new` : null,
    counts.removed > 0 ? `${counts.removed} removed` : null,
    counts.unstable > 0 ? `${counts.unstable} unstable` : null,
    counts.error > 0 ? plural(counts.error, 'error') : null,
  ].filter((part) => part !== null);
  return (
    <span className="build-counts">
      <span className={counts.error > 0 ? 'counts-line has-error' : 'counts-line'}>
        {parts.join(' · ')}
      </span>
      <span className="lighter">{storyLabel(storyCount(counts))}</span>
    </span>
  );
}
