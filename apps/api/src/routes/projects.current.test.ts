import { CurrentProjectResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { bearer, call, createTestProject } from '../../test/support/api.ts';
import { signIn, withCookie } from '../../test/support/session.ts';

describe('GET /api/projects/current', () => {
  it("answers the token's project, matching the contract", async () => {
    const { token, project } = await createTestProject();

    const response = await call('/api/projects/current', { headers: bearer(token) });

    expect(response.status).toBe(200);
    expect(CurrentProjectResponse.parse(await response.json())).toEqual({
      project: { ...project, githubOrg: 'example-org' },
    });
  });

  it('answers 401 for a wrong token, no token and a session cookie alone', async () => {
    const { cookie } = await signIn('octocat');

    for (const headers of [bearer('not-a-project-token'), {}, withCookie(cookie)]) {
      const response = await call('/api/projects/current', { headers });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } });
    }
  });
});
