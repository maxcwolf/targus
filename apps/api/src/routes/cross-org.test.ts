import { GetBuildResponse, ListProjectsResponse, ListSnapshotsResponse } from '@targus/core';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
  appWith,
  bearer,
  call,
  createTestProject,
  putImage,
  uniqueOrg,
} from '../../test/support/api.js';
import { storyResult } from '../../test/support/fixtures.js';
import { createRecordingGitHub } from '../../test/support/github-recorder.js';
import { pngFixture } from '../../test/support/png.js';
import { projectWithBuild } from '../../test/support/review.js';
import { signIn, withCookie } from '../../test/support/session.js';

// The tenancy boundary (ADR 0007, 0011, 0012) through the real app on the local D1: octocat
// belongs to acme only, hubot to globex only, and each org has its own App installation. Org
// names are unique per run because every test file shares the local D1.

const acme = uniqueOrg('acme');
const globex = uniqueOrg('globex');
const initech = uniqueOrg('initech');
const alice = uniqueOrg('alice');
const bob = uniqueOrg('bob');

const app = appWith({
  github: createRecordingGitHub(
    { [acme]: ['octocat'], [globex]: ['hubot'], [initech]: ['octocat'] },
    { installations: { [acme]: 101, [globex]: 102 } },
  ),
});

/** A project of `githubOrg` with one pending build whose single new snapshot has a real PNG. */
async function orgWithBuild(githubOrg: string, installationId: number, grey: number) {
  const png = await pngFixture(2, 2, grey);
  const fixture = await projectWithBuild([storyResult('button', { imageHash: png.hash })], {
    githubOrg,
    installationId,
  });
  expect((await putImage(fixture.token, png.hash, png.bytes)).status).toBe(200);
  return { ...fixture, hash: png.hash, snapshotId: fixture.snapshots[0]?.id ?? '' };
}

type Fixture = Awaited<ReturnType<typeof orgWithBuild>>;

/** The status of every reviewer read and write of the fixture, one request at a time. */
async function statuses(fixture: Fixture, cookie: string): Promise<number[]> {
  const { project, buildId, snapshotId, hash } = fixture;
  const json = { ...withCookie(cookie), 'content-type': 'application/json' };
  const requests: [string, RequestInit][] = [
    [`/api/projects/${project.id}/builds`, {}],
    [`/api/projects/${project.id}/library`, {}],
    [`/api/builds/${buildId}`, {}],
    [`/api/builds/${buildId}/snapshots`, {}],
    [`/api/images/${hash}`, {}],
    [
      `/api/snapshots/${snapshotId}/review`,
      { method: 'POST', headers: json, body: JSON.stringify({ decision: 'approve' }) },
    ],
    [`/api/builds/${buildId}/approve-all`, { method: 'POST' }],
  ];
  const result: number[] = [];
  for (const [path, init] of requests) {
    const headers = init.headers ?? withCookie(cookie);
    result.push((await call(path, { ...init, headers }, app)).status);
  }
  return result;
}

async function approvalCount(projectId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM approvals WHERE project_id = ?')
    .bind(projectId)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

/** The build and its snapshots as the project's own CLI token reads them. */
async function asOwner(fixture: Fixture) {
  const headers = bearer(fixture.token);
  const build = await call(`/api/builds/${fixture.buildId}`, { headers });
  const snapshots = await call(`/api/builds/${fixture.buildId}/snapshots`, { headers });
  return {
    build: GetBuildResponse.parse(await build.json()).build,
    snapshots: ListSnapshotsResponse.parse(await snapshots.json()).snapshots,
  };
}

async function listedIds(cookie: string): Promise<string[]> {
  const response = await call('/api/projects', { headers: withCookie(cookie) }, app);
  expect(response.status).toBe(200);
  return ListProjectsResponse.parse(await response.json()).projects.map((project) => project.id);
}

describe('a reviewer in one org', () => {
  it('reads and reviews that org and is refused everything of the other', async () => {
    const mine = await orgWithBuild(acme, 101, 221);
    const theirs = await orgWithBuild(globex, 102, 222);
    const { cookie } = await signIn('octocat');

    // Their own org first, so a cached "member of acme" is in place when globex is asked.
    expect(await statuses(mine, cookie)).toEqual([200, 200, 200, 200, 200, 200, 200]);
    expect(await approvalCount(mine.project.id)).toBe(1);

    expect(await statuses(theirs, cookie)).toEqual([403, 403, 403, 403, 404, 403, 403]);
    expect(await approvalCount(theirs.project.id)).toBe(0);
    const untouched = await asOwner(theirs);
    expect(untouched.build.status).toBe('pending');
    expect(untouched.snapshots).toEqual(theirs.snapshots);
    expect(untouched.snapshots[0]).toMatchObject({ review: 'pending', reviewedBy: null });

    const listed = await listedIds(cookie);
    expect(listed).toContain(mine.project.id);
    expect(listed).not.toContain(theirs.project.id);
  });

  it('leaves the other org to its own members', async () => {
    const theirs = await orgWithBuild(globex, 102, 223);
    const octocat = await signIn('octocat');
    const hubot = await signIn('hubot');

    expect(await statuses(theirs, octocat.cookie)).toEqual([403, 403, 403, 403, 404, 403, 403]);
    expect(await statuses(theirs, hubot.cookie)).toEqual([200, 200, 200, 200, 200, 200, 200]);
    expect(await listedIds(hubot.cookie)).toContain(theirs.project.id);
    expect(await listedIds(octocat.cookie)).not.toContain(theirs.project.id);
  });
});

describe('an org with no installation', () => {
  it('is visible to nobody, even a member with a fresh cached yes', async () => {
    const { project } = await createTestProject(null, initech);
    const { cookie, user } = await signIn('octocat');
    // Checked "in the future", so the cache counts it as fresh whatever the system clock says.
    // Routes may not import repositories, so the row is written as the repository would.
    await env.DB.prepare(
      'INSERT INTO org_memberships (user_id, org_id, member, checked_at) VALUES (?, ?, 1, ?)',
    )
      .bind(user.id, project.orgId, Date.parse('2099-01-01T00:00:00.000Z'))
      .run();

    expect(await listedIds(cookie)).not.toContain(project.id);
    for (const path of [
      `/api/projects/${project.id}/builds`,
      `/api/projects/${project.id}/library`,
    ]) {
      expect((await call(path, { headers: withCookie(cookie) }, app)).status).toBe(403);
    }
  });
});

describe('two personal accounts (ADR 0012)', () => {
  it('each show their own projects to their owner only', async () => {
    const aliceProject = (await createTestProject(201, alice)).project;
    const bobProject = (await createTestProject(202, bob)).project;
    const aliceSession = await signIn(alice);
    const bobSession = await signIn(bob);

    const aliceSees = await listedIds(aliceSession.cookie);
    const bobSees = await listedIds(bobSession.cookie);

    expect(aliceSees).toContain(aliceProject.id);
    expect(aliceSees).not.toContain(bobProject.id);
    expect(bobSees).toContain(bobProject.id);
    expect(bobSees).not.toContain(aliceProject.id);
    const builds = (id: string, cookie: string) =>
      call(`/api/projects/${id}/builds`, { headers: withCookie(cookie) }, app);
    expect((await builds(aliceProject.id, aliceSession.cookie)).status).toBe(200);
    expect((await builds(bobProject.id, aliceSession.cookie)).status).toBe(403);
  });
});
