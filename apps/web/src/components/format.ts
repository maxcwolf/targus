const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** An absolute, locale-formatted timestamp (the UI never shows relative times). */
export function formatDateTime(iso: string): string {
  return dateFormat.format(new Date(iso));
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
