import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createRecordingLog } from '../test/support/logs.ts';
import { NoopGitHubClient, OctokitGitHubClient } from './adapters/github-client.adapter.ts';
import { GitHubAppOAuth } from './adapters/github-oauth.adapter.ts';
import { createDeps } from './composition.ts';

const log = createRecordingLog();

describe('createDeps', () => {
  it('uses the no-op GitHub client until the App is configured', () => {
    expect(createDeps(env, log).github).toBeInstanceOf(NoopGitHubClient);
  });

  it('uses Octokit when both GitHub App secrets are set', () => {
    const appSecrets = {
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    };
    const deps = createDeps({ ...env, ...appSecrets }, log);

    expect(deps.github).toBeInstanceOf(OctokitGitHubClient);
  });

  it('enables GitHub login only when the OAuth client is configured', () => {
    expect(createDeps(env, log).oauth).toBeNull();
    const oauthSecrets = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' };
    const deps = createDeps({ ...env, ...oauthSecrets }, log);

    expect(deps.oauth).toBeInstanceOf(GitHubAppOAuth);
  });

  it('hands the request log to the services', () => {
    expect(createDeps(env, log).log).toBe(log);
  });
});
