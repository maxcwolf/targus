import { libraryStories, TargusError, type GetLibraryResponse } from '@targus/core';

import { requireProjectAccess } from './access.service.js';
import { toSnapshot, withSummary } from './build.service.js';
import type { ServiceDeps } from './deps.js';
import type { Reviewer } from './principal.js';

type LibraryDeps = Pick<ServiceDeps, 'builds' | 'clock' | 'github' | 'memberships' | 'projects'>;

/**
 * `GET /api/projects/:id/library`: every story of the project as it currently looks on the
 * default branch, which is the newest build there a reviewer has signed off. Until one exists
 * the library is empty rather than an error: a new project simply has nothing accepted yet.
 */
export async function getLibrary(
  deps: LibraryDeps,
  reviewer: Reviewer,
  projectId: string,
): Promise<GetLibraryResponse> {
  const project = await deps.projects.findById(projectId);
  if (project === null) throw new TargusError('not_found', `no project ${projectId}`);
  await requireProjectAccess(deps, { kind: 'reviewer', reviewer }, project);
  const build = await deps.builds.findLatestBaselineOnBranch(project.id, project.defaultBranch);
  if (build === null) return { build: null, stories: [] };
  const snapshots = await deps.builds.listSnapshots(build.id);
  return { build: withSummary(build).build, stories: libraryStories(snapshots.map(toSnapshot)) };
}
