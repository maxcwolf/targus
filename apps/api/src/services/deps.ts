import type { Clock, GitHubClient, IdGenerator, ImageStore } from '@targus/core';

import type { Tokens } from '../adapters/token.adapter.js';
import type { ApiConfig } from '../config.js';
import type { ApprovalRepository } from '../repositories/approval.repository.js';
import type { ApiBuildRepository } from '../repositories/build.repository.js';
import type { ImageRepository } from '../repositories/image.repository.js';
import type { ProjectRepository } from '../repositories/project.repository.js';

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
  /** `NoopGitHubClient` when the GitHub App is not configured. */
  readonly github: GitHubClient;
}
