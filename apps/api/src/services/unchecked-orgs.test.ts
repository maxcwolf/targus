import { describe, expect, it } from 'vitest';

import { newBuild, newProject } from '../../test/support/fixtures.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import { createTestDeps } from '../../test/support/in-memory.ts';
import { pngFixture } from '../../test/support/png.ts';
import { createUnreachableGitHub } from '../../test/support/unreachable-github.ts';
import { requireBuildAccess } from './access.service.ts';
import { getImage, uploadImage } from './image.service.ts';
import { listProjects } from './project.service.ts';

// An org whose App installation is suspended (GitHub answers 403 for it) must not break reads
// for everyone else: the reviewer simply does not get in through that org.

async function twoOrgs() {
  const github = createUnreachableGitHub(['octocat'], ['suspended']);
  const deps = createTestDeps({ github });
  const ok = await deps.projects.create(
    newProject('ok', { githubOrg: 'healthy', installationId: 1 }),
  );
  const broken = await deps.projects.create(
    newProject('broken', { githubOrg: 'suspended', installationId: 2 }),
  );
  await deps.projects.create(
    newProject('broken-2', { githubOrg: 'suspended', newOrgId: 'org-broken', installationId: 2 }),
  );
  const reviewer = await signInReviewer(deps, 'octocat');
  return { deps, github, ok, broken, reviewer };
}

const uncheckedSuspended = {
  event: 'org_membership_unchecked',
  orgs: ['suspended'],
  reasons: ['github 403'],
};

describe('listProjects with an org that cannot be checked', () => {
  it('lists the other orgs, asks GitHub once for the broken one and logs it once', async () => {
    const { deps, github, reviewer } = await twoOrgs();

    const response = await listProjects(deps, reviewer);

    expect(response.projects.map((project) => project.id)).toEqual(['project-ok']);
    expect(github.membershipChecks.filter((check) => check.org === 'suspended')).toHaveLength(1);
    expect(deps.log.warnings).toEqual([uncheckedSuspended]);
  });

  it('logs nothing when every org could be checked', async () => {
    const deps = createTestDeps({ github: createUnreachableGitHub(['octocat'], []) });
    await deps.projects.create(newProject('fine', { installationId: 1 }));

    await listProjects(deps, await signInReviewer(deps, 'octocat'));

    expect(deps.log.warnings).toEqual([]);
  });
});

describe('reading one project of an org that cannot be checked', () => {
  it('answers forbidden, says why, and logs the org', async () => {
    const { deps, broken, reviewer } = await twoOrgs();
    const build = await deps.builds.create(newBuild('b-broken', broken.id));

    await expect(
      requireBuildAccess(deps, { kind: 'reviewer', reviewer }, build.id),
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'your membership of suspended cannot be checked right now',
    });
    expect(deps.log.warnings).toEqual([uncheckedSuspended]);
  });
});

describe('reading an image uploaded by an org that cannot be checked', () => {
  it('serves it through another org of the reviewer, and hides it when there is none', async () => {
    const { deps, ok, broken, reviewer } = await twoOrgs();
    const shared = await pngFixture(2, 2, 71);
    const onlyBroken = await pngFixture(2, 2, 72);
    await uploadImage(deps, broken, shared.hash, shared.bytes);
    await uploadImage(deps, ok, shared.hash, shared.bytes);
    await uploadImage(deps, broken, onlyBroken.hash, onlyBroken.bytes);
    const principal = { kind: 'reviewer', reviewer } as const;

    expect(await getImage(deps, principal, shared.hash)).toEqual(shared.bytes);
    await expect(getImage(deps, principal, onlyBroken.hash)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(deps.log.warnings).toEqual([uncheckedSuspended]);
  });
});
