import {
  createFakeClock,
  createFakeIdGenerator,
  emptyTally,
  type BuildStatus,
  type Approval,
  type FakeClock,
} from '@targus/core';

import { NoopGitHubClient } from '../../src/adapters/github-client.adapter.js';
import { webCryptoTokens } from '../../src/adapters/token.adapter.js';
import type { ApiConfig } from '../../src/config.js';
import type { ApprovalRepository } from '../../src/repositories/approval.repository.js';
import type { BuildCompletion } from '../../src/repositories/build.repository.js';
import type { Project, ProjectRepository } from '../../src/repositories/project.repository.js';
import type { ServiceDeps } from '../../src/services/deps.js';
import type { Principal } from '../../src/services/principal.js';
import {
  createFakeOAuth,
  createInMemoryMemberships,
  createInMemorySessions,
  createInMemoryUsers,
  type FakeOAuth,
} from './in-memory-auth.js';
import { createInMemoryBuilds, type InMemoryBuilds } from './in-memory-builds.js';
import { createInMemoryImages, type InMemoryImages } from './in-memory-images.js';

export { createInMemoryBuilds, type InMemoryBuilds } from './in-memory-builds.js';

// In-memory doubles of the API's repositories, for service unit tests. The D1 adapters are
// tested against the same behaviour in src/repositories/*.test.ts.

export function createInMemoryProjects(): ProjectRepository & { readonly all: Project[] } {
  const all: Project[] = [];
  const tokenHashes = new Map<string, string>();
  const find = (match: (project: Project) => boolean) => Promise.resolve(all.find(match) ?? null);
  return {
    all,
    create(input) {
      const org = all.find((project) => project.org.githubOrg === input.githubOrg);
      const project: Project = {
        id: input.id,
        orgId: org?.orgId ?? input.newOrgId,
        repo: input.repo,
        name: input.name,
        defaultBranch: input.defaultBranch,
        createdAt: input.createdAt,
        org: { githubOrg: input.githubOrg, installationId: input.installationId },
      };
      all.push(project);
      tokenHashes.set(input.tokenHash, project.id);
      return Promise.resolve(project);
    },
    findById: (id) => find((project) => project.id === id),
    findByRepo: (repo) => find((project) => project.repo === repo),
    findByTokenHash: (hash) => find((project) => project.id === tokenHashes.get(hash)),
    listAll: () => Promise.resolve([...all].sort((a, b) => a.name.localeCompare(b.name))),
  };
}

/** Whether an approval is of this story's hash pair. */
const samePair =
  (projectId: string, storyId: string, variant: string, fromHash: string | null, toHash: string) =>
  (approval: Approval) =>
    approval.projectId === projectId &&
    approval.storyId === storyId &&
    approval.variant === variant &&
    approval.fromHash === fromHash &&
    approval.toHash === toHash;

export function createInMemoryApprovals(): ApprovalRepository & { readonly all: Approval[] } {
  const all: Approval[] = [];
  return {
    all,
    listForProject: (projectId) => Promise.resolve(all.filter((a) => a.projectId === projectId)),
    create(_id, approval) {
      // The unique indexes on an approval's identity, a null fromHash included.
      const { projectId, storyId, variant, fromHash, toHash } = approval;
      if (!all.some(samePair(projectId, storyId, variant, fromHash, toHash))) all.push(approval);
      return Promise.resolve();
    },
    delete(...pair) {
      const keep = all.filter((approval) => !samePair(...pair)(approval));
      all.splice(0, all.length, ...keep);
      return Promise.resolve();
    },
  };
}

export const testConfig: ApiConfig = {
  version: '0.0.0-test',
  publicUrl: 'https://targus.test',
  diffThreshold: 0.001,
  adminToken: 'admin-secret',
  githubApp: null,
  sessionSecret: 'session-secret',
  githubOAuth: { clientId: 'client-id', clientSecret: 'client-secret' },
  githubOAuthOrigin: 'https://github.test',
  githubApiOrigin: 'https://api.github.test',
};

export interface TestDeps extends ServiceDeps {
  readonly clock: FakeClock;
  readonly projects: ReturnType<typeof createInMemoryProjects>;
  readonly builds: InMemoryBuilds;
  readonly approvals: ReturnType<typeof createInMemoryApprovals>;
  readonly images: InMemoryImages;
  readonly imageStore: InMemoryImages;
  readonly users: ReturnType<typeof createInMemoryUsers>;
  readonly sessions: ReturnType<typeof createInMemorySessions>;
  readonly memberships: ReturnType<typeof createInMemoryMemberships>;
  readonly oauth: FakeOAuth | null;
}

export function createTestDeps(overrides: Partial<ServiceDeps> = {}): TestDeps {
  const users = createInMemoryUsers();
  const projects = createInMemoryProjects();
  const memberships = createInMemoryMemberships();
  // The images double answers `uploaderOrgs` from the same projects and membership cache.
  const images = createInMemoryImages({
    projects: overrides.projects ?? projects,
    memberships: overrides.memberships ?? memberships,
  });
  return {
    config: testConfig,
    clock: createFakeClock(),
    ids: createFakeIdGenerator(),
    tokens: webCryptoTokens,
    projects,
    builds: createInMemoryBuilds(),
    approvals: createInMemoryApprovals(),
    images,
    imageStore: images,
    users,
    sessions: createInMemorySessions(users),
    memberships,
    github: new NoopGitHubClient(),
    oauth: createFakeOAuth(),
    ...overrides,
  } as TestDeps;
}

/** The CLI reading as `project`. */
export function asProject(project: Project): Principal {
  return { kind: 'project', project };
}

/** A `completeWithResults` completion with an empty tally. */
export function completion(status: BuildStatus, completedAt: Date): BuildCompletion {
  return { status, tally: emptyTally, completedAt };
}
