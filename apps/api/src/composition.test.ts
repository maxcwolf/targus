import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { NoopGitHubClient, OctokitGitHubClient } from './adapters/github-client.adapter.js';
import { GitHubAppOAuth } from './adapters/github-oauth.adapter.js';
import { createDeps } from './composition.js';

describe('createDeps', () => {
  it('uses the no-op GitHub client until the App is configured', () => {
    expect(createDeps(env).github).toBeInstanceOf(NoopGitHubClient);
  });

  it('uses Octokit when both GitHub App secrets are set', () => {
    const deps = createDeps({
      ...env,
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    });

    expect(deps.github).toBeInstanceOf(OctokitGitHubClient);
  });

  it('enables GitHub login only when the OAuth client is configured', () => {
    expect(createDeps(env).oauth).toBeNull();
    const deps = createDeps({ ...env, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' });

    expect(deps.oauth).toBeInstanceOf(GitHubAppOAuth);
  });
});
