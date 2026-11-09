import {
  libraryStories,
  Platform,
  TargusError,
  type GetLibraryQuery,
  type GetLibraryResponse,
} from '@targus/core';

import { requireProjectAccess } from './access.service.ts';
import { toSnapshot, withSummary } from './build.service.ts';
import type { ServiceDeps } from './deps.ts';
import type { Reviewer } from './principal.ts';

type LibraryDeps = Pick<
  ServiceDeps,
  'builds' | 'clock' | 'github' | 'log' | 'memberships' | 'projects'
>;

/**
 * `GET /api/projects/:id/library`: every story of one platform of the project as it currently
 * looks on the default branch, which is the newest build of that platform there a reviewer has
 * signed off (ADR 0036). The platform is the query's, else the first in `Platform` order that
 * has such a build. Until one exists the library is empty rather than an error: a new project,
 * or a new platform of one, simply has nothing accepted yet.
 */
export async function getLibrary(
  deps: LibraryDeps,
  reviewer: Reviewer,
  projectId: string,
  query: GetLibraryQuery = {},
): Promise<GetLibraryResponse> {
  const project = await deps.projects.findById(projectId);
  if (project === null) throw new TargusError('not_found', `no project ${projectId}`);
  await requireProjectAccess(deps, { kind: 'reviewer', reviewer }, project);
  const found = await deps.builds.listBaselinePlatformsOnBranch(project.id, project.defaultBranch);
  const platforms = Platform.options.filter((platform) => found.includes(platform));
  const platform = query.platform ?? platforms[0] ?? null;
  const build =
    platform === null
      ? null
      : await deps.builds.findLatestBaselineOnBranch(project.id, platform, project.defaultBranch);
  if (build === null) return { platform, platforms, build: null, stories: [] };
  const snapshots = await deps.builds.listSnapshots(build.id);
  return {
    platform,
    platforms,
    build: withSummary(build).build,
    stories: libraryStories(snapshots.map(toSnapshot)),
  };
}
