import { createFakeIdGenerator, type Clock } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { adminToken, appWith, bearer, call, createTestProject } from '../../test/support/api.ts';
import { createBuildRequest, sha } from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { createCapturingLogger, fakeObservability } from '../../test/support/logs.ts';
import { signIn, withCookie } from '../../test/support/session.ts';

/** An app whose request lines land in the returned logger. */
function loggedApp() {
  const logger = createCapturingLogger();
  const app = appWith({ github: createRecordingGitHub(['octocat']) }, fakeObservability(logger));
  return { app, logger };
}

/** A clock that moves 7 ms every time it is read. */
function tickingClock(): Clock {
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  return {
    now: () => {
      now += 7;
      return new Date(now);
    },
  };
}

describe('requestLogger', () => {
  it('gives every response a request id and writes one line for it', async () => {
    const { app, logger } = loggedApp();

    const response = await call('/api/health', { headers: { 'cf-ray': '8f00abc-LHR' } }, app);

    expect(response.headers.get('x-request-id')).toBe('req-1');
    expect(logger.entries).toEqual([
      {
        level: 'info',
        event: 'request',
        requestId: 'req-1',
        cfRay: '8f00abc-LHR',
        method: 'GET',
        route: '/api/health',
        status: 200,
        durationMs: 0,
        principal: 'none',
      },
    ]);
  });

  it('measures the duration with the Clock port', async () => {
    const logger = createCapturingLogger();
    const observe = { clock: tickingClock(), ids: createFakeIdGenerator('req'), logger };
    const app = appWith({}, observe);

    await call('/api/health', {}, app);

    expect(logger.entries[0]?.durationMs).toBe(7);
  });
});

describe('requestLogger fields', () => {
  it('logs the route pattern, not the path with its ids, and the kind of principal', async () => {
    const { app, logger } = loggedApp();
    const { token } = await createTestProject();
    const { cookie } = await signIn('octocat');

    await call('/api/builds/build-that-does-not-exist', { headers: bearer(token) }, app);
    await call('/api/me', { headers: { cookie } }, app);
    await call('/api/admin/projects', { method: 'POST', headers: bearer(adminToken) }, app);
    await call('/api/projects', {}, app);
    await call('/api/no/such/route', {}, app);

    expect(
      logger.entries.map(({ route, principal, status, error }) => ({
        route,
        principal,
        status,
        error,
      })),
    ).toEqual([
      { route: '/api/builds/:id', principal: 'project', status: 404, error: { code: 'not_found' } },
      { route: '/api/me', principal: 'reviewer', status: 200, error: undefined },
      {
        route: '/api/admin/projects',
        principal: 'admin',
        status: 400,
        error: { code: 'bad_request' },
      },
      { route: '/api/projects', principal: 'none', status: 401, error: { code: 'unauthorized' } },
      { route: null, principal: 'none', status: 404, error: undefined },
    ]);
  });
});

describe('requestLogger secrets', () => {
  it('never writes a token, cookie, session id, authorization header or body', async () => {
    const { app, logger } = loggedApp();
    const { token } = await createTestProject();
    const { cookie, sessionId } = await signIn('octocat');
    const bodyMarker = 'only-in-the-request-body';
    const credentials = { ...bearer(token), cookie };

    await call(
      '/api/builds',
      {
        method: 'POST',
        headers: { ...credentials, 'content-type': 'application/json' },
        body: JSON.stringify({ ...createBuildRequest(sha('c')), branch: bodyMarker }),
      },
      app,
    );
    await call('/api/projects', { headers: withCookie(cookie) }, app);
    await call('/api/me', { headers: { ...credentials, authorization: `Bearer ${token}x` } }, app);
    await call('/api/admin/projects', { method: 'POST', headers: bearer(adminToken) }, app);

    expect(logger.lines).toHaveLength(4);
    const written = logger.lines.join('\n');
    for (const secret of [token, adminToken, cookie, sessionId, bodyMarker, 'Bearer', 'cookie']) {
      expect(written).not.toContain(secret);
    }
    expect(logger.lines.map((line) => JSON.parse(line) as unknown)).toEqual(logger.entries);
  });
});
