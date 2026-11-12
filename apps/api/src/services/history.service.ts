import { TargusError, type GetStoryHistoryQuery, type GetStoryHistoryResponse } from '@targus/core';

import { requireProjectAccess } from './access.service.ts';
import { toSnapshot, withSummary } from './build.service.ts';
import type { ServiceDeps } from './deps.ts';
import type { Reviewer } from './principal.ts';

type HistoryDeps = Pick<
  ServiceDeps,
  'builds' | 'clock' | 'github' | 'log' | 'memberships' | 'projects'
>;

/**
 * `GET /api/projects/:id/history`: where one story of one platform stopped being `unchanged`,
 * across the project's builds on every branch, newest first. A story no build has captured has
 * an empty history rather than an error.
 */
export async function getStoryHistory(
  deps: HistoryDeps,
  reviewer: Reviewer,
  projectId: string,
  query: GetStoryHistoryQuery,
): Promise<GetStoryHistoryResponse> {
  const project = await deps.projects.findById(projectId);
  if (project === null) throw new TargusError('not_found', `no project ${projectId}`);
  await requireProjectAccess(deps, { kind: 'reviewer', reviewer }, project);
  const { limit, ...story } = query;
  const records = await deps.builds.listStoryHistory(project.id, story, limit);
  return {
    entries: records.map(({ build, snapshot }) => ({
      build: withSummary(build).build,
      snapshot: toSnapshot(snapshot),
    })),
  };
}
