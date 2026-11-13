import {
  CreateProjectResponse,
  ListInstallationReposResponse,
  ListInstallationsResponse,
} from '@targus/core';
import { describe, expect, it } from 'vitest';

import { appWith, bearer, call, uniqueOrg } from '../../test/support/api.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { createCapturingLogger, fakeObservability } from '../../test/support/logs.ts';
import { signIn, withCookie } from '../../test/support/session.ts';

/** An app whose GitHub has installation 7 on a new org, seeing two of its repositories. */
function world() {
  const org = uniqueOrg('acme');
  const github = createRecordingGitHub(
    { [org]: ['octocat'] },
    {
      logins: { 7: org, 9: null },
      repos: {
        7: [
          { repo: `${org}/web`, defaultBranch: 'trunk' },
          { repo: `${org}/app`, defaultBranch: 'main' },
        ],
      },
    },
  );
  const app = appWith({ github });
  const get = (path: string, cookie: string) => call(path, { headers: withCookie(cookie) }, app);
  const post = (path: string, cookie: string, body: unknown) =>
    call(
      path,
      {
        method: 'POST',
        headers: { ...withCookie(cookie), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      app,
    );
  return { org, app, get, post };
}

describe('self-serve project creation', () => {
  it('lets a member list an installation’s repositories, make a project, and see it listed', async () => {
    const { org, app, get, post } = world();
    const { cookie } = await signIn('octocat');

    const before = await get('/api/installations/7/repos', cookie);
    expect(before.status).toBe(200);
    expect(ListInstallationReposResponse.parse(await before.json())).toEqual({
      account: org,
      repos: [
        { repo: `${org}/app`, defaultBranch: 'main', projectId: null },
        { repo: `${org}/web`, defaultBranch: 'trunk', projectId: null },
      ],
    });

    const created = await post('/api/installations/7/projects', cookie, { repo: `${org}/web` });
    expect(created.status).toBe(201);
    const { project, token } = CreateProjectResponse.parse(await created.json());
    expect(project).toMatchObject({ repo: `${org}/web`, name: 'web', defaultBranch: 'trunk' });

    // The token works for the CLI, and the project now shows where a reviewer looks.
    const current = await call('/api/projects/current', { headers: bearer(token) }, app);
    expect(current.status).toBe(200);
    const after = ListInstallationReposResponse.parse(
      await (await get('/api/installations/7/repos', cookie)).json(),
    );
    expect(after.repos.find((repo) => repo.repo === `${org}/web`)?.projectId).toBe(project.id);
    const listed = ListInstallationsResponse.parse(
      await (await get('/api/installations', cookie)).json(),
    );
    expect(listed.installations).toContainEqual({ installationId: 7, account: org });
    // The test Worker sets no GITHUB_APP_SLUG, so there is no install link to offer.
    expect(listed.installUrl).toBeNull();
  });

  it('answers 409 for a repository that has a project, 404 for one it cannot see', async () => {
    const { org, post } = world();
    const { cookie } = await signIn('octocat');
    const projects = '/api/installations/7/projects';
    await post(projects, cookie, { repo: `${org}/app` });

    expect((await post(projects, cookie, { repo: `${org}/app` })).status).toBe(409);
    expect((await post(projects, cookie, { repo: `${org}/hidden` })).status).toBe(404);
    expect((await post(projects, cookie, { repo: 'not a repo' })).status).toBe(400);
    expect((await post(projects, cookie, {})).status).toBe(400);
  });
});

describe('/api/installations access', () => {
  it('answers 403 outside the account, 404 for an unknown installation, 401 without a session', async () => {
    const { org, app, get, post } = world();
    const member = await signIn('octocat');
    const outsider = await signIn('outsider');
    const body = { repo: `${org}/web` };

    expect((await get('/api/installations/7/repos', outsider.cookie)).status).toBe(403);
    expect((await post('/api/installations/7/projects', outsider.cookie, body)).status).toBe(403);
    for (const id of ['9', 'abc', '0', '-1']) {
      expect((await get(`/api/installations/${id}/repos`, member.cookie)).status).toBe(404);
      expect((await post(`/api/installations/${id}/projects`, member.cookie, body)).status).toBe(
        404,
      );
    }
    for (const path of ['/api/installations', '/api/installations/7/repos']) {
      const response = await call(path, {}, app);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } });
    }
    const unsigned = await call('/api/installations/7/projects', { method: 'POST' }, app);
    expect(unsigned.status).toBe(401);
  });

  it('writes one request line naming the route and the reviewer', async () => {
    const logger = createCapturingLogger();
    const app = appWith({}, fakeObservability(logger));
    const { cookie } = await signIn('octocat');

    await call('/api/installations', { headers: withCookie(cookie) }, app);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      route: '/api/installations',
      principal: 'reviewer',
      status: 200,
    });
  });
});
