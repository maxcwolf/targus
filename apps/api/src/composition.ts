import { cryptoIdGenerator } from './adapters/crypto-id.adapter.js';
import { NoopGitHubClient, OctokitGitHubClient } from './adapters/github-client.adapter.js';
import { GitHubAppOAuth } from './adapters/github-oauth.adapter.js';
import { systemClock } from './adapters/system-clock.adapter.js';
import { webCryptoTokens } from './adapters/token.adapter.js';
import type { Bindings } from './bindings.js';
import { loadConfig } from './config.js';
import { createApprovalRepository } from './repositories/approval.repository.js';
import { D1BuildRepository } from './repositories/build.repository.js';
import { createImageRepository } from './repositories/image.repository.js';
import { createMembershipRepository } from './repositories/membership.repository.js';
import { createProjectRepository } from './repositories/project.repository.js';
import { createSessionRepository } from './repositories/session.repository.js';
import { createUserRepository } from './repositories/user.repository.js';
import type { ServiceDeps } from './services/deps.js';
import { bindServices, type Services } from './services/index.js';
import { R2ImageStore } from './storage/r2-image-store.js';

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
