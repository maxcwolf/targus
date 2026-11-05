import { TargusError, type CreateProjectRequest, type CreateProjectResponse } from '@targus/core';

import type { ServiceDeps } from './deps.js';

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
