import type { Clock, GitHubClient, IdGenerator, ImageStore } from '@targus/core';

import type { GitHubOAuth } from '../adapters/github-oauth.adapter.ts';
import type { Tokens } from '../adapters/token.adapter.ts';
import type { ApiConfig } from '../config.ts';
import type { ServiceLog } from '../logging/request-log.ts';
import type { ApprovalRepository } from '../ports/approval-repository.ts';
import type { ApiBuildRepository } from '../ports/build-repository.ts';
import type { ImageRepository } from '../ports/image-repository.ts';
import type { MembershipRepository } from '../ports/membership-repository.ts';
import type { ProjectRepository } from '../ports/project-repository.ts';
import type { SessionRepository } from '../ports/session-repository.ts';
import type { UserRepository } from '../ports/user-repository.ts';

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
  /** The request's log line, for what a use-case noticed but did not fail on (ADR 0020). */
  readonly log: ServiceLog;
}
