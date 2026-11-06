import { describe, expect, it } from 'vitest';

import { bearer, call, createTestProject, postJson } from '../../test/support/api.js';
import { createBuildRequest, sha } from '../../test/support/fixtures.js';
import { reviewOrigin, signIn } from '../../test/support/session.js';

// ADR 0015: cookie-authenticated writes must be same-origin; project-token writes are exempt.

function logout(headers: Record<string, string>): Promise<Response> {
  return call('/api/auth/logout', { method: 'POST', headers });
}

async function stillSignedIn(cookie: string): Promise<boolean> {
  return (await call('/api/me', { headers: { cookie } })).status === 200;
}

describe('cookie-authenticated writes', () => {
  it.each([
    ['no Origin', {}],
    ['a foreign Origin', { origin: 'https://evil.test' }],
    ['Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site same-site', { origin: reviewOrigin, 'sec-fetch-site': 'same-site' }],
  ])('are refused with 403 and change nothing when they carry %s', async (_, headers) => {
    const { cookie } = await signIn('octocat');

    const response = await logout({ cookie, ...headers });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
    expect(await stillSignedIn(cookie)).toBe(true);
  });

  it('go through from the review UI origin', async () => {
    const { cookie } = await signIn('octocat');

    const response = await logout({
      cookie,
      origin: reviewOrigin,
      'sec-fetch-site': 'same-origin',
    });

    expect(response.status).toBe(204);
    expect(await stillSignedIn(cookie)).toBe(false);
  });

  it('answer 401, not 403, without a session', async () => {
    expect((await logout({ origin: 'https://evil.test' })).status).toBe(401);
  });

  it('do not affect cookie-authenticated reads from another origin', async () => {
    const { cookie } = await signIn('octocat');

    const response = await call('/api/me', {
      headers: { cookie, origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' },
    });

    expect(response.status).toBe(200);
  });
});

describe('project-token writes', () => {
  it('need no Origin, as the CLI sends none', async () => {
    const { token } = await createTestProject();

    const response = await postJson('/api/builds', token, createBuildRequest(sha('c')));

    expect(response.status).toBe(201);
  });

  it('are not checked against the Origin either', async () => {
    const { token } = await createTestProject();

    const response = await call('/api/builds', {
      method: 'POST',
      headers: {
        ...bearer(token),
        'content-type': 'application/json',
        origin: 'https://evil.test',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify(createBuildRequest(sha('d'))),
    });

    expect(response.status).toBe(201);
  });
});
