import { TargusError } from '@targus/core';

import type { BuildRecord } from '../repositories/build.repository.js';
import type { CachedMembership } from '../repositories/membership.repository.js';
import type { Project } from '../repositories/project.repository.js';
import type { ServiceDeps } from './deps.js';
import type { Principal, Reviewer } from './principal.js';

/** How long a cached org membership answer is trusted (plan.md section 5.2). */
const membershipTtlMs = 60 * 60 * 1000;

type AccessDeps = Pick<ServiceDeps, 'clock' | 'github' | 'memberships'>;

/**
 * Whether `login` is the account the project hangs off. A project's "org" can be a personal
 * account (ADR 0012); GitHub has no members endpoint for those, and logins are unique across
 * users and orgs and compare case-insensitively, so the owner is the one member.
 */
function ownsAccount(githubOrg: string, login: string): boolean {
  return githubOrg.toLowerCase() === login.toLowerCase();
}

/** The fields of an org that decide who may read its projects. */
export interface OrgAccess {
  readonly orgId: string;
  readonly githubOrg: string;
  readonly installationId: number | null;
}

/**
 * Whether the reviewer belongs to the org. The owner of a personal account is its member;
 * otherwise answers come from the membership cache while it is under an hour old, else from
 * GitHub (through the org's App installation). An org without an installation cannot be
 * checked, so nobody gets in. `cached` is called only when the answer depends on the cache, so
 * a caller that already holds the cached row passes it and one that does not reads it lazily.
 */
export async function canAccessOrg(
  deps: AccessDeps,
  reviewer: Reviewer,
  org: OrgAccess,
  cached: () => Promise<CachedMembership | null>,
): Promise<boolean> {
  const { installationId } = org;
  if (installationId === null) return false;
  const { user } = reviewer;
  if (ownsAccount(org.githubOrg, user.login)) return true;
  const now = deps.clock.now();
  const hit = await cached();
  if (hit !== null && now.getTime() - hit.checkedAt.getTime() < membershipTtlMs) {
    return hit.member;
  }
  const member = await deps.github.isOrgMember(installationId, org.githubOrg, user.login);
  await deps.memberships.set(user.id, org.orgId, member, now);
  return member;
}

/** Whether the reviewer belongs to the project's GitHub org (see `canAccessOrg`). */
export function canAccessProject(
  deps: AccessDeps,
  reviewer: Reviewer,
  project: Project,
): Promise<boolean> {
  return canAccessOrg(deps, reviewer, { orgId: project.orgId, ...project.org }, () =>
    deps.memberships.get(reviewer.user.id, project.orgId),
  );
}

/**
 * Authorize a read of `project`: a reviewer outside its org gets `forbidden`; a project token
 * of another project gets `not_found`.
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
