import { needsReview, type Snapshot } from '@targus/core';

/** The build page's filter tabs, in display order. */
const snapshotFilters = [
  'unreviewed',
  'approved',
  'denied',
  'new',
  'removed',
  'changed',
  'all',
] as const;
export type SnapshotFilter = (typeof snapshotFilters)[number];

/** The `?filter=` search param shared by the build and snapshot routes. */
export interface FilterSearch {
  readonly filter?: SnapshotFilter;
}

const labels: Record<SnapshotFilter, string> = {
  unreviewed: 'Unreviewed',
  approved: 'Approved',
  denied: 'Denied',
  new: 'New',
  removed: 'Removed',
  changed: 'Changed',
  all: 'All',
};

/** Only `changed` and `new` snapshots take a decision (ADR 0004). */
export function isReviewable(snapshot: Snapshot): boolean {
  return needsReview(snapshot.state);
}

const predicates: Record<SnapshotFilter, (snapshot: Snapshot) => boolean> = {
  unreviewed: (s) => isReviewable(s) && s.review === 'pending',
  approved: (s) => isReviewable(s) && s.review === 'approved',
  denied: (s) => isReviewable(s) && s.review === 'denied',
  new: (s) => s.state === 'new',
  removed: (s) => s.state === 'removed',
  changed: (s) => s.state === 'changed',
  all: () => true,
};

function isFilter(value: unknown): value is SnapshotFilter {
  return snapshotFilters.some((filter) => filter === value);
}

/** TanStack Router `validateSearch` for both routes: unknown filters are dropped. */
export function validateFilterSearch(search: Record<string, unknown>): FilterSearch {
  return isFilter(search.filter) ? { filter: search.filter } : {};
}

export function matchesFilter(snapshot: Snapshot, filter: SnapshotFilter): boolean {
  return predicates[filter](snapshot);
}

/** Without `?filter=`, open on the unreviewed changes when there are any, else on everything. */
export function effectiveFilter(
  filter: SnapshotFilter | undefined,
  snapshots: readonly Snapshot[],
): SnapshotFilter {
  if (filter) return filter;
  return snapshots.some(predicates.unreviewed) ? 'unreviewed' : 'all';
}

/** Tab descriptors with how many snapshots each filter shows. */
export function filterTabs(
  snapshots: readonly Snapshot[],
): { id: SnapshotFilter; label: string; count: number }[] {
  return snapshotFilters.map((id) => ({
    id,
    label: labels[id],
    count: snapshots.filter(predicates[id]).length,
  }));
}

export function pendingReviewCount(snapshots: readonly Snapshot[]): number {
  return snapshots.filter(predicates.unreviewed).length;
}

/** Storybook's component title, else the part of the story id before `--`. */
export function componentTitle(snapshot: Snapshot): string {
  return snapshot.title ?? snapshot.storyId.split('--')[0] ?? snapshot.storyId;
}

/** Storybook's story name, else the story id. */
export function storyName(snapshot: Snapshot): string {
  return snapshot.name ?? snapshot.storyId;
}

export interface SnapshotGroup {
  readonly title: string;
  readonly snapshots: readonly Snapshot[];
}

/** Groups snapshots by component title, keeping the order they arrived in. */
export function groupByTitle(snapshots: readonly Snapshot[]): SnapshotGroup[] {
  const groups = new Map<string, Snapshot[]>();
  for (const snapshot of snapshots) {
    const title = componentTitle(snapshot);
    const group = groups.get(title);
    if (group) group.push(snapshot);
    else groups.set(title, [snapshot]);
  }
  return [...groups].map(([title, members]) => ({ title, snapshots: members }));
}

/**
 * The snapshots `j`/`k` step through: the filter's matches in build order, plus the snapshot
 * being viewed even when a decision just moved it out of the filter, so its neighbours stay put.
 */
export function navigationList(
  snapshots: readonly Snapshot[],
  filter: SnapshotFilter,
  currentId: string,
): Snapshot[] {
  return snapshots.filter((s) => s.id === currentId || matchesFilter(s, filter));
}
