import { ListProjectsResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { appWith, call, createTestProject, uniqueOrg } from '../../test/support/api.ts';
import { createCapturingLogger, fakeObservability } from '../../test/support/logs.ts';
import { signIn } from '../../test/support/session.ts';
import { createUnreachableGitHub } from '../../test/support/unreachable-github.ts';

describe('GET /api/projects when one org cannot be checked', () => {
  it('lists the projects of the other orgs and logs the broken org on the request line', async () => {
    const healthy = uniqueOrg('healthy');
    const suspended = uniqueOrg('suspended');
    const { project: visible } = await createTestProject(11, healthy);
    const { project: hidden } = await createTestProject(12, suspended);
    const logger = createCapturingLogger();
    const github = createUnreachableGitHub(['octocat'], [suspended]);
    const app = appWith({ github }, fakeObservability(logger));
    const { cookie } = await signIn('octocat');

    const response = await call('/api/projects', { headers: { cookie } }, app);

    expect(response.status).toBe(200);
    const ids = ListProjectsResponse.parse(await response.json()).projects.map((p) => p.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(hidden.id);
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'warn',
      route: '/api/projects',
      status: 200,
      principal: 'reviewer',
      warnings: [{ event: 'org_membership_unchecked', orgs: [suspended], reasons: ['github 403'] }],
    });
  });

  it('answers 403 for a build list of the org that cannot be checked', async () => {
    const suspended = uniqueOrg('suspended');
    const { project } = await createTestProject(13, suspended);
    const app = appWith({ github: createUnreachableGitHub(['octocat'], [suspended]) });
    const { cookie } = await signIn('octocat');

    const response = await call(`/api/projects/${project.id}/builds`, { headers: { cookie } }, app);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'forbidden',
        message: `your membership of ${suspended} cannot be checked right now`,
      },
    });
  });
});
