import {
  defaultBuildsPageLimit,
  GetLibraryResponse,
  ListBuildsResponse,
  ListProjectsResponse,
} from '@targus/core';

import { getJson } from './http.ts';

/** `GET /api/projects`: the projects of every org the reviewer belongs to. */
export function listProjects(): Promise<ListProjectsResponse> {
  return getJson('/api/projects', ListProjectsResponse);
}

/** Which page of builds to read: the newest without a cursor, else after a page's cursor. */
export interface BuildsPageRequest {
  readonly cursor?: string | undefined;
  readonly limit?: number;
}

/** `GET /api/projects/:id/builds`: one page, newest first, with the next page's cursor. */
export function listBuilds(
  projectId: string,
  { cursor, limit = defaultBuildsPageLimit }: BuildsPageRequest = {},
): Promise<ListBuildsResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor !== undefined) query.set('cursor', cursor);
  const path = `/api/projects/${encodeURIComponent(projectId)}/builds?${query.toString()}`;
  return getJson(path, ListBuildsResponse);
}

/** `GET /api/projects/:id/library`: every story of the accepted default-branch build. */
export function getLibrary(projectId: string): Promise<GetLibraryResponse> {
  return getJson(`/api/projects/${encodeURIComponent(projectId)}/library`, GetLibraryResponse);
}
