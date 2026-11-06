import type { QueryClient } from '@tanstack/react-query';
import type { BuildWithSummary } from '@targus/core';

import { queryKeys } from '../../api-client/index.ts';

/**
 * After a review decision: store the build the API answered with (synchronously, so the page
 * shows it at once), and start refetching the lists that show it (its snapshots and the
 * project's builds). The returned promise settles when those refetches do.
 */
export function applyBuildUpdate(
  queryClient: QueryClient,
  update: BuildWithSummary,
): Promise<void> {
  const { build } = update;
  queryClient.setQueryData<BuildWithSummary>(queryKeys.build(build.id), {
    build,
    summary: update.summary,
    counts: update.counts,
  });
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.snapshots(build.id), exact: true }),
    queryClient.invalidateQueries({ queryKey: queryKeys.builds(build.projectId), exact: true }),
  ]).then(() => undefined);
}
