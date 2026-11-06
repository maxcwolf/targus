import { TargusError } from '@targus/core';

import { failureReason } from '../logging/request-log.ts';
import type { BuildRecord } from '../repositories/build.repository.ts';
import type { CachedMembership } from '../repositories/membership.repository.ts';
import type { Project } from '../repositories/project.repository.ts';
import type { ServiceDeps } from './deps.ts';
import type { Principal, Reviewer } from './principal.ts';

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

/** An org whose membership could not be checked, and why, for the request's log line. */
export interface UncheckedOrg {
  readonly githubOrg: string;
  readonly reason: string;
}

/**
 * `check`, except that a failure (the org's App installation suspended or revoked, GitHub down)
 * answers `UncheckedOrg` instead of failing the request. Callers treat it as "no access", the
 * safe default, and report it with `logUnchecked`.
 */
export async function checkOrSkip(
  githubOrg: string,
  check: () => Promise<boolean>,
): Promise<boolean | UncheckedOrg> {
  try {
    return await check();
  } catch (error) {
    return { githubOrg, reason: failureReason(error) };
  }
}

/** One warning on the request's log line for every org this request could not check. */
export function logUnchecked(deps: Pick<ServiceDeps, 'log'>, unchecked: readonly UncheckedOrg[]) {
  if (unchecked.length === 0) return;
  deps.log.warn('org_membership_unchecked', {
    orgs: unchecked.map((org) => org.githubOrg),
    reasons: unchecked.map((org) => org.reason),
  });
}

/**
 * Authorize a read of `project`: a reviewer outside its org gets `forbidden`, and so does one
 * whose membership cannot be checked right now; a project token of another project gets
 * `not_found`.
 */
export async function requireProjectAccess(
  deps: AccessDeps & Pick<ServiceDeps, 'log'>,
  principal: Principal,
  project: Project,
): Promise<void> {
  if (principal.kind === 'project') {
    // Another project's data does not exist as far as this token can tell.
    if (principal.project.id !== project.id) throw new TargusError('not_found', 'not found');
    return;
  }
  const { githubOrg } = project.org;
  const access = await checkOrSkip(githubOrg, () =>
    canAccessProject(deps, principal.reviewer, project),
  );
  if (access === true) return;
  if (access === false) throw new TargusError('forbidden', `you are not a member of ${githubOrg}`);
  logUnchecked(deps, [access]);
  throw new TargusError('forbidden', `your membership of ${githubOrg} cannot be checked right now`);
}

/** A build the principal may read, with its project; `not_found` when there is no such build. */
export async function requireBuildAccess(
  deps: AccessDeps & Pick<ServiceDeps, 'builds' | 'log' | 'projects'>,
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
