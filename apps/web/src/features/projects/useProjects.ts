import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { ListProjectsResponse } from '@targus/core';

import { listProjects, queryKeys } from '../../api-client/index.ts';

/** The reviewer's projects. Pages look a project up here for its name and repo. */
export function useProjects(enabled = true): UseQueryResult<ListProjectsResponse> {
  return useQuery({ queryKey: queryKeys.projects, queryFn: listProjects, enabled });
}
