import {
  CreateProjectResponse,
  ListInstallationReposResponse,
  ListInstallationsResponse,
} from '@targus/core/browser';

import { getJson, postJson } from './http.ts';

function installationPath(installationId: number): string {
  return `/api/installations/${String(installationId)}`;
}

/** `GET /api/installations`: the accounts the reviewer can add projects to, and the install link. */
export function listInstallations(): Promise<ListInstallationsResponse> {
  return getJson('/api/installations', ListInstallationsResponse);
}

/** `GET /api/installations/:id/repos`: the repositories the installation can see. */
export function listInstallationRepos(
  installationId: number,
): Promise<ListInstallationReposResponse> {
  return getJson(`${installationPath(installationId)}/repos`, ListInstallationReposResponse);
}

/** `POST /api/installations/:id/projects`: a project for `repo`, with its token, shown once. */
export function createInstallationProject(
  installationId: number,
  repo: string,
): Promise<CreateProjectResponse> {
  return postJson(`${installationPath(installationId)}/projects`, CreateProjectResponse, { repo });
}
