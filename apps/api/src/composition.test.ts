import { describe, expect, it } from 'vitest';

import { createTestDeps, testConfig } from '../test/support/in-memory.ts';
import { NoopGitHubClient, OctokitGitHubClient } from './adapters/github-client.adapter.ts';
import { GitHubAppOAuth } from './adapters/github-oauth.adapter.ts';
import { createAppDeps } from './composition.ts';

// The neutral composition root runs without any host: storage comes from the in-memory doubles.
const storage = createTestDeps();
const noGitHub = { ...testConfig, githubApp: null, githubOAuth: null };

describe('createAppDeps', () => {
  it('uses the no-op GitHub client until the App is configured', () => {
    expect(createAppDeps(noGitHub, storage).github).toBeInstanceOf(NoopGitHubClient);
  });

  it('uses Octokit when the GitHub App is configured', () => {
    const githubApp = {
      appId: '123',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    };
    const deps = createAppDeps({ ...noGitHub, githubApp }, storage);

    expect(deps.github).toBeInstanceOf(OctokitGitHubClient);
  });

  it('enables GitHub login only when the OAuth client is configured', () => {
    expect(createAppDeps(noGitHub, storage).oauth).toBeNull();
    const githubOAuth = { clientId: 'id', clientSecret: 'secret' };
    const deps = createAppDeps({ ...noGitHub, githubOAuth }, storage);

    expect(deps.oauth).toBeInstanceOf(GitHubAppOAuth);
  });

  it('keeps the config and the storage the host gave it', () => {
    const deps = createAppDeps(noGitHub, storage);

    expect(deps.config).toBe(noGitHub);
    expect(deps.projects).toBe(storage.projects);
    expect(deps.imageStore).toBe(storage.imageStore);
  });
});
