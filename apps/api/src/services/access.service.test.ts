import type { GitHubClient } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { createBuildRequest, newProject, sha } from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { GitHubStatusError } from '../../test/support/unreachable-github.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import { createTestDeps } from '../../test/support/in-memory.ts';
import { NoopGitHubClient } from '../adapters/github-client.adapter.ts';
import { canAccessProject, requireBuildAccess, requireProjectAccess } from './access.service.ts';
import { createBuild } from './build.service.ts';

const hour = 60 * 60 * 1000;

async function setup(installationId: number | null = 42) {
  const github = createRecordingGitHub(['octocat']);
  const deps = createTestDeps({ github });
  const project = await deps.projects.create(newProject('acc', { installationId }));
  return { deps, github, project };
}

describe('canAccessProject', () => {
  it('asks GitHub once, then trusts the cached answer for an hour', async () => {
    const { deps, github, project } = await setup();
    const member = await signInReviewer(deps, 'octocat');
    const outsider = await signInReviewer(deps, 'outsider');

    expect(await canAccessProject(deps, member, project)).toBe(true);
    expect(await canAccessProject(deps, outsider, project)).toBe(false);
    deps.clock.advance(hour - 1);
    expect(await canAccessProject(deps, member, project)).toBe(true);
    expect(await canAccessProject(deps, outsider, project)).toBe(false);
    expect(github.membershipChecks).toEqual([
      { org: 'org-acc', login: 'octocat' },
      { org: 'org-acc', login: 'outsider' },
    ]);

    deps.clock.advance(1);
    expect(await canAccessProject(deps, member, project)).toBe(true);
    expect(github.membershipChecks).toHaveLength(3);
  });

  it('refuses everyone when the org has no installation to check membership with', async () => {
    const { deps, github, project } = await setup(null);

    expect(await canAccessProject(deps, await signInReviewer(deps, 'octocat'), project)).toBe(
      false,
    );
    expect(github.membershipChecks).toEqual([]);
  });
});

// octocat's personal account (GitHub id 583231) has installation 42; GitHub knows no org members.
const octocatId = 583231;
const ownedBy = () => createRecordingGitHub([], { accounts: { 42: octocatId } });

async function personal(github: GitHubClient) {
  const deps = createTestDeps({ github });
  const project = await deps.projects.create(
    newProject('solo', { githubOrg: 'OctoCat', installationId: 42 }),
  );
  return { deps, project };
}

describe('canAccessProject on a personal account (ADR 0012, 0024)', () => {
  it('treats the account owner, by GitHub id, as its one member without asking GitHub', async () => {
    const github = ownedBy();
    const { deps, project } = await personal(github);

    expect(
      await canAccessProject(deps, await signInReviewer(deps, 'octocat', octocatId), project),
    ).toBe(true);
    expect(await canAccessProject(deps, await signInReviewer(deps, 'outsider'), project)).toBe(
      false,
    );
    expect(github.membershipChecks).toEqual([{ org: 'OctoCat', login: 'outsider' }]);
  });

  it('keeps access for the owner after they rename their login', async () => {
    const github = ownedBy();
    const { deps, project } = await personal(github);
    const renamed = await signInReviewer(deps, 'octocat-renamed', octocatId);

    expect(await canAccessProject(deps, renamed, project)).toBe(true);
    expect(github.membershipChecks).toEqual([]);
  });

  it('denies another account that took over the old login', async () => {
    const { deps, project } = await personal(ownedBy());
    const squatter = await signInReviewer(deps, 'OctoCat', 999_999);

    expect(await canAccessProject(deps, squatter, project)).toBe(false);
    expect(deps.log.warnings).toEqual([]);
  });

  it('reads the account id from the installation once, then keeps it on the org', async () => {
    const github = ownedBy();
    const { deps, project } = await personal(github);
    const owner = await signInReviewer(deps, 'octocat', octocatId);
    expect(project.org.githubAccountId).toBeNull();

    expect(await canAccessProject(deps, owner, project)).toBe(true);
    const stored = await deps.projects.findById(project.id);
    expect(stored?.org.githubAccountId).toBe(octocatId);
    expect(await canAccessProject(deps, owner, stored ?? project)).toBe(true);
    expect(github.accountLookups).toEqual([42]);
  });
});

describe('canAccessProject while the account id is unknown (ADR 0024)', () => {
  it('denies everyone and logs it while the account id is unknown and cannot be read', async () => {
    const recording = createRecordingGitHub(['octocat']);
    const github: GitHubClient = {
      ...recording,
      installationAccountId: () => Promise.reject(new GitHubStatusError(403)),
    };
    const { deps, project } = await personal(github);

    expect(
      await canAccessProject(deps, await signInReviewer(deps, 'octocat', octocatId), project),
    ).toBe(false);
    expect(deps.log.warnings).toEqual([
      { event: 'org_account_unknown', org: 'OctoCat', reason: 'github 403' },
    ]);
    // Nothing was stored and no membership was asked: the next check tries again.
    expect((await deps.projects.findById(project.id))?.org.githubAccountId).toBeNull();
    expect(recording.membershipChecks).toEqual([]);
    expect(deps.memberships.all.size).toBe(0);
  });

  it('denies everyone with the no-op client, which knows no installation', async () => {
    const { deps, project } = await personal(new NoopGitHubClient());

    expect(
      await canAccessProject(deps, await signInReviewer(deps, 'octocat', octocatId), project),
    ).toBe(false);
    expect(deps.log.warnings).toMatchObject([{ event: 'org_account_unknown', org: 'OctoCat' }]);
  });

  it('still needs an installation, as every project does', async () => {
    const github = ownedBy();
    const deps = createTestDeps({ github });
    const project = await deps.projects.create(
      newProject('solo-bare', { githubOrg: 'octocat', installationId: null }),
    );

    expect(
      await canAccessProject(deps, await signInReviewer(deps, 'octocat', octocatId), project),
    ).toBe(false);
    expect(github.accountLookups).toEqual([]);
  });
});

describe('requireProjectAccess', () => {
  it('lets the project token through and hides other projects behind not_found', async () => {
    const { deps, project } = await setup();
    const other = await deps.projects.create(newProject('acc-other'));

    await expect(
      requireProjectAccess(deps, { kind: 'project', project }, project),
    ).resolves.toBeUndefined();
    await expect(
      requireProjectAccess(deps, { kind: 'project', project: other }, project),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('forbids a reviewer outside the org', async () => {
    const { deps, project } = await setup();
    const outsider = await signInReviewer(deps, 'outsider');

    await expect(
      requireProjectAccess(deps, { kind: 'reviewer', reviewer: outsider }, project),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('requireBuildAccess', () => {
  it('returns the build and its project, or not_found for an unknown build', async () => {
    const { deps, project } = await setup();
    const reviewer = await signInReviewer(deps, 'octocat');
    const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));
    const principal = { kind: 'reviewer', reviewer } as const;

    const access = await requireBuildAccess(deps, principal, build.id);

    expect(access.project).toEqual(project);
    expect(access.build).toMatchObject({ id: build.id, status: 'in_progress' });
    await expect(requireBuildAccess(deps, principal, 'nope')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('answers not_found when the build points at a project that no longer exists', async () => {
    const { deps, project } = await setup();
    const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));
    deps.projects.all.splice(0);

    await expect(
      requireBuildAccess(deps, { kind: 'project', project }, build.id),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
