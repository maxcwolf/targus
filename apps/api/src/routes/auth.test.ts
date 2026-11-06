import { MeResponse } from '@targus/core';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { appWith, call } from '../../test/support/api.js';
import { createFakeOAuth, octocat } from '../../test/support/in-memory-auth.js';
import { signIn, withCookie } from '../../test/support/session.js';

const app = appWith({ oauth: createFakeOAuth() });

/** The `name=value` pairs of a response's Set-Cookie headers, by name. */
function setCookies(response: Response): Map<string, string> {
  return new Map(
    response.headers.getSetCookie().map((header) => {
      const [pair = ''] = header.split(';');
      return [pair.slice(0, pair.indexOf('=')), header];
    }),
  );
}

const pairOf = (header: string | undefined) => header?.split(';')[0] ?? '';

async function startLogin(returnTo: string) {
  const response = await call(`/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`, {}, app);
  const location = new URL(response.headers.get('location') ?? '');
  const stateCookie = setCookies(response).get('targus_oauth');
  return { response, location, stateCookie, state: location.searchParams.get('state') ?? '' };
}

describe('GitHub login round trip', () => {
  it('redirects to GitHub, comes back with a session cookie and lands on returnTo', async () => {
    const start = await startLogin('/builds/b1');
    expect(start.response.status).toBe(302);
    expect(start.location.origin + start.location.pathname).toBe(
      'https://github.test/login/oauth/authorize',
    );
    expect(start.location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:8787/api/auth/github/callback',
    );
    expect(start.stateCookie).toMatch(/HttpOnly/);
    expect(start.stateCookie).toMatch(/SameSite=Lax/);
    expect(start.stateCookie).toMatch(/Max-Age=600/);
    expect(start.stateCookie).not.toMatch(/Secure/);

    const back = await call(
      `/api/auth/github/callback?code=octocat-code&state=${start.state}`,
      { headers: withCookie(pairOf(start.stateCookie)) },
      app,
    );
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/builds/b1');
    const cookies = setCookies(back);
    expect(cookies.get('targus_oauth')).toMatch(/Max-Age=0/);
    const session = cookies.get('targus_session');
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Path=\//);
    expect(session).toMatch(/Max-Age=2592000/);

    const me = await call('/api/me', { headers: withCookie(pairOf(session)) });
    expect(MeResponse.parse(await me.json()).user).toMatchObject({
      login: 'octocat',
      githubId: octocat.githubId,
    });
  });
});

describe('GitHub login callback checks', () => {
  it.each(['//evil.test/phish', '/\t/evil.test/phish', '/.//evil.test/phish'])(
    'sends the unsafe returnTo %j home',
    async (returnTo) => {
      const start = await startLogin(returnTo);
      const back = await call(
        `/api/auth/github/callback?code=octocat-code&state=${start.state}`,
        { headers: withCookie(pairOf(start.stateCookie)) },
        app,
      );

      expect(back.headers.get('location')).toBe('/');
    },
  );

  it('rejects a callback whose state does not match the cookie, or has no cookie', async () => {
    const start = await startLogin('/');

    const wrong = await call(
      '/api/auth/github/callback?code=octocat-code&state=forged',
      { headers: withCookie(pairOf(start.stateCookie)) },
      app,
    );
    const noCookie = await call(`/api/auth/github/callback?code=x&state=${start.state}`, {}, app);
    const tampered = await call(
      `/api/auth/github/callback?code=octocat-code&state=${start.state}`,
      { headers: withCookie(`${pairOf(start.stateCookie)}x`) },
      app,
    );

    for (const response of [wrong, noCookie, tampered]) expect(response.status).toBe(401);
  });
});

describe('GitHub login configuration', () => {
  it('answers 501 when the OAuth client is not configured', async () => {
    const response = await call('/api/auth/github');

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: { code: 'not_implemented', message: 'GitHub login is not configured' },
    });
  });

  it('answers 501 for login and 401 for session routes without SESSION_SECRET', async () => {
    const base = 'http://targus.test';

    expect((await exports.default.fetch(`${base}/api/auth/github`)).status).toBe(501);
    expect((await exports.default.fetch(`${base}/api/auth/github/callback`)).status).toBe(501);
    expect((await exports.default.fetch(`${base}/api/me`)).status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('deletes the session and clears the cookie', async () => {
    const { cookie } = await signIn('octocat');

    const response = await call('/api/auth/logout', {
      method: 'POST',
      headers: withCookie(cookie),
    });

    expect(response.status).toBe(204);
    expect(setCookies(response).get('targus_session')).toMatch(/Max-Age=0/);
    expect((await call('/api/me', { headers: withCookie(cookie) })).status).toBe(401);
    expect((await call('/api/auth/logout', { method: 'POST' })).status).toBe(401);
  });
});
