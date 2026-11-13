import {
  TargusError,
  type CreateInstallationProjectRequest,
  type CreateProjectResponse,
  type InstallationAccount,
  type InstallationSummary,
  type ListInstallationReposResponse,
  type ListInstallationsResponse,
} from '@targus/core';

import { canAccessProject, checkOrSkip, logUnchecked } from './access.service.ts';
import type { ServiceDeps } from './deps.ts';
import type { Reviewer } from './principal.ts';
import { createProject } from './project.service.ts';

type InstallationDeps = Pick<
  ServiceDeps,
  'clock' | 'config' | 'github' | 'ids' | 'log' | 'memberships' | 'projects' | 'tokens'
>;

/**
 * `GET /api/installations`: the App installations the reviewer already has a project under,
 * one per account, in account order, and where to install the App on another account. An
 * account whose membership cannot be checked right now is left out, as in the projects list.
 */
export async function listInstallations(
  deps: InstallationDeps,
  reviewer: Reviewer,
): Promise<ListInstallationsResponse> {
  const seen = new Set<string>();
  const installations: InstallationSummary[] = [];
  const unchecked = [];
  for (const project of await deps.projects.listAll()) {
    const { githubOrg: account, installationId } = project.org;
    if (installationId === null || seen.has(project.orgId)) continue;
    seen.add(project.orgId);
    const access = await checkOrSkip(account, () => canAccessProject(deps, reviewer, project));
    if (access === true) installations.push({ installationId, account });
    else if (access !== false) unchecked.push(access);
  }
  logUnchecked(deps, unchecked);
  installations.sort((a, b) => a.account.localeCompare(b.account, 'en'));
  return { installations, installUrl: deps.config.githubAppInstallUrl };
}

/**
 * The account of an installation the reviewer may make projects under: their own account, or
 * an org they are a member of. Asked of GitHub each time, since the account may have no org row
 * to cache a membership against yet. `not_found` when the App has no such installation.
 */
async function requireInstallation(
  deps: InstallationDeps,
  reviewer: Reviewer,
  installationId: number,
): Promise<InstallationAccount> {
  const account = await deps.github.installationAccount(installationId);
  if (account === null) {
    throw new TargusError('not_found', `no installation ${String(installationId)}`);
  }
  const { user } = reviewer;
  if (account.id === user.githubId) return account;
  if (await deps.github.isOrgMember(installationId, account.login, user.login)) return account;
  throw new TargusError('forbidden', `you are not a member of ${account.login}`);
}

/**
 * `GET /api/installations/:id/repos`: the repositories the installation can see, in name order,
 * each with its project when it has one.
 */
export async function listInstallationRepos(
  deps: InstallationDeps,
  reviewer: Reviewer,
  installationId: number,
): Promise<ListInstallationReposResponse> {
  const account = await requireInstallation(deps, reviewer, installationId);
  const repos = await deps.github.listInstallationRepos(installationId);
  const projects = new Map((await deps.projects.listAll()).map((p) => [p.repo, p.id]));
  return {
    account: account.login,
    repos: repos
      .map(({ repo, defaultBranch }) => ({
        repo,
        defaultBranch,
        projectId: projects.get(repo) ?? null,
      }))
      .sort((a, b) => a.repo.localeCompare(b.repo, 'en')),
  };
}

/**
 * `POST /api/installations/:id/projects`: make a project for a repository the installation can
 * see, named after the repository, on its default branch, under the installation's account. Any
 * member of the account may; the token is in the answer and nowhere else. `conflict` when the
 * repository already has a project.
 */
export async function createInstallationProject(
  deps: InstallationDeps,
  reviewer: Reviewer,
  installationId: number,
  request: CreateInstallationProjectRequest,
): Promise<CreateProjectResponse> {
  const account = await requireInstallation(deps, reviewer, installationId);
  const repos = await deps.github.listInstallationRepos(installationId);
  const found = repos.find(({ repo }) => repo === request.repo);
  if (found === undefined) {
    throw new TargusError(
      'not_found',
      `the installation on ${account.login} cannot see ${request.repo}`,
    );
  }
  const created = await createProject(deps, {
    githubOrg: account.login,
    installationId,
    repo: found.repo,
    name: found.repo.slice(found.repo.indexOf('/') + 1),
    defaultBranch: found.defaultBranch,
  });
  // The account was just read from this installation, so the first access check need not ask.
  await deps.projects.setOrgAccountId(created.project.orgId, installationId, account.id);
  return created;
}
