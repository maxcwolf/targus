import type { GitHubClient } from '@targus/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { createGitHubStub, generatePrivateKeyPem } from '../../test/support/github-stub.js';
import { NoopGitHubClient, OctokitGitHubClient } from './github-client.adapter.js';

const target = { installationId: 42, repo: 'example-org/example-app', headSha: 'a'.repeat(40) };
let privateKey = '';

beforeAll(async () => {
  privateKey = await generatePrivateKeyPem();
});

describe('OctokitGitHubClient (stubbed fetch)', () => {
  it('creates a targus/ios check run with an installation token', async () => {
    const stub = createGitHubStub();
    const client = new OctokitGitHubClient({ appId: '123', privateKey }, stub.fetch);

    const result = await client.createCheckRun(
      target,
      { status: 'in_progress', summary: '2 changes awaiting review' },
      'https://targus.example/builds/b1',
    );

    expect(result).toEqual({ id: 901 });
    const [mint, create] = stub.requests;
    expect(mint?.path).toBe('/app/installations/42/access_tokens');
    expect(mint?.authorization).toMatch(/^bearer /i);
    expect(create).toEqual({
      method: 'POST',
      path: '/repos/example-org/example-app/check-runs',
      authorization: 'token installation-token',
      body: {
        name: 'targus/ios',
        head_sha: target.headSha,
        details_url: 'https://targus.example/builds/b1',
        status: 'in_progress',
        output: { title: 'Visual changes awaiting review', summary: '2 changes awaiting review' },
      },
    });
  });

  it('updates a check run to completed with its conclusion', async () => {
    const stub = createGitHubStub();
    const client = new OctokitGitHubClient({ appId: '123', privateKey }, stub.fetch);

    await client.updateCheckRun(target, 901, {
      status: 'completed',
      conclusion: 'failure',
      summary: '1 change denied',
    });

    expect(stub.requests.at(-1)).toMatchObject({
      method: 'PATCH',
      path: '/repos/example-org/example-app/check-runs/901',
      body: {
        status: 'completed',
        conclusion: 'failure',
        output: { title: 'Visual review failed', summary: '1 change denied' },
      },
    });
  });
});

describe('OctokitGitHubClient.isOrgMember (stubbed fetch)', () => {
  it('answers org membership from the members endpoint', async () => {
    const stub = createGitHubStub();
    const client = new OctokitGitHubClient({ appId: '123', privateKey }, stub.fetch);

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
    const client = new OctokitGitHubClient({ appId: '123', privateKey }, failing);

    await expect(client.isOrgMember(42, 'example-org', 'member')).rejects.toThrow();
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
    );

    await client.isOrgMember(42, 'example-org', 'member');

    expect(hosts).toEqual(['http://github-stub.test:9000', 'http://github-stub.test:9000']);
  });
});

describe('NoopGitHubClient', () => {
  it('does nothing and reports check run id 0', async () => {
    const client: GitHubClient = new NoopGitHubClient();
    const state = { status: 'completed', conclusion: 'success', summary: 'ok' } as const;

    expect(await client.createCheckRun(target, state, 'https://x.test')).toEqual({ id: 0 });
    await expect(client.updateCheckRun(target, 1, state)).resolves.toBeUndefined();
    expect(await client.isOrgMember(42, 'example-org', 'member')).toBe(false);
  });
});
