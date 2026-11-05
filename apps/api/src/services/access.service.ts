import { TargusError } from '@targus/core';

import type { BuildRecord } from '../repositories/build.repository.js';
import type { Project } from '../repositories/project.repository.js';
import type { ServiceDeps } from './deps.js';
import type { Principal, Reviewer } from './principal.js';

/** How long a cached org membership answer is trusted (plan.md section 5.2). */
const membershipTtlMs = 60 * 60 * 1000;

type AccessDeps = Pick<ServiceDeps, 'clock' | 'github' | 'memberships'>;

/**
 * Whether the reviewer belongs to the project's GitHub org. Answers come from the membership
 * cache while it is under an hour old, else from GitHub (through the org's App installation).
 * An org without an installation cannot be checked, so nobody gets in.
 */
export async function canAccessProject(
  deps: AccessDeps,
  reviewer: Reviewer,
  project: Project,
): Promise<boolean> {
  const installationId = project.org.installationId;
  if (installationId === null) return false;
  const { user } = reviewer;
  const now = deps.clock.now();
  const cached = await deps.memberships.get(user.id, project.orgId);
  if (cached !== null && now.getTime() - cached.checkedAt.getTime() < membershipTtlMs) {
    return cached.member;
  }
  const member = await deps.github.isOrgMember(installationId, project.org.githubOrg, user.login);
  await deps.memberships.set(user.id, project.orgId, member, now);
  return member;
}

/**
 * Authorize a read of `project`: a reviewer outside its org gets `forbidden`; a project token
 * of another project gets `not_found`, as before M3.
 */
export async function requireProjectAccess(
  deps: AccessDeps,
  principal: Principal,
  project: Project,
): Promise<void> {
  if (principal.kind === 'project') {
    // Another project's data does not exist as far as this token can tell.
    if (principal.project.id !== project.id) throw new TargusError('not_found', 'not found');
    return;
  }
  if (!(await canAccessProject(deps, principal.reviewer, project))) {
    throw new TargusError('forbidden', `you are not a member of ${project.org.githubOrg}`);
  }
}

/** A build the principal may read, with its project; `not_found` when there is no such build. */
export async function requireBuildAccess(
  deps: AccessDeps & Pick<ServiceDeps, 'builds' | 'projects'>,
  principal: Principal,
  buildId: string,
): Promise<{ build: BuildRecord; project: Project }> {
  const build = await deps.builds.findAnyById(buildId);
  const project = build === null ? null : await deps.projects.findById(build.projectId);
  if (build === null || project === null) {
    throw new TargusError('not_found', `no build ${buildId}`);
  }
  await requireProjectAccess(deps, principal, project);
  return { build, project };
}
