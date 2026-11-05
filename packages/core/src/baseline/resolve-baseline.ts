import type { Build, BuildStatus } from '../contracts/build.js';

/** The build fields baseline resolution reads. */
export type BaselineCandidate = Pick<Build, 'id' | 'sha' | 'status' | 'createdAt'>;

/** Statuses whose images may serve as a baseline: everything a reviewer has signed off. */
const successfulStatuses: ReadonlySet<BuildStatus> = new Set<BuildStatus>(['passed', 'accepted']);

/**
 * The shas to search for a baseline, nearest first (plan.md section 6, rule 1): the merge base,
 * then its first-parent ancestors as the CLI sent them, without duplicates. A build with no merge
 * base (a first build, or a branch unrelated to the default branch) has no baseline.
 */
export function baselineShaOrder(
  mergeBaseSha: string | null,
  ancestors: readonly string[],
): string[] {
  if (mergeBaseSha === null) return [];
  return [...new Set([mergeBaseSha, ...ancestors])];
}

function isMoreRecent(a: BaselineCandidate, b: BaselineCandidate): boolean {
  const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return byTime === 0 ? a.id > b.id : byTime > 0;
}

/**
 * Pick the baseline build (plan.md section 6, rule 1): among the successful candidates on the
 * earliest sha of `shaOrder` that has any, the most recent by `createdAt`, ties broken by the
 * greater `id`. `null` when no sha in the order has a successful build.
 *
 * `BuildRepository.findLatestSuccessfulForShas` is the database-side equivalent and must agree
 * with this function; `baselineResolutionCases` is the shared table both are tested against.
 */
export function resolveBaseline<T extends BaselineCandidate>(
  shaOrder: readonly string[],
  candidates: readonly T[],
): T | null {
  const successful = candidates.filter((candidate) => successfulStatuses.has(candidate.status));
  for (const sha of shaOrder) {
    const onSha = successful.filter((candidate) => candidate.sha === sha);
    const latest = onSha.reduce<T | null>(
      (best, candidate) => (best === null || isMoreRecent(candidate, best) ? candidate : best),
      null,
    );
    if (latest !== null) return latest;
  }
  return null;
}
