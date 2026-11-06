import { consoleLogger } from './adapters/console-logger.adapter.ts';
import { cryptoIdGenerator } from './adapters/crypto-id.adapter.ts';
import { NoopGitHubClient, OctokitGitHubClient } from './adapters/github-client.adapter.ts';
import { GitHubAppOAuth } from './adapters/github-oauth.adapter.ts';
import { systemClock } from './adapters/system-clock.adapter.ts';
import { webCryptoTokens } from './adapters/token.adapter.ts';
import type { ApiConfig } from './config.ts';
import type { Observability } from './middleware/request-log.ts';
import type { ServiceDeps } from './services/deps.ts';

// The neutral half of the composition root (ADR 0023). A host entry (the Worker in
// src/cloudflare/ today) validates its config, builds its storage adapters and joins them with
// these; nothing here knows which platform it runs on.

/** What `createApp` takes: every service dependency except the request's own log. */
export type AppDeps = Omit<ServiceDeps, 'log'>;

/** The dependencies that hold data, which each host supplies from its own storage. */
export type StorageDeps = Pick<
  AppDeps,
  | 'projects'
  | 'builds'
  | 'approvals'
  | 'images'
  | 'imageStore'
  | 'users'
  | 'sessions'
  | 'memberships'
>;

/** The GitHub App client for `config`: Octokit when the App is configured, else a no-op. */
function githubFor(config: ApiConfig): AppDeps['github'] {
  if (config.githubApp === null) return new NoopGitHubClient();
  return new OctokitGitHubClient({ ...config.githubApp, baseUrl: config.githubApiOrigin });
}

/** GitHub login for `config`, or null when the OAuth client is not configured. */
function oauthFor(config: ApiConfig): AppDeps['oauth'] {
  if (config.githubOAuth === null) return null;
  return new GitHubAppOAuth({
    ...config.githubOAuth,
    oauthOrigin: config.githubOAuthOrigin,
    apiOrigin: config.githubApiOrigin,
  });
}

/** The app's dependencies: the host's storage plus the real clock, ids, tokens and GitHub. */
export function createAppDeps(config: ApiConfig, storage: StorageDeps): AppDeps {
  return {
    ...storage,
    config,
    clock: systemClock,
    ids: cryptoIdGenerator,
    tokens: webCryptoTokens,
    github: githubFor(config),
    oauth: oauthFor(config),
  };
}

/** The real request ids, clock and log sink for `requestLogger`. */
export const systemObservability: Observability = {
  clock: systemClock,
  ids: cryptoIdGenerator,
  logger: consoleLogger,
};
