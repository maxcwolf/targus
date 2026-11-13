import { createFakeClock } from '@targus/core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createGitHubStub,
  generatePrivateKeyPem,
  stubRepositories,
} from '../../test/support/github-stub.ts';
import { NoopGitHubClient, OctokitGitHubClient } from './github-client.adapter.ts';
import { InstallationTokenCache } from './installation-token-cache.ts';

let privateKey = '';
const freshTokens = () => new InstallationTokenCache(createFakeClock());
const clientOn = (fetchImpl: typeof fetch) =>
  new OctokitGitHubClient({ appId: '123', privateKey }, fetchImpl, freshTokens());

beforeAll(async () => {
  privateKey = await generatePrivateKeyPem();
});

describe('OctokitGitHubClient.installationAccount (stubbed fetch)', () => {
  it('reads the account’s id and login as the App', async () => {
    const stub = createGitHubStub([], { 42: 583231 });

    expect(await clientOn(stub.fetch).installationAccount(42)).toEqual({
      id: 583231,
      login: 'example-org',
    });
    expect(stub.requests).toEqual([
      expect.objectContaining({
        path: '/app/installations/42',
        authorization: expect.stringMatching(/^bearer ey/i) as unknown,
      }),
    ]);
  });

  it('is null for an installation the App does not have, and throws any other failure', async () => {
    const answering = (status: number) => () =>
      Promise.resolve(new Response('{"message":"x"}', { status }));

    expect(await clientOn(answering(404)).installationAccount(42)).toBeNull();
    await expect(clientOn(answering(500)).installationAccount(42)).rejects.toMatchObject({
      status: 500,
    });
  });
});

describe('OctokitGitHubClient.listInstallationRepos (stubbed fetch)', () => {
  it('lists the repositories with the installation’s token', async () => {
    const stub = createGitHubStub();

    expect(await clientOn(stub.fetch).listInstallationRepos(42)).toEqual([
      { repo: 'example-org/example-app', defaultBranch: 'main' },
      { repo: 'example-org/design-system', defaultBranch: 'trunk' },
    ]);
    expect(stub.requests.at(-1)).toMatchObject({
      path: '/installation/repositories',
      authorization: 'token installation-token',
    });
  });

  it('reads further pages while a page is full, up to ten', async () => {
    const pages: string[] = [];
    const full = Array.from({ length: 100 }, (_, index) => ({
      full_name: `example-org/repo-${String(index)}`,
      default_branch: 'main',
    }));
    const paged =
      (lastPage: number): typeof fetch =>
      (input, init) => {
        const url = new URL(new Request(input, init).url);
        if (url.pathname.endsWith('/access_tokens')) {
          return Promise.resolve(
            Response.json({ token: 't', expires_at: '2099-01-01T00:00:00Z' }, { status: 201 }),
          );
        }
        const page = url.searchParams.get('page') ?? '';
        pages.push(page);
        return Promise.resolve(
          Response.json({ repositories: Number(page) < lastPage ? full : stubRepositories }),
        );
      };

    expect(await clientOn(paged(3)).listInstallationRepos(42)).toHaveLength(202);
    expect(pages).toEqual(['1', '2', '3']);
    pages.length = 0;
    expect(await clientOn(paged(99)).listInstallationRepos(42)).toHaveLength(1000);
    expect(pages).toHaveLength(10);
  });
});

describe('NoopGitHubClient installations', () => {
  it('has no installation and no repositories', async () => {
    const client = new NoopGitHubClient();

    expect(await client.installationAccount()).toBeNull();
    expect(await client.listInstallationRepos()).toEqual([]);
  });
});
