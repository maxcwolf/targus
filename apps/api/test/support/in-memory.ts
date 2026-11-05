import {
  createFakeClock,
  createFakeIdGenerator,
  resolveBaseline,
  type Approval,
  type Build,
  type FakeClock,
  type ImageStore,
} from '@targus/core';

import { NoopGitHubClient } from '../../src/adapters/github-client.adapter.js';
import { webCryptoTokens } from '../../src/adapters/token.adapter.js';
import type { ApiConfig } from '../../src/config.js';
import type { ApprovalRepository } from '../../src/repositories/approval.repository.js';
import type {
  ApiBuildRepository,
  SnapshotRecord,
} from '../../src/repositories/build.repository.js';
import type { ImageRecord, ImageRepository } from '../../src/repositories/image.repository.js';
import type { Project, ProjectRepository } from '../../src/repositories/project.repository.js';
import type { ServiceDeps } from '../../src/services/deps.js';

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
  };
}

export interface InMemoryBuilds extends ApiBuildRepository {
  readonly builds: Build[];
  readonly snapshots: Map<string, SnapshotRecord[]>;
  readonly checkRunIds: Map<string, number | null>;
}

export function createInMemoryBuilds(): InMemoryBuilds {
  const builds: Build[] = [];
  const snapshots = new Map<string, SnapshotRecord[]>();
  const checkRunIds = new Map<string, number | null>();
  return {
    builds,
    snapshots,
    checkRunIds,
    create(build) {
      const number = builds.filter((other) => other.projectId === build.projectId).length + 1;
      const created = { ...build, number };
      builds.push(created);
      return Promise.resolve(created);
    },
    findById: (projectId, buildId) =>
      Promise.resolve(builds.find((b) => b.projectId === projectId && b.id === buildId) ?? null),
    findLatestSuccessfulForShas: (projectId, shas) =>
      Promise.resolve(
        resolveBaseline(
          shas,
          builds.filter((b) => b.projectId === projectId),
        ),
      ),
    listSnapshots: (buildId) => Promise.resolve([...(snapshots.get(buildId) ?? [])]),
    saveSnapshots(buildId, records) {
      snapshots.set(buildId, [...(snapshots.get(buildId) ?? []), ...records]);
      return Promise.resolve();
    },
    updateStatus(buildId, status, completedAt, checkRunId = null) {
      const index = builds.findIndex((build) => build.id === buildId);
      const build = builds[index];
      if (build !== undefined) {
        builds[index] = { ...build, status, completedAt: completedAt.toISOString(), checkRunId };
      }
      checkRunIds.set(buildId, checkRunId);
      return Promise.resolve();
    },
  };
}

export function createInMemoryApprovals(): ApprovalRepository & { readonly all: Approval[] } {
  const all: Approval[] = [];
  return {
    all,
    listForProject: (projectId) => Promise.resolve(all.filter((a) => a.projectId === projectId)),
    create(_id, approval) {
      all.push(approval);
      return Promise.resolve();
    },
  };
}

export interface InMemoryImages extends ImageRepository, ImageStore {
  readonly records: Map<string, ImageRecord & { lastReferencedAt: Date }>;
  readonly bytes: Map<string, Uint8Array>;
}

/** The image metadata table and the R2 store in one, kept in step like the real pair. */
export function createInMemoryImages(): InMemoryImages {
  const records = new Map<string, ImageRecord & { lastReferencedAt: Date }>();
  const bytes = new Map<string, Uint8Array>();
  return {
    records,
    bytes,
    missing: (hashes) => Promise.resolve(hashes.filter((hash) => !records.has(hash))),
    record(image, at) {
      if (!records.has(image.hash)) records.set(image.hash, { ...image, lastReferencedAt: at });
      return Promise.resolve();
    },
    touch(hashes, at) {
      for (const hash of hashes) {
        const record = records.get(hash);
        if (record !== undefined) records.set(hash, { ...record, lastReferencedAt: at });
      }
      return Promise.resolve();
    },
    put(hash, value) {
      if (!bytes.has(hash)) bytes.set(hash, value);
      return Promise.resolve();
    },
    get: (hash) => Promise.resolve(bytes.get(hash) ?? null),
  };
}

export const testConfig: ApiConfig = {
  version: '0.0.0-test',
  publicUrl: 'https://targus.test',
  diffThreshold: 0.001,
  adminToken: 'admin-secret',
  githubApp: null,
};

export interface TestDeps extends ServiceDeps {
  readonly clock: FakeClock;
  readonly projects: ReturnType<typeof createInMemoryProjects>;
  readonly builds: InMemoryBuilds;
  readonly approvals: ReturnType<typeof createInMemoryApprovals>;
  readonly images: InMemoryImages;
  readonly imageStore: InMemoryImages;
}

export function createTestDeps(overrides: Partial<ServiceDeps> = {}): TestDeps {
  const images = createInMemoryImages();
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
    github: new NoopGitHubClient(),
    ...overrides,
  } as TestDeps;
}
