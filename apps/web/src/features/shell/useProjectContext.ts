import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import type { ProjectSummary } from '@targus/core';

import { getBuild, queryKeys } from '../../api-client/index.js';
import { useProjects } from '../projects/useProjects.js';

/** The route params of the deepest match, whichever route it is. */
function useRouteIds(): { projectId?: string; buildId?: string } {
  const params = useRouterState({ select: (state) => state.matches.at(-1)?.params });
  if (!params) return {};
  if ('buildId' in params) return { buildId: params.buildId };
  if ('projectId' in params) return { projectId: params.projectId };
  return {};
}

/**
 * The project the current page belongs to, for the top bar path and the rail's Builds link:
 * the project route's own id, or the project of the build being viewed. It shares the pages'
 * query keys, so it costs no extra requests once a page has loaded.
 */
export function useProjectContext(signedIn: boolean): ProjectSummary | undefined {
  const { projectId, buildId } = useRouteIds();
  const build = useQuery({
    queryKey: queryKeys.build(buildId ?? ''),
    queryFn: () => getBuild(buildId ?? ''),
    enabled: signedIn && buildId !== undefined,
  });
  const projects = useProjects(signedIn && (projectId ?? buildId) !== undefined);
  const id = projectId ?? build.data?.build.projectId;
  return projects.data?.projects.find((project) => project.id === id);
}
