import type { QueryClient } from '@tanstack/react-query';
import type { BuildWithSummary } from '@targus/core';

import { queryKeys } from '../../api-client/index.js';

/**
 * After a review decision: store the build the API answered with, and refetch the lists that
 * show it (its snapshots and the project's builds).
 */
export async function applyBuildUpdate(
  queryClient: QueryClient,
  update: BuildWithSummary,
): Promise<void> {
  const { build } = update;
  queryClient.setQueryData<BuildWithSummary>(queryKeys.build(build.id), {
    build,
    summary: update.summary,
    counts: update.counts,
  });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.snapshots(build.id), exact: true }),
    queryClient.invalidateQueries({ queryKey: queryKeys.builds(build.projectId), exact: true }),
  ]);
}
