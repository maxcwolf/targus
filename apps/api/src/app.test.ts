import { describe, expect, it } from 'vitest';

import { appWith, call, createTestProject, uniqueOrg } from '../test/support/api.ts';
import { createCapturingLogger, fakeObservability } from '../test/support/logs.ts';
import { signIn } from '../test/support/session.ts';
import { createUnreachableGitHub } from '../test/support/unreachable-github.ts';

// The Worker builds one app per isolate (ADR 0023), so a single app serves many requests, some
// at the same time. Nothing a request sets (its principal, its log, its warnings) may reach
// another.

/** One app whose GitHub cannot check `suspended`, so listing projects warns on the request. */
async function sharedApp() {
  const suspended = uniqueOrg('suspended');
  await createTestProject(21, suspended);
  const logger = createCapturingLogger();
  const github = createUnreachableGitHub(['octocat'], [suspended]);
  return { app: appWith({ github }, fakeObservability(logger)), logger };
}

describe('one app serving many requests', () => {
  it('keeps each request its own principal, request id and warnings', async () => {
    const { app, logger } = await sharedApp();
    const { cookie } = await signIn('octocat');

    const responses = await Promise.all([
      call('/api/health', {}, app),
      call('/api/me', {}, app),
      call('/api/projects', { headers: { cookie } }, app),
    ]);
    responses.push(await call('/api/me', {}, app));

    expect(responses.map((response) => response.status)).toEqual([200, 401, 200, 401]);
    const byId = new Map(logger.entries.map((entry) => [entry.requestId, entry]));
    const lines = responses.map((response) => byId.get(response.headers.get('x-request-id') ?? ''));
    expect(lines.map((line) => line?.principal)).toEqual(['none', 'none', 'reviewer', 'none']);
    expect(lines.map((line) => line?.warnings?.length ?? 0)).toEqual([0, 0, 1, 0]);
    expect(byId.size).toBe(4);
  });

  it('does not carry a signed-in reviewer over to the next request', async () => {
    const { app } = await sharedApp();
    const { cookie } = await signIn('octocat');

    expect((await call('/api/me', { headers: { cookie } }, app)).status).toBe(200);
    expect((await call('/api/me', {}, app)).status).toBe(401);
  });
});
