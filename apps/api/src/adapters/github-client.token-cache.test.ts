import { createFakeClock, type FakeClock } from '@targus/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { createGitHubStub, generatePrivateKeyPem } from '../../test/support/github-stub.ts';
import { OctokitGitHubClient } from './github-client.adapter.ts';
import { InstallationTokenCache, tokenSafetyMarginMs } from './installation-token-cache.ts';

const hourMs = 60 * 60 * 1000;
const target = { installationId: 42, repo: 'example-org/example-app', headSha: 'a'.repeat(40) };
const done = { status: 'completed', conclusion: 'success', summary: 'ok' } as const;
let privateKey = '';

beforeAll(async () => {
  privateKey = await generatePrivateKeyPem();
});

/**
 * The stubbed GitHub, except that tokens expire an hour after the fake clock's now (like the real
 * ones), are numbered so a test can tell them apart, and `/members/` answers `memberStatus`.
 */
function hourlyGitHub(clock: FakeClock, memberStatus: { current: number } = { current: 204 }) {
  const stub = createGitHubStub();
  let minted = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith('/access_tokens')) {
      await stub.fetch(input, init);
      minted += 1;
      const expiresAt = new Date(clock.now().getTime() + hourMs).toISOString();
      return Response.json(
        { token: `token-${String(minted)}`, expires_at: expiresAt },
        { status: 201 },
      );
    }
    if (request.url.includes('/members/') && memberStatus.current !== 204) {
      await stub.fetch(input, init);
      return Response.json({ message: 'no' }, { status: memberStatus.current });
    }
    return stub.fetch(input, init);
  };
  const mints = () => stub.requests.filter((r) => r.path.endsWith('/access_tokens')).length;
  const lastAuthorization = () => stub.requests.at(-1)?.authorization;
  return { fetchImpl, mints, lastAuthorization };
}

function setup(memberStatus?: { current: number }) {
  const clock = createFakeClock();
  const github = hourlyGitHub(clock, memberStatus);
  const tokens = new InstallationTokenCache(clock);
  const client = new OctokitGitHubClient({ appId: '123', privateKey }, github.fetchImpl, tokens);
  return { clock, github, client };
}

describe('OctokitGitHubClient installation tokens', () => {
  it('mints one token per installation and reuses it for every call within the hour', async () => {
    const { github, client } = setup();

    await client.isOrgMember(42, 'example-org', 'member');
    await client.createCheckRun(target, done, 'https://targus.test/builds/b1');
    await client.updateCheckRun(target, 901, done);
    expect(github.mints()).toBe(1);
    expect(github.lastAuthorization()).toBe('token token-1');

    await client.isOrgMember(7, 'elsewhere', 'member');
    expect(github.mints()).toBe(2);
  });

  it('mints a new token once the old one is within the safety margin of expiring', async () => {
    const { clock, github, client } = setup();

    await client.isOrgMember(42, 'example-org', 'member');
    clock.advance(hourMs - tokenSafetyMarginMs - 1);
    await client.isOrgMember(42, 'example-org', 'member');
    expect(github.mints()).toBe(1);

    clock.advance(1);
    await client.isOrgMember(42, 'example-org', 'member');
    expect(github.mints()).toBe(2);
    expect(github.lastAuthorization()).toBe('token token-2');
  });

  it('drops a token GitHub rejects with 401, so the next call mints another', async () => {
    const memberStatus = { current: 401 };
    const { github, client } = setup(memberStatus);

    await expect(client.isOrgMember(42, 'example-org', 'member')).rejects.toThrow();
    memberStatus.current = 204;
    expect(await client.isOrgMember(42, 'example-org', 'member')).toBe(true);

    expect(github.mints()).toBe(2);
  });

  it('shares one mint between calls made at the same time', async () => {
    const { github, client } = setup();

    await Promise.all([
      client.isOrgMember(42, 'example-org', 'member'),
      client.isOrgMember(42, 'example-org', 'stranger'),
      client.updateCheckRun(target, 901, done),
    ]);

    expect(github.mints()).toBe(1);
  });

  it('keeps the token across clients, as one per request is built, for the life of the isolate', async () => {
    // The default cache belongs to the isolate and reads the system clock, so this uses the plain
    // stub, whose tokens expire in 2099; a unique App id keeps this test's key its own.
    const stub = createGitHubStub();
    const credentials = { appId: 'isolate-cache-test', privateKey };

    await new OctokitGitHubClient(credentials, stub.fetch).isOrgMember(42, 'acme', 'member');
    await new OctokitGitHubClient(credentials, stub.fetch).isOrgMember(42, 'acme', 'member');

    expect(stub.requests.filter((r) => r.path.endsWith('/access_tokens'))).toHaveLength(1);
  });
});
