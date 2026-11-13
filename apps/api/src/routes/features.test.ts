import { MeResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { appWithFeatures, call, createTestProject } from '../../test/support/api.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { signIn, withCookie } from '../../test/support/session.ts';

/** A GitHub for which `octocat` is a member of every org. */
const github = createRecordingGitHub(['octocat']);

describe('a feature that is turned off', () => {
  it('is reported off to the review UI, and its routes answer 404 before any sign-in', async () => {
    const app = appWithFeatures({ library: false }, { github });
    const { project } = await createTestProject(42);
    const { cookie } = await signIn('octocat');
    const headers = withCookie(cookie);

    const me = await call('/api/me', { headers }, app);
    expect(MeResponse.parse(await me.json()).features).toEqual({ library: false });

    for (const init of [{ headers }, {}]) {
      const response = await call(`/api/projects/${project.id}/library`, init, app);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: 'not_found', message: 'the library feature is turned off on this server' },
      });
    }
    // The rest of the project is untouched.
    const builds = await call(`/api/projects/${project.id}/builds`, { headers }, app);
    expect(builds.status).toBe(200);
  });

  it('is served again by an app that has it on', async () => {
    const { project } = await createTestProject(42);
    const { cookie } = await signIn('octocat');

    const response = await call(
      `/api/projects/${project.id}/library`,
      { headers: withCookie(cookie) },
      appWithFeatures({ library: true }, { github }),
    );

    expect(response.status).toBe(200);
  });
});
