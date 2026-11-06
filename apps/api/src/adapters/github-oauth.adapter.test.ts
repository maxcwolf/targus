import { describe, expect, it } from 'vitest';

import { GitHubAppOAuth } from './github-oauth.adapter.ts';

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}

function fakeFetch(respond: (url: URL) => Response): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const stub: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    calls.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: text === '' ? null : JSON.parse(text),
    });
    return respond(new URL(request.url));
  };
  return { fetch: stub, calls };
}

const options = {
  clientId: 'Iv1.client',
  clientSecret: 'client-secret',
  oauthOrigin: 'https://github.test',
  apiOrigin: 'https://api.github.test',
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

describe('GitHubAppOAuth', () => {
  it('builds the authorize URL on the OAuth origin', () => {
    const url = new URL(
      new GitHubAppOAuth(options).authorizeUrl({
        state: 'st',
        redirectUri: 'https://targus.test/api/auth/github/callback',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://github.test/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'Iv1.client',
      redirect_uri: 'https://targus.test/api/auth/github/callback',
      state: 'st',
    });
  });

  it('exchanges a code for an access token with a JSON POST', async () => {
    const stub = fakeFetch(() => json({ access_token: 'gho_token', token_type: 'bearer' }));
    const oauth = new GitHubAppOAuth(options, stub.fetch);

    const token = await oauth.exchangeCode({ code: 'abc', redirectUri: 'https://x.test/cb' });

    expect(token).toBe('gho_token');
    const [call] = stub.calls;
    expect(call).toMatchObject({
      url: 'https://github.test/login/oauth/access_token',
      method: 'POST',
      body: {
        client_id: 'Iv1.client',
        client_secret: 'client-secret',
        code: 'abc',
        redirect_uri: 'https://x.test/cb',
      },
    });
    expect(call?.headers.get('accept')).toBe('application/json');
  });

  it('refuses a code GitHub rejects, with 200 and an error body or with an error status', async () => {
    const rejected = fakeFetch(() =>
      json({ error: 'bad_verification_code', error_description: 'The code is incorrect.' }),
    );
    const broken = fakeFetch(() => new Response('<html>', { status: 502 }));

    for (const stub of [rejected, broken]) {
      await expect(
        new GitHubAppOAuth(options, stub.fetch).exchangeCode({ code: 'x', redirectUri: 'y' }),
      ).rejects.toMatchObject({ code: 'unauthorized' });
    }
  });
});

describe('GitHubAppOAuth.fetchUser', () => {
  it('fetches the user from the API origin with the token', async () => {
    const stub = fakeFetch(() =>
      json({ id: 583231, login: 'octocat', avatar_url: 'https://avatars.test/u/583231' }),
    );

    const user = await new GitHubAppOAuth(options, stub.fetch).fetchUser('gho_token');

    expect(user).toEqual({
      githubId: 583231,
      login: 'octocat',
      avatarUrl: 'https://avatars.test/u/583231',
    });
    const [call] = stub.calls;
    expect(call?.url).toBe('https://api.github.test/user');
    expect(call?.headers.get('authorization')).toBe('Bearer gho_token');
    expect(call?.headers.get('accept')).toBe('application/vnd.github+json');
    expect(call?.headers.get('user-agent')).toBe('targus');
  });

  it('fails the user lookup on an error status or an unexpected body', async () => {
    const denied = new GitHubAppOAuth(options, fakeFetch(() => json({}, 401)).fetch);
    const odd = new GitHubAppOAuth(options, fakeFetch(() => json({ login: 'x' })).fetch);

    await expect(denied.fetchUser('t')).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(odd.fetchUser('t')).rejects.toThrow();
  });
});
