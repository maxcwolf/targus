import { createFakeClock, type GitHubClient } from '@targus/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { createGitHubStub, generatePrivateKeyPem } from '../../test/support/github-stub.ts';
import { NoopGitHubClient, OctokitGitHubClient } from './github-client.adapter.ts';
import { InstallationTokenCache } from './installation-token-cache.ts';

const target = { installationId: 42, repo: 'example-org/example-app', headSha: 'a'.repeat(40) };
let privateKey = '';

/** A token cache of its own, so each test sees its own token mint. */
const freshTokens = () => new InstallationTokenCache(createFakeClock());

beforeAll(async () => {
  privateKey = await generatePrivateKeyPem();
});

describe('OctokitGitHubClient (stubbed fetch)', () => {
  it('reports a commit status under the name it is given, with an installation token', async () => {
    const stub = createGitHubStub();
    const client = new OctokitGitHubClient({ appId: '123', privateKey }, stub.fetch, freshTokens());

    const result = await client.createCheckRun(
      target,
      'targus/web',
      { status: 'in_progress', summary: '2 changes awaiting review' },
      'https://targus.example/builds/b1',
    );

    expect(result).toEqual({ id: 901 });
    const [mint, create] = stub.requests;
    expect(mint?.path).toBe('/app/installations/42/access_tokens');
    expect(mint?.authorization).toMatch(/^bearer /i);
    expect(create).toEqual({
      method: 'POST',
      path: `/repos/example-org/example-app/statuses/${target.headSha}`,
      authorization: 'token installation-token',
      body: {
        context: 'targus/web',
        target_url: 'https://targus.example/builds/b1',
        state: 'pending',
        description: '2 changes awaiting review',
      },
    });
  });

  it('updates a status by posting it again, with its conclusion, name and link', async () => {
    const stub = createGitHubStub();
    const client = new OctokitGitHubClient({ appId: '123', privateKey }, stub.fetch, freshTokens());

    await client.updateCheckRun(
      target,
      'targus/ios',
      { status: 'completed', conclusion: 'failure', summary: '1 change denied' },
      'https://targus.example/builds/b1',
    );

    expect(stub.requests.at(-1)).toMatchObject({
      method: 'POST',
      path: `/repos/example-org/example-app/statuses/${target.headSha}`,
      body: {
        context: 'targus/ios',
        target_url: 'https://targus.example/builds/b1',
        state: 'failure',
        description: '1 change denied',
      },
    });
  });
});

describe('OctokitGitHubClient.isOrgMember (stubbed fetch)', () => {
  it('answers org membership from the members endpoint', async () => {
    const stub = createGitHubStub();
    const client = new OctokitGitHubClient({ appId: '123', privateKey }, stub.fetch, freshTokens());

    expect(await client.isOrgMember(42, 'example-org', 'member')).toBe(true);
    expect(await client.isOrgMember(42, 'example-org', 'stranger')).toBe(false);
    expect(stub.requests.at(-1)?.path).toBe('/orgs/example-org/members/stranger');
  });

  it('propagates GitHub errors other than 404', async () => {
    const stub = createGitHubStub();
    const failing: typeof fetch = (input, init) => {
      const url = new Request(input, init).url;
      if (url.includes('/members/')) return Promise.resolve(new Response('{}', { status: 500 }));
      return stub.fetch(input, init);
    };
    const client = new OctokitGitHubClient({ appId: '123', privateKey }, failing, freshTokens());

    await expect(client.isOrgMember(42, 'example-org', 'member')).rejects.toThrow();
  });
});

describe('OctokitGitHubClient status descriptions (stubbed fetch)', () => {
  it('cuts a description to the 140 characters GitHub accepts', async () => {
    const stub = createGitHubStub();
    const client = new OctokitGitHubClient({ appId: '123', privateKey }, stub.fetch, freshTokens());

    await client.updateCheckRun(
      target,
      'targus/ios',
      { status: 'completed', conclusion: 'success', summary: 'x'.repeat(200) },
      'https://targus.example/builds/b1',
    );

    expect(stub.requests.at(-1)?.body).toMatchObject({ description: 'x'.repeat(140) });
  });
});

describe('OctokitGitHubClient.installationAccountId (stubbed fetch)', () => {
  it("reads the installation's account id as the App, with no installation token", async () => {
    const stub = createGitHubStub([], { 42: 583231 });
    const client = new OctokitGitHubClient({ appId: '123', privateKey }, stub.fetch, freshTokens());

    expect(await client.installationAccountId(42)).toBe(583231);
    expect(stub.requests).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: '/app/installations/42',
        authorization: expect.stringMatching(/^bearer ey/i) as unknown,
      }),
    ]);
  });

  it('throws when GitHub fails or the installation names no account', async () => {
    const answering =
      (response: () => Response): typeof fetch =>
      () =>
        Promise.resolve(response());
    const gone = new OctokitGitHubClient(
      { appId: '123', privateKey },
      answering(() => new Response('{"message":"Not Found"}', { status: 404 })),
      freshTokens(),
    );
    const accountless = new OctokitGitHubClient(
      { appId: '123', privateKey },
      answering(() => Response.json({ id: 42, account: null })),
      freshTokens(),
    );

    await expect(gone.installationAccountId(42)).rejects.toMatchObject({ status: 404 });
    await expect(accountless.installationAccountId(42)).rejects.toThrow(
      'installation 42 names no account',
    );
  });
});

describe('OctokitGitHubClient baseUrl', () => {
  it('sends every request, token minting included, to the configured API origin', async () => {
    const stub = createGitHubStub();
    const hosts: string[] = [];
    const recording: typeof fetch = (input, init) => {
      hosts.push(new URL(new Request(input, init).url).origin);
      return stub.fetch(input, init);
    };
    const client = new OctokitGitHubClient(
      { appId: '123', privateKey, baseUrl: 'http://github-stub.test:9000' },
      recording,
      freshTokens(),
    );

    await client.isOrgMember(42, 'example-org', 'member');

    expect(hosts).toEqual(['http://github-stub.test:9000', 'http://github-stub.test:9000']);
  });
});

describe('NoopGitHubClient', () => {
  it('does nothing and reports check run id 0', async () => {
    const client: GitHubClient = new NoopGitHubClient();
    const state = { status: 'completed', conclusion: 'success', summary: 'ok' } as const;

    expect(await client.createCheckRun(target, 'targus/ios', state, 'https://x.test')).toEqual({
      id: 0,
    });
    await expect(
      client.updateCheckRun(target, 'targus/ios', state, 'https://x.test'),
    ).resolves.toBeUndefined();
    expect(await client.isOrgMember(42, 'example-org', 'member')).toBe(false);
    await expect(client.installationAccountId(42)).rejects.toThrow('not configured');
  });
});
