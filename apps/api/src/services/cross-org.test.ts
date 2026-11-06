import { describe, expect, it } from 'vitest';

import { newBuild, newProject, snapshotRecord } from '../../test/support/fixtures.js';
import { createRecordingGitHub } from '../../test/support/github-recorder.js';
import { signInReviewer } from '../../test/support/in-memory-auth.js';
import { createTestDeps, type TestDeps } from '../../test/support/in-memory.js';
import { pngFixture } from '../../test/support/png.js';
import type { Project } from '../repositories/project.repository.js';
import { canAccessProject } from './access.service.js';
import { getBuild, listBuilds, listSnapshots } from './build.service.js';
import { getImage, uploadImage } from './image.service.js';
import { getLibrary } from './library.service.js';
import type { Reviewer } from './principal.js';
import { listProjects } from './project.service.js';
import { approveAll, reviewSnapshot } from './review.service.js';

// The tenancy boundary (ADR 0007, 0011, 0012) between two GitHub orgs: octocat belongs to
// `acme` only, hubot to `globex` only, and each org has its own App installation.

const hour = 60 * 60 * 1000;

/** A pending build of `project` with one new snapshot whose image the project uploaded. */
async function pendingBuild(deps: TestDeps, project: Project, key: string) {
  const png = await pngFixture(2, 2, key.charCodeAt(0));
  const buildId = `build-${key}`;
  const snapshotId = `snap-${key}`;
  await deps.builds.create(newBuild(buildId, project.id, { status: 'pending' }));
  deps.builds.snapshots.set(buildId, [
    snapshotRecord(snapshotId, buildId, { imageHash: png.hash }),
  ]);
  await uploadImage(deps, project, png.hash, png.bytes);
  deps.images.references.set(png.hash, [project.id]);
  return { buildId, snapshotId, hash: png.hash };
}

async function twoOrgs() {
  const github = createRecordingGitHub(
    { acme: ['octocat'], globex: ['hubot'] },
    { installations: { acme: 1, globex: 2 } },
  );
  const deps = createTestDeps({ github });
  const a = await deps.projects.create(newProject('a', { githubOrg: 'acme', installationId: 1 }));
  const b = await deps.projects.create(newProject('b', { githubOrg: 'globex', installationId: 2 }));
  const octocat = await signInReviewer(deps, 'octocat');
  return { deps, github, a, b, octocat };
}

/** The error code of each call in turn, or `ok`; one at a time, as the writes interact. */
async function outcomes(calls: (() => Promise<unknown>)[]): Promise<string[]> {
  const results: string[] = [];
  for (const call of calls) {
    try {
      await call();
      results.push('ok');
    } catch (error) {
      results.push((error as { code?: string }).code ?? String(error));
    }
  }
  return results;
}

/** Every reviewer read and write of `project`, in a fixed order. */
async function everyCall(deps: TestDeps, reviewer: Reviewer, project: Project, key: string) {
  const { buildId, snapshotId, hash } = await pendingBuild(deps, project, key);
  const principal = { kind: 'reviewer', reviewer } as const;
  return outcomes([
    () => listBuilds(deps, reviewer, project.id),
    () => getLibrary(deps, reviewer, project.id),
    () => getBuild(deps, principal, buildId),
    () => listSnapshots(deps, principal, buildId),
    () => getImage(deps, principal, hash),
    () => reviewSnapshot(deps, reviewer, snapshotId, 'approve'),
    () => approveAll(deps, reviewer, buildId),
  ]);
}

describe('a member of one org', () => {
  it('sees and reviews that org, and nothing of the other', async () => {
    const { deps, a, b, octocat } = await twoOrgs();

    expect(await everyCall(deps, octocat, b, 'b')).toEqual([
      'forbidden',
      'forbidden',
      'forbidden',
      'forbidden',
      'not_found',
      'forbidden',
      'forbidden',
    ]);
    expect(deps.approvals.all).toEqual([]);
    expect(deps.builds.snapshots.get('build-b')?.[0]).toMatchObject({ review: 'pending' });
    expect(deps.builds.builds.find((build) => build.id === 'build-b')?.status).toBe('pending');

    // The same calls on the reviewer's own org succeed, so the refusals above are about the org.
    expect(await everyCall(deps, octocat, a, 'a')).toEqual(Array(7).fill('ok'));
    expect(deps.approvals.all.map((approval) => approval.projectId)).toEqual([a.id]);
  });

  it('lists only that org, asking GitHub about each org through its own installation', async () => {
    const { deps, github, a, octocat } = await twoOrgs();
    const hubot = await signInReviewer(deps, 'hubot');

    const mine = await listProjects(deps, octocat);
    const theirs = await listProjects(deps, hubot);

    expect(mine.projects.map((project) => project.githubOrg)).toEqual(['acme']);
    expect(mine.projects[0]?.id).toBe(a.id);
    expect(theirs.projects.map((project) => project.githubOrg)).toEqual(['globex']);
    expect(github.membershipChecks).toEqual([
      { org: 'acme', login: 'octocat' },
      { org: 'globex', login: 'octocat' },
      { org: 'acme', login: 'hubot' },
      { org: 'globex', login: 'hubot' },
    ]);
  });
});

