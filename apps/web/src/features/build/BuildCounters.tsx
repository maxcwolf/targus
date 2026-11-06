import type { Snapshot } from '@targus/core';
import type { ReactElement } from 'react';

import {
  counterFilters,
  type FilterTab,
  filterTabs,
  moreFilters,
  type SnapshotFilter,
} from './filters.ts';

export interface BuildCountersProps {
  readonly snapshots: readonly Snapshot[];
  readonly active: SnapshotFilter;
  readonly onSelect: (filter: SnapshotFilter) => void;
}

function Counter({
  tab,
  active,
  onSelect,
  small,
}: {
  readonly tab: FilterTab;
  readonly active: boolean;
  readonly onSelect: (filter: SnapshotFilter) => void;
  readonly small: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`${small ? 'more-filter' : 'counter'} counter-${tab.id}`}
      onClick={() => {
        onSelect(tab.id);
      }}
    >
      <span className="counter-value">{tab.count}</span>{' '}
      <span className="counter-caption">{tab.label}</span>
    </button>
  );
}

/**
 * "355 Stories · 6 Changes · 2 Accepted · 1 Denied · 3 Unreviewed": the counters are the
 * filter tabs. New / Removed / Changed sit under them as smaller filters.
 */
export function BuildCounters({ snapshots, active, onSelect }: BuildCountersProps): ReactElement {
  return (
    <div role="tablist" aria-label="Filter snapshots" className="counters">
      <div className="counter-row">
        {filterTabs(snapshots, counterFilters).map((tab) => (
          <Counter
            key={tab.id}
            tab={tab}
            active={tab.id === active}
            onSelect={onSelect}
            small={false}
          />
        ))}
      </div>
      <div className="more-row">
        <span className="lighter">More:</span>
        {filterTabs(snapshots, moreFilters).map((tab) => (
          <Counter key={tab.id} tab={tab} active={tab.id === active} onSelect={onSelect} small />
        ))}
      </div>
    </div>
  );
}
