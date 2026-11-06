import { cryptoIdGenerator } from './adapters/crypto-id.adapter.ts';
import { NoopGitHubClient, OctokitGitHubClient } from './adapters/github-client.adapter.ts';
import { GitHubAppOAuth } from './adapters/github-oauth.adapter.ts';
import { systemClock } from './adapters/system-clock.adapter.ts';
import { webCryptoTokens } from './adapters/token.adapter.ts';
import type { Bindings } from './bindings.ts';
import { loadConfig } from './config.ts';
import { createApprovalRepository } from './repositories/approval.repository.ts';
import { D1BuildRepository } from './repositories/build.repository.ts';
import { createImageRepository } from './repositories/image.repository.ts';
import { createMembershipRepository } from './repositories/membership.repository.ts';
import { createProjectRepository } from './repositories/project.repository.ts';
import { createSessionRepository } from './repositories/session.repository.ts';
import { createUserRepository } from './repositories/user.repository.ts';
import type { ServiceDeps } from './services/deps.ts';
import { bindServices, type Services } from './services/index.ts';
import { R2ImageStore } from './storage/r2-image-store.ts';

/** Composition root: the real adapters for one request's bindings. */
export function createDeps(bindings: Bindings): ServiceDeps {
  const config = loadConfig(bindings);
  const images = createImageRepository(bindings.DB);
  return {
    config,
    clock: systemClock,
    ids: cryptoIdGenerator,
    tokens: webCryptoTokens,
    projects: createProjectRepository(bindings.DB),
    builds: new D1BuildRepository(bindings.DB),
    approvals: createApprovalRepository(bindings.DB),
    images,
    imageStore: new R2ImageStore(bindings.IMAGES, images),
    users: createUserRepository(bindings.DB),
    sessions: createSessionRepository(bindings.DB),
    memberships: createMembershipRepository(bindings.DB),
    github:
      config.githubApp === null
        ? new NoopGitHubClient()
        : new OctokitGitHubClient({ ...config.githubApp, baseUrl: config.githubApiOrigin }),
    oauth:
      config.githubOAuth === null
        ? null
        : new GitHubAppOAuth({
            ...config.githubOAuth,
            oauthOrigin: config.githubOAuthOrigin,
            apiOrigin: config.githubApiOrigin,
          }),
  };
}

export function createServices(bindings: Bindings): Services {
  return bindServices(createDeps(bindings));
}
