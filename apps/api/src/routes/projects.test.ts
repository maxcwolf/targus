import {
  CreateBuildResponse,
  GetLibraryResponse,
  ListBuildsResponse,
  ListProjectsResponse,
} from '@targus/core';
import { describe, expect, it } from 'vitest';

import { call, postJson } from '../../test/support/api.ts';
import { createBuildRequest, sha, storyResult } from '../../test/support/fixtures.ts';
import { getAsReviewer, postAsReviewer, projectWithBuild } from '../../test/support/review.ts';
import { signIn } from '../../test/support/session.ts';

describe('GET /api/projects', () => {
  it('lists the projects of the reviewer orgs only', async () => {
    const { project } = await projectWithBuild([storyResult('button')]);
    const member = await signIn('octocat');
    const outsider = await signIn('outsider');

    const mine = await getAsReviewer('/api/projects', member.cookie);
    const theirs = await getAsReviewer('/api/projects', outsider.cookie);

    expect(mine.status).toBe(200);
    expect(ListProjectsResponse.parse(await mine.json()).projects).toContainEqual({
      ...project,
      githubOrg: 'example-org',
    });
    expect(ListProjectsResponse.parse(await theirs.json()).projects).toEqual([]);
    expect((await call('/api/projects')).status).toBe(401);
  });
});

describe('GET /api/projects/:id/builds', () => {
  it('lists builds with their summary and counts, newest first', async () => {
    const { project, buildId } = await projectWithBuild([storyResult('button')]);
    const { cookie } = await signIn('octocat');

    const response = await getAsReviewer(`/api/projects/${project.id}/builds?limit=5`, cookie);

    expect(response.status).toBe(200);
    const { builds } = ListBuildsResponse.parse(await response.json());
    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({
      build: { id: buildId, status: 'pending' },
      summary: { status: 'pending', pendingCount: 1 },
      counts: { unchanged: 0, changed: 0, new: 1, removed: 0, unstable: 0, error: 0 },
    });
  });

  it('pages to the oldest build with nextCursor, and a request without a query reads one page', async () => {
    const { project, token, buildId } = await projectWithBuild([storyResult('button')]);
    const created = await postJson('/api/builds', token, createBuildRequest(sha('b')));
    const newest = CreateBuildResponse.parse(await created.json()).build.id;
    const { cookie } = await signIn('octocat');
    const builds = `/api/projects/${project.id}/builds`;

    const first = ListBuildsResponse.parse(
      await (await getAsReviewer(`${builds}?limit=1`, cookie)).json(),
    );
    const cursor = encodeURIComponent(first.nextCursor ?? '');
    const last = ListBuildsResponse.parse(
      await (await getAsReviewer(`${builds}?limit=1&cursor=${cursor}`, cookie)).json(),
    );
    const whole = await (await getAsReviewer(builds, cookie)).json();

    expect(first.builds.map((entry) => entry.build.id)).toEqual([newest]);
    expect(last.builds.map((entry) => entry.build.id)).toEqual([buildId]);
    expect(last.nextCursor).toBeNull();
    expect(whole).toMatchObject({ nextCursor: null, builds: [{}, {}] });
  });
});

describe('GET /api/projects/:id/builds cursors', () => {
  it('answers 400 for an empty or forged cursor', async () => {
    const { project } = await projectWithBuild([storyResult('button')]);
    const { cookie } = await signIn('octocat');

    for (const cursor of ['', 'forged', btoa('n:0')]) {
      const path = `/api/projects/${project.id}/builds?cursor=${encodeURIComponent(cursor)}`;
      const response = await getAsReviewer(path, cookie);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'bad_request' } });
    }
  });
});

describe('GET /api/projects/:id/builds access', () => {
  it('validates the limit and answers 403 outside the org and 404 for unknown projects', async () => {
    const { project } = await projectWithBuild([storyResult('button')]);
    const member = await signIn('octocat');
    const outsider = await signIn('outsider');
    const builds = `/api/projects/${project.id}/builds`;

    for (const limit of ['0', '101', 'abc']) {
      expect((await getAsReviewer(`${builds}?limit=${limit}`, member.cookie)).status).toBe(400);
    }
    expect((await getAsReviewer(builds, outsider.cookie)).status).toBe(403);
    expect((await getAsReviewer('/api/projects/nope/builds', member.cookie)).status).toBe(404);
    expect((await call(builds)).status).toBe(401);
  });
});

describe('GET /api/projects/:id/library', () => {
  it('lists the stories of the accepted default-branch build', async () => {
    const { project, buildId } = await projectWithBuild([storyResult('button')]);
    const member = await signIn('octocat');
    const outsider = await signIn('outsider');
    const library = `/api/projects/${project.id}/library`;

    const before = await getAsReviewer(library, member.cookie);
    expect(GetLibraryResponse.parse(await before.json())).toEqual({ build: null, stories: [] });

    const approved = await postAsReviewer(`/api/builds/${buildId}/approve-all`, member.cookie);
    expect(approved.status).toBe(200);
    const after = await getAsReviewer(library, member.cookie);

    expect(after.status).toBe(200);
    const { build, stories } = GetLibraryResponse.parse(await after.json());
    expect(build).toMatchObject({ id: buildId, status: 'accepted' });
    expect(stories).toMatchObject([{ storyId: 'button', variant: 'default' }]);
    expect((await getAsReviewer(library, outsider.cookie)).status).toBe(403);
    expect((await getAsReviewer('/api/projects/nope/library', member.cookie)).status).toBe(404);
    expect((await call(library)).status).toBe(401);
  });
});