describe('the membership cache', () => {
  it('never lets a cached answer for one org stand in for another', async () => {
    const { deps, github, a, b, octocat } = await twoOrgs();

    expect(await canAccessProject(deps, octocat, a)).toBe(true);
    expect(await canAccessProject(deps, octocat, b)).toBe(false);
    deps.clock.advance(hour - 1);
    expect(await canAccessProject(deps, octocat, a)).toBe(true);
    expect(await canAccessProject(deps, octocat, b)).toBe(false);

    expect(github.membershipChecks).toEqual([
      { org: 'acme', login: 'octocat' },
      { org: 'globex', login: 'octocat' },
    ]);
    expect(deps.memberships.all.get(`${octocat.user.id}\u0000${a.orgId}`)?.member).toBe(true);
    expect(deps.memberships.all.get(`${octocat.user.id}\u0000${b.orgId}`)?.member).toBe(false);
  });

  it('keeps one user cached answer from reaching another user', async () => {
    const { deps, a, octocat } = await twoOrgs();
    const outsider = await signInReviewer(deps, 'outsider');

    expect(await canAccessProject(deps, octocat, a)).toBe(true);
    expect(await canAccessProject(deps, outsider, a)).toBe(false);
  });

  it('shows an org with no installation to nobody, even with a fresh cached yes', async () => {
    const { deps, github, octocat } = await twoOrgs();
    const bare = await deps.projects.create(newProject('bare', { githubOrg: 'initech' }));
    await deps.memberships.set(octocat.user.id, bare.orgId, true, deps.clock.now());

    expect(await canAccessProject(deps, octocat, bare)).toBe(false);
    expect((await listProjects(deps, octocat)).projects.map((p) => p.githubOrg)).toEqual(['acme']);
    await expect(getLibrary(deps, octocat, bare.id)).rejects.toMatchObject({ code: 'forbidden' });
    expect(github.membershipChecks.filter((check) => check.org === 'initech')).toEqual([]);
  });
});

describe('two personal accounts (ADR 0012)', () => {
  it('give each owner their own account and nothing of the other', async () => {
    // GitHub says nobody is a member of anything: only ownership lets anyone in.
    const deps = createTestDeps({ github: createRecordingGitHub({}) });
    const alice = await deps.projects.create(
      newProject('alice', { githubOrg: 'alice', installationId: 11 }),
    );
    const bob = await deps.projects.create(
      newProject('bob', { githubOrg: 'Bob', installationId: 12 }),
    );
    const aliceUser = await signInReviewer(deps, 'alice', 101);
    const bobUser = await signInReviewer(deps, 'bob', 102);

    expect(await canAccessProject(deps, aliceUser, alice)).toBe(true);
    expect(await canAccessProject(deps, aliceUser, bob)).toBe(false);
    expect(await canAccessProject(deps, bobUser, bob)).toBe(true);
    expect(await canAccessProject(deps, bobUser, alice)).toBe(false);
    expect((await listProjects(deps, aliceUser)).projects.map((p) => p.id)).toEqual([alice.id]);
    expect((await listProjects(deps, bobUser)).projects.map((p) => p.id)).toEqual([bob.id]);
    await expect(listBuilds(deps, aliceUser, bob.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('do not let an account owner into an org that merely shares a prefix', async () => {
    const deps = createTestDeps({ github: createRecordingGitHub({}) });
    const org = await deps.projects.create(
      newProject('alice-co', { githubOrg: 'alice-co', installationId: 13 }),
    );

    expect(await canAccessProject(deps, await signInReviewer(deps, 'alice', 103), org)).toBe(false);
  });
});

describe('an image both orgs uploaded', () => {
  it('is readable by a member of either, since the bytes are the same', async () => {
    const { deps, a, b, octocat } = await twoOrgs();
    const png = await pngFixture(2, 2, 70);
    await uploadImage(deps, a, png.hash, png.bytes);
    await uploadImage(deps, b, png.hash, png.bytes);
    deps.images.references.set(png.hash, [b.id, a.id]);
    const principal = { kind: 'reviewer', reviewer: octocat } as const;

    expect(await getImage(deps, principal, png.hash)).toEqual(png.bytes);
  });
});
