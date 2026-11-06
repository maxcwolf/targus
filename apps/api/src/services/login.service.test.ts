import { describe, expect, it } from 'vitest';

import { createFakeOAuth, octocat } from '../../test/support/in-memory-auth.js';
import { createTestDeps, testConfig } from '../../test/support/in-memory.js';
import {
  beginLogin,
  completeLogin,
  cookieSettings,
  logout,
  safeReturnTo,
} from './login.service.js';

describe('safeReturnTo', () => {
  it.each([
    [undefined, '/'],
    ['/builds/b1?tab=diff', '/builds/b1?tab=diff'],
    ['/', '/'],
    ['//evil.test/x', '/'],
    ['/\\evil.test', '/'],
    ['https://evil.test', '/'],
    ['builds', '/'],
    // Browsers drop tabs and newlines before resolving, so these are `//evil.test` to them.
    ['/\t/evil.test', '/'],
    ['/\n/evil.test', '/'],
    ['/\r\\evil.test', '/'],
    // Dot segments that collapse into a protocol-relative path.
    ['/.//evil.test', '/'],
    ['/x/..//evil.test', '/'],
    // An authority that does not parse.
    ['//[', '/'],
    // What is returned is the parsed path, not the input.
    ['/a\tb', '/ab'],
    ['/builds/../library?q=a b#top', '/library?q=a%20b#top'],
  ])('%j -> %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it('returns a path that a browser resolves to the same origin', () => {
    for (const input of ['/\t/evil.test', '/.//evil.test', '/\\evil.test', '/a//b', '/%09/x']) {
      const resolved = new URL(safeReturnTo(input), 'https://targus.test');
      expect(resolved.origin).toBe('https://targus.test');
    }
  });
});

describe('cookieSettings', () => {
  it('signs with the session secret and is Secure only on an https origin', () => {
    expect(cookieSettings(createTestDeps())).toEqual({ secret: 'session-secret', secure: true });
    const http = { ...testConfig, publicUrl: 'http://localhost:8787' };
    expect(cookieSettings({ config: http })).toEqual({ secret: 'session-secret', secure: false });
    expect(cookieSettings({ config: { ...testConfig, sessionSecret: null } })).toBeNull();
  });
});

describe('beginLogin', () => {
  it('sends the browser to GitHub with a fresh state and the callback URL', () => {
    const deps = createTestDeps();

    const login = beginLogin(deps, '//evil.test');

    expect(login.returnTo).toBe('/');
    expect(login.state).toHaveLength(48);
    const url = new URL(login.url);
    expect(url.searchParams.get('state')).toBe(login.state);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://targus.test/api/auth/github/callback',
    );
  });

  it('answers not_implemented without OAuth or without a session secret', () => {
    const noOAuth = createTestDeps({ oauth: null });
    const noSecret = createTestDeps({ config: { ...testConfig, sessionSecret: null } });

    for (const deps of [noOAuth, noSecret]) {
      expect(() => beginLogin(deps, '/')).toThrow('GitHub login is not configured');
    }
  });
});

describe('completeLogin', () => {
  it('stores the GitHub user and opens a 30-day session', async () => {
    const deps = createTestDeps();

    const login = await completeLogin(deps, {
      code: 'octocat-code',
      state: 'st',
      expectedState: 'st',
    });

    expect(login.user).toEqual({ id: 'id-1', ...octocat });
    expect(login.expiresAt).toEqual(new Date('2026-01-31T00:00:00.000Z'));
    const reviewer = await deps.sessions.findActive(login.sessionId, deps.clock.now());
    expect(reviewer?.user.login).toBe('octocat');
  });

  it('keeps the user id when the same GitHub user signs in again', async () => {
    const deps = createTestDeps({
      oauth: createFakeOAuth({ first: octocat, second: { ...octocat, login: 'renamed' } }),
    });
    const callback = { state: 's', expectedState: 's' };

    const first = await completeLogin(deps, { ...callback, code: 'first' });
    const second = await completeLogin(deps, { ...callback, code: 'second' });

    expect(second.user).toEqual({ ...first.user, login: 'renamed' });
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it('rejects a missing code, a missing or mismatched state and a refused code', async () => {
    const deps = createTestDeps();
    const callbacks = [
      { code: undefined, state: 's', expectedState: 's' },
      { code: 'octocat-code', state: undefined, expectedState: 's' },
      { code: 'octocat-code', state: 's', expectedState: null },
      { code: 'octocat-code', state: 's', expectedState: 't' },
      { code: 'unknown-code', state: 's', expectedState: 's' },
    ];

    for (const callback of callbacks) {
      await expect(completeLogin(deps, callback)).rejects.toMatchObject({ code: 'unauthorized' });
    }
    expect(deps.sessions.all.size).toBe(0);
  });

  it('answers not_implemented when OAuth is not configured', async () => {
    const deps = createTestDeps({ oauth: null });

    await expect(
      completeLogin(deps, { code: 'c', state: 's', expectedState: 's' }),
    ).rejects.toMatchObject({ code: 'not_implemented' });
  });
});

describe('logout', () => {
  it('deletes the session', async () => {
    const deps = createTestDeps();
    const { sessionId } = await completeLogin(deps, {
      code: 'octocat-code',
      state: 's',
      expectedState: 's',
    });

    await logout(deps, sessionId);

    expect(await deps.sessions.findActive(sessionId, deps.clock.now())).toBeNull();
  });
});
