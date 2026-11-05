import { describe, expect, it } from 'vitest';

import { createBuildRequest, newProject, sha } from '../../test/support/fixtures.js';
import { createRecordingGitHub } from '../../test/support/github-recorder.js';
import { signInReviewer } from '../../test/support/in-memory-auth.js';
import { createTestDeps } from '../../test/support/in-memory.js';
import { canAccessProject, requireBuildAccess, requireProjectAccess } from './access.service.js';
import { createBuild } from './build.service.js';

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

describe('canAccessProject on a personal account', () => {
  it('treats the account owner as its one member without asking GitHub', async () => {
    const github = createRecordingGitHub([]);
    const deps = createTestDeps({ github });
    const project = await deps.projects.create(
      newProject('solo', { githubOrg: 'OctoCat', installationId: 42 }),
    );

    expect(await canAccessProject(deps, await signInReviewer(deps, 'octocat'), project)).toBe(true);
    expect(await canAccessProject(deps, await signInReviewer(deps, 'outsider'), project)).toBe(
      false,
    );
    expect(github.membershipChecks).toEqual([{ org: 'OctoCat', login: 'outsider' }]);
  });

  it('still needs an installation, as every project does', async () => {
    const deps = createTestDeps({ github: createRecordingGitHub([]) });
    const project = await deps.projects.create(
      newProject('solo-bare', { githubOrg: 'octocat', installationId: null }),
    );

    expect(await canAccessProject(deps, await signInReviewer(deps, 'octocat'), project)).toBe(
      false,
    );
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
