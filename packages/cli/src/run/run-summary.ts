import { SnapshotState } from '@targus/core';

import type { RunBuildOutput } from './run-build.ts';

/**
 * Human summary printed by `targus run`: the build id on its own `build: <id>` line (for scripts),
 * a count per state, the build status and the links.
 */
export function formatRunSummary({ build, response, counts }: RunBuildOutput): string[] {
  const width = Math.max(...SnapshotState.options.map((state) => state.length));
  const rows = SnapshotState.options.map(
    (state) => `  ${state.padEnd(width)}  ${String(counts[state]).padStart(4)}`,
  );
  const { status, pendingCount, deniedCount, errorCount } = response.summary;
  const checkRun =
    response.checkRun === null
      ? 'check run: none (the project has no GitHub App installation)'
      : `check run: ${response.checkRun.id}`;
  return [
    `build: ${build.id}`,
    `build #${build.number} (${build.id}): ${status}`,
    ...rows,
    `${pendingCount} to review, ${deniedCount} denied, ${errorCount} errored`,
    `review: ${response.reviewUrl}`,
    checkRun,
  ];
}
