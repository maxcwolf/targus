import {
  baselineBuildStatuses,
  createFakeClock,
  createFakeIdGenerator,
  emptyTally,
  type BuildStatus,
  resolveBaseline,
  type Approval,
  type FakeClock,
} from '@targus/core';

import { NoopGitHubClient } from '../../src/adapters/github-client.adapter.js';
import { webCryptoTokens } from '../../src/adapters/token.adapter.js';
import type { ApiConfig } from '../../src/config.js';
import type { ApprovalRepository } from '../../src/repositories/approval.repository.js';
import type {
  ApiBuildRepository,
  BuildCompletion,
  BuildRecord,
  SnapshotRecord,
} from '../../src/repositories/build.repository.js';
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
import { createInMemoryImages, type InMemoryImages } from './in-memory-images.js';

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

export interface InMemoryBuilds extends ApiBuildRepository {
  readonly builds: BuildRecord[];
  readonly snapshots: Map<string, SnapshotRecord[]>;
}

/** The snapshot-review half of the builds double. */
function snapshotReviews(
  snapshots: Map<string, SnapshotRecord[]>,
): Pick<ApiBuildRepository, 'findSnapshotById' | 'updateSnapshotReview'> {
  return {
    findSnapshotById: (snapshotId) =>
      Promise.resolve(
        [...snapshots.values()].flat().find((snapshot) => snapshot.id === snapshotId) ?? null,
      ),
    updateSnapshotReview(snapshotIds, { review, reviewedBy, reviewedAt }) {
      const ids = new Set(snapshotIds);
      for (const [buildId, records] of snapshots) {
        snapshots.set(
          buildId,
          records.map((record) =>
            ids.has(record.id)
              ? { ...record, review, reviewedBy, reviewedAt: reviewedAt.toISOString() }
              : record,
          ),
        );
      }
      return Promise.resolve();
    },
  };
}

/** The project-wide build reads of the builds double. */
function buildQueries(
  builds: readonly BuildRecord[],
): Pick<
  ApiBuildRepository,
  'listForProject' | 'findLatestBaselineOnBranch' | 'findLatestSuccessfulForShas'
> {
  const newestFirst = (projectId: string): BuildRecord[] =>
    builds.filter((b) => b.projectId === projectId).sort((a, b) => b.number - a.number);
  return {
    listForProject: (projectId, limit) => Promise.resolve(newestFirst(projectId).slice(0, limit)),
    findLatestBaselineOnBranch: (projectId, branch) =>
      Promise.resolve(
        newestFirst(projectId)
          .filter((b) => b.branch === branch)
          .find((b) => baselineBuildStatuses.some((status) => status === b.status)) ?? null,
      ),
    findLatestSuccessfulForShas: (projectId, shas) =>
      Promise.resolve(
        resolveBaseline(
          shas,
          builds.filter((b) => b.projectId === projectId),
        ),
      ),
  };
}

export function createInMemoryBuilds(): InMemoryBuilds {
  const builds: BuildRecord[] = [];
  const snapshots = new Map<string, SnapshotRecord[]>();
  const find = (match: (build: BuildRecord) => boolean) =>
    Promise.resolve(builds.find(match) ?? null);
  const patch = (buildId: string, fields: Partial<BuildRecord>) => {
    const index = builds.findIndex((build) => build.id === buildId);
    const build = builds[index];
    if (build !== undefined) builds[index] = { ...build, ...fields };
    return Promise.resolve();
  };
  return {
    builds,
    snapshots,
    create(build, tally = emptyTally) {
      const number = builds.filter((other) => other.projectId === build.projectId).length + 1;
      const created = { ...build, number, tally };
      builds.push(created);
      return Promise.resolve(created);
    },
    findById: (projectId, buildId) => find((b) => b.projectId === projectId && b.id === buildId),
    findAnyById: (buildId) => find((b) => b.id === buildId),
    ...buildQueries(builds),
    complete: (buildId, { status, tally, completedAt, checkRunId }) =>
      patch(buildId, { status, tally, completedAt: completedAt.toISOString(), checkRunId }),
    updateReview: (buildId, { status, tally }) => patch(buildId, { status, tally }),
    listSnapshots: (buildId) => Promise.resolve([...(snapshots.get(buildId) ?? [])]),
    saveSnapshots(buildId, records) {
      snapshots.set(buildId, [...(snapshots.get(buildId) ?? []), ...records]);
      return Promise.resolve();
    },
    ...snapshotReviews(snapshots),
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
      all.push(approval);
      return Promise.resolve();
    },
    exists: (...pair) => Promise.resolve(all.some(samePair(...pair))),
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
  const images = createInMemoryImages();
  const users = createInMemoryUsers();
  return {
    config: testConfig,
    clock: createFakeClock(),
    ids: createFakeIdGenerator(),
    tokens: webCryptoTokens,
    projects: createInMemoryProjects(),
    builds: createInMemoryBuilds(),
    approvals: createInMemoryApprovals(),
    images,
    imageStore: images,
    users,
    sessions: createInMemorySessions(users),
    memberships: createInMemoryMemberships(),
    github: new NoopGitHubClient(),
    oauth: createFakeOAuth(),
    ...overrides,
  } as TestDeps;
}

/** The CLI reading as `project`. */
export function asProject(project: Project): Principal {
  return { kind: 'project', project };
}

/** A `complete` call with an empty tally and no check run. */
export function completion(status: BuildStatus, completedAt: Date): BuildCompletion {
  return { status, tally: emptyTally, completedAt, checkRunId: null };
}
