import {
  defaultBuildsPageLimit,
  GetLibraryResponse,
  ListBuildsResponse,
  ListProjectsResponse,
  type Platform,
} from '@targus/core/browser';

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

/**
 * `GET /api/projects/:id/library`: every story of the accepted default-branch build of
 * `platform`, or of the first platform that has one when it is undefined (ADR 0036).
 */
export function getLibrary(projectId: string, platform?: Platform): Promise<GetLibraryResponse> {
  const query = platform === undefined ? '' : `?${new URLSearchParams({ platform }).toString()}`;
  return getJson(
    `/api/projects/${encodeURIComponent(projectId)}/library${query}`,
    GetLibraryResponse,
  );
}
