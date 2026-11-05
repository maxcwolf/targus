import { ListBuildsResponse, ListProjectsResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { call } from '../../test/support/api.js';
import { storyResult } from '../../test/support/fixtures.js';
import { getAsReviewer, projectWithBuild } from '../../test/support/review.js';
import { signIn } from '../../test/support/session.js';

describe('GET /api/projects', () => {
  it('lists the projects of the reviewer orgs only', async () => {
    const { project } = await projectWithBuild([]);
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

  it('validates the limit and answers 403 outside the org and 404 for unknown projects', async () => {
    const { project } = await projectWithBuild([]);
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
