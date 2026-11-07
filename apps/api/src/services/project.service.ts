import {
  TargusError,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type CurrentProjectResponse,
  type ListProjectsResponse,
  type ProjectSummary,
} from '@targus/core';

import type { Project } from '../repositories/project.repository.ts';

import {
  canAccessProject,
  checkOrSkip,
  logUnchecked,
  type UncheckedOrg,
} from './access.service.ts';
import type { ServiceDeps } from './deps.ts';
import type { Reviewer } from './principal.ts';

/**
 * Create a project (and its org when new) and return its token. The token is shown exactly once;
 * only its hash is stored (plan.md section 12).
 */
export async function createProject(
  deps: Pick<ServiceDeps, 'clock' | 'ids' | 'tokens' | 'projects'>,
  request: CreateProjectRequest,
): Promise<CreateProjectResponse> {
  if ((await deps.projects.findByRepo(request.repo)) !== null) {
    throw new TargusError('conflict', `a project for ${request.repo} already exists`);
  }
  const token = deps.tokens.generate();
  const project = await deps.projects.create({
    id: deps.ids.next(),
    newOrgId: deps.ids.next(),
    githubOrg: request.githubOrg,
    installationId: request.installationId,
    repo: request.repo,
    name: request.name,
    defaultBranch: request.defaultBranch,
    tokenHash: await deps.tokens.hash(token),
    createdAt: deps.clock.now(),
  });
  return {
    project: {
      id: project.id,
      orgId: project.orgId,
      repo: project.repo,
      name: project.name,
      defaultBranch: project.defaultBranch,
    },
    token,
  };
}

/** A project as the API answers it: never the token hash. */
function summaryOf(project: Project): ProjectSummary {
  return {
    id: project.id,
    orgId: project.orgId,
    githubOrg: project.org.githubOrg,
    repo: project.repo,
    name: project.name,
    defaultBranch: project.defaultBranch,
  };
}

/**
 * `GET /api/projects/current`: the project its token authenticated. Nothing to check beyond the
 * token, so `targus run` can ask before it spends minutes capturing.
 */
export function currentProject(project: Project): CurrentProjectResponse {
  return { project: summaryOf(project) };
}

type ListDeps = Pick<ServiceDeps, 'clock' | 'github' | 'log' | 'memberships' | 'projects'>;

/**
 * `GET /api/projects`: the projects whose org the reviewer belongs to. Checked one at a time so
 * projects of the same org share one membership check. An org whose membership cannot be
 * checked (its installation suspended, GitHub failing) is left out rather than failing the whole
 * list, and named once on the request's log line.
 */
export async function listProjects(
  deps: ListDeps,
  reviewer: Reviewer,
): Promise<ListProjectsResponse> {
  const byOrg = new Map<string, boolean | UncheckedOrg>();
  const visible: ListProjectsResponse['projects'] = [];
  for (const project of await deps.projects.listAll()) {
    let access = byOrg.get(project.orgId);
    if (access === undefined) {
      access = await checkOrSkip(project.org.githubOrg, () =>
        canAccessProject(deps, reviewer, project),
      );
      byOrg.set(project.orgId, access);
    }
    if (access !== true) continue;
    visible.push(summaryOf(project));
  }
  logUnchecked(
    deps,
    [...byOrg.values()].filter((access) => typeof access !== 'boolean'),
  );
  return { projects: visible };
}
