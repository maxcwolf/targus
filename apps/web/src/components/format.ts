const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** An absolute, locale-formatted timestamp (the UI never shows relative times). */
export function formatDateTime(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/**
 * Where a build ran, e.g. `iPhone 16 · dark`. A build from a CLI that did not pin the appearance
 * shows the device alone (ADR 0034).
 */
export function deviceLabel(build: {
  readonly device: string;
  readonly appearance: string | null;
}): string {
  return build.appearance === null ? build.device : `${build.device} · ${build.appearance}`;
}

/** The 7-character abbreviation of a commit sha. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** A 0..1 ratio as a percentage with two decimals, e.g. `1.23%`. */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

export function commitUrl(repo: string, sha: string): string {
  return `https://github.com/${repo}/commit/${sha}`;
}

export function pullRequestUrl(repo: string, prNumber: number): string {
  return `https://github.com/${repo}/pull/${prNumber}`;
}

/** `1 change` / `3 changes`. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

interface StateCounts {
  readonly unchanged: number;
  readonly changed: number;
  readonly new: number;
  readonly removed: number;
  readonly unstable: number;
  readonly error: number;
}

/** Stories captured in the build: every snapshot except the removed ones. */
export function storyCount(counts: StateCounts): number {
  return counts.unchanged + counts.changed + counts.new + counts.unstable + counts.error;
}

/** Visual changes a reviewer decides on: changed and new stories. */
export function changeCount(counts: StateCounts): number {
  return counts.changed + counts.new;
}

/** `1 story` / `355 stories`. */
export function storyLabel(count: number): string {
  return `${count} ${count === 1 ? 'story' : 'stories'}`;
}
