import { ListBuildsResponse, ListProjectsResponse } from '@targus/core';

import { getJson } from './http.js';

/** `GET /api/projects`: the projects of every org the reviewer belongs to. */
export function listProjects(): Promise<ListProjectsResponse> {
  return getJson('/api/projects', ListProjectsResponse);
}

/** `GET /api/projects/:id/builds`, newest first. */
export function listBuilds(projectId: string, limit = 50): Promise<ListBuildsResponse> {
  const path = `/api/projects/${encodeURIComponent(projectId)}/builds?limit=${limit}`;
  return getJson(path, ListBuildsResponse);
}
