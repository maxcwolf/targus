import type { Clock, GitHubClient, IdGenerator, ImageStore } from '@targus/core';

import type { GitHubOAuth } from '../adapters/github-oauth.adapter.ts';
import type { Tokens } from '../adapters/token.adapter.ts';
import type { ApiConfig } from '../config.ts';
import type { ApprovalRepository } from '../repositories/approval.repository.ts';
import type { ApiBuildRepository } from '../repositories/build.repository.ts';
import type { ImageRepository } from '../repositories/image.repository.ts';
import type { MembershipRepository } from '../repositories/membership.repository.ts';
import type { ProjectRepository } from '../repositories/project.repository.ts';
import type { SessionRepository } from '../repositories/session.repository.ts';
import type { UserRepository } from '../repositories/user.repository.ts';

/** Everything a use-case may touch, as ports. `composition.ts` wires the real adapters. */
export interface ServiceDeps {
  readonly config: ApiConfig;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly tokens: Tokens;
  readonly projects: ProjectRepository;
  readonly builds: ApiBuildRepository;
  readonly approvals: ApprovalRepository;
  readonly images: ImageRepository;
  readonly imageStore: ImageStore;
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly memberships: MembershipRepository;
  /** `NoopGitHubClient` when the GitHub App is not configured. */
  readonly github: GitHubClient;
  /** Null when GitHub login is not configured; `GET /api/auth/github` then answers 501. */
  readonly oauth: GitHubOAuth | null;
}
