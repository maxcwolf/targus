import { SnapshotState, type CheckRunMissing, type SubmitResultsResponse } from '@targus/core';

import type { RunBuildOutput } from './run-build.ts';

/** What `targus run` prints when the build has no check run, by reason other than `failed`. */
const missingCheckRun: Record<Exclude<CheckRunMissing, 'failed'>, string> = {
  no_installation: 'check run: none (the project has no GitHub App installation)',
  no_github_app: 'check run: none (the server has no GitHub App configured)',
  pending: 'check run: still being created by an earlier attempt or a review',
};

/**
 * The check run line. A server older than `checkRunMissing` sends no reason. When GitHub failed,
 * the next review creates the check run, and a build with nothing to review gets no review, so
 * running `targus run` again is what retries it.
 */
function checkRunLine({ checkRun, checkRunMissing, summary }: SubmitResultsResponse): string {
  if (checkRun !== null) return `check run: ${checkRun.id}`;
  if (checkRunMissing !== 'failed') return missingCheckRun[checkRunMissing ?? 'no_installation'];
  const retry =
    summary.pendingCount > 0
      ? 'the next review of this build creates it'
      : 'run `targus run` again to retry';
  return `check run not created: GitHub failed; ${retry}`;
}

/**
 * Human summary printed by `targus run`: the build id on its own `build: <id>` line (for scripts),
 * a count per state, any skipped stories, the build status and the links.
 */
export function formatRunSummary({ build, response, counts, skipped }: RunBuildOutput): string[] {
  const width = Math.max(...SnapshotState.options.map((state) => state.length));
  const rows = SnapshotState.options.map(
    (state) => `  ${state.padEnd(width)}  ${String(counts[state]).padStart(4)}`,
  );
  const { status, pendingCount, deniedCount, errorCount } = response.summary;
  return [
    `build: ${build.id}`,
    `build #${build.number} (${build.id}): ${status}`,
    ...rows,
    ...(skipped.length === 0
      ? []
      : [`skipped (${skipped.length}, parameters.targus.skip): ${skipped.join(', ')}`]),
    `${pendingCount} to review, ${deniedCount} denied, ${errorCount} errored`,
    `review: ${response.reviewUrl}`,
    checkRunLine(response),
  ];
}
