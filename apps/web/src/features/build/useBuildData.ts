import { useQuery } from '@tanstack/react-query';
import type { BuildWithSummary, ProjectSummary, Snapshot } from '@targus/core';

import { getBuild, listSnapshots, queryKeys } from '../../api-client/index.js';
import { useProjects } from '../projects/useProjects.js';

export type BuildData =
  | { readonly status: 'pending' }
  | { readonly status: 'error'; readonly error: Error }
  | {
      readonly status: 'success';
      readonly build: BuildWithSummary;
      readonly snapshots: readonly Snapshot[];
      /** Undefined only if the project list does not include the build's project. */
      readonly project: ProjectSummary | undefined;
    };

/** Everything the build and snapshot pages need: the build, its snapshots and its project. */
export function useBuildData(buildId: string): BuildData {
  const build = useQuery({ queryKey: queryKeys.build(buildId), queryFn: () => getBuild(buildId) });
  const snapshots = useQuery({
    queryKey: queryKeys.snapshots(buildId),
    queryFn: () => listSnapshots(buildId),
  });
  const projects = useProjects();

  const error = build.error ?? snapshots.error ?? projects.error;
  if (error) return { status: 'error', error };
  if (!build.data || !snapshots.data || !projects.data) return { status: 'pending' };
  const projectId = build.data.build.projectId;
  return {
    status: 'success',
    build: build.data,
    snapshots: snapshots.data.snapshots,
    project: projects.data.projects.find((project) => project.id === projectId),
  };
}
