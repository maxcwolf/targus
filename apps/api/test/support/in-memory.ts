import {
  createFakeClock,
  createFakeIdGenerator,
  emptyTally,
  type BuildStatus,
  type Approval,
  type FakeClock,
} from '@targus/core';

import { NoopGitHubClient } from '../../src/adapters/github-client.adapter.ts';
import { webCryptoTokens } from '../../src/adapters/token.adapter.ts';
import type { ApiConfig } from '../../src/config.ts';
import type { ApprovalRepository } from '../../src/repositories/approval.repository.ts';
import type { BuildCompletion } from '../../src/repositories/build.repository.ts';
import type {
  NewProject,
  Project,
  ProjectRepository,
} from '../../src/repositories/project.repository.ts';
import type { ServiceDeps } from '../../src/services/deps.ts';
import type { Principal } from '../../src/services/principal.ts';
import {
  createFakeOAuth,
  createInMemoryMemberships,
  createInMemorySessions,
  createInMemoryUsers,
  type FakeOAuth,
} from './in-memory-auth.ts';
import { compareText, uniqueViolation } from './d1-semantics.ts';
import { createInMemoryBuilds, type InMemoryBuilds } from './in-memory-builds.ts';
import { createInMemoryImages, type InMemoryImages } from './in-memory-images.ts';
import { createRecordingLog, type RecordingLog } from './logs.ts';

export { createInMemoryBuilds, type InMemoryBuilds } from './in-memory-builds.ts';

// In-memory doubles of the API's repositories, for service unit tests. Each double and its D1
// adapter run the same contract suite (test/support/contracts/), so the two cannot drift.

/** An org row, keyed by its GitHub org (`orgs.github_org` is unique). */
interface OrgRow {
  readonly orgId: string;
  readonly installationId: number | null;
  readonly githubAccountId: number | null;
}

/** Projects read the org through a join, so every stored project of the org sees `row`. */
function syncOrg(all: Project[], githubOrg: string, row: OrgRow): void {
  const { installationId, githubAccountId } = row;
  all.forEach((project, index) => {
    if (project.orgId === row.orgId)
      all[index] = { ...project, org: { githubOrg, installationId, githubAccountId } };
  });
}

/**
 * As `upsertOrg` in the D1 adapter: create the org, or fill in a non-null installation id,
 * clearing the account id when the installation changes. It runs before the project insert
 * and stays when that insert fails, as in D1.
 */
function upsertOrg(orgs: Map<string, OrgRow>, all: Project[], input: NewProject): OrgRow {
  const existing = orgs.get(input.githubOrg);
  const installationId = input.installationId ?? existing?.installationId ?? null;
  const sameInstallation = existing?.installationId === installationId;
  const org = {
    orgId: existing?.orgId ?? input.newOrgId,
    installationId,
    githubAccountId: sameInstallation ? existing.githubAccountId : null,
  };
  orgs.set(input.githubOrg, org);
  syncOrg(all, input.githubOrg, org);
  return org;
}

/** As the D1 update: only while the org is still on `installationId`. */
function setAccountId(
  orgs: Map<string, OrgRow>,
  all: Project[],
  [orgId, installationId, githubAccountId]: [string, number, number],
): void {
  for (const [githubOrg, row] of orgs) {
    if (row.orgId !== orgId || row.installationId !== installationId) continue;
    const updated = { ...row, githubAccountId };
    orgs.set(githubOrg, updated);
    syncOrg(all, githubOrg, updated);
  }
}

export function createInMemoryProjects(): ProjectRepository & { readonly all: Project[] } {
  const all: Project[] = [];
  const orgs = new Map<string, OrgRow>();
  const tokenHashes = new Map<string, string>();
  const find = (match: (project: Project) => boolean) => Promise.resolve(all.find(match) ?? null);
  // The primary key and the unique indexes on repo and token hash.
  const clashes = (input: NewProject) =>
    all.some(
      (p) =>
        p.id === input.id || p.repo === input.repo || p.id === tokenHashes.get(input.tokenHash),
    );
  return {
    all,
    create(input) {
      const org = upsertOrg(orgs, all, input);
      if (clashes(input)) return uniqueViolation('projects');
      const project: Project = {
        id: input.id,
        orgId: org.orgId,
        repo: input.repo,
        name: input.name,
        defaultBranch: input.defaultBranch,
        createdAt: input.createdAt,
        org: {
          githubOrg: input.githubOrg,
          installationId: org.installationId,
          githubAccountId: org.githubAccountId,
        },
      };
      all.push(project);
      tokenHashes.set(input.tokenHash, project.id);
      return Promise.resolve(project);
    },
    setOrgAccountId(...update) {
      setAccountId(orgs, all, update);
      return Promise.resolve();
    },
    findById: (id) => find((project) => project.id === id),
    findByRepo: (repo) => find((project) => project.repo === repo),
    findByTokenHash: (hash) => find((project) => project.id === tokenHashes.get(hash)),
    listAll: () =>
      Promise.resolve(
        [...all].sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id)),
      ),
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

/** `all` holds the approvals in insertion order; `listForProject` orders them as D1 does. */
export function createInMemoryApprovals(): ApprovalRepository & { readonly all: Approval[] } {
  const all: Approval[] = [];
  const ids = new Map<Approval, string>();
  const oldestFirst = (a: Approval, b: Approval) =>
    compareText(a.approvedAt, b.approvedAt) || compareText(ids.get(a) ?? '', ids.get(b) ?? '');
  return {
    all,
    listForProject: (projectId) =>
      Promise.resolve(all.filter((a) => a.projectId === projectId).sort(oldestFirst)),
    create(id, input) {
      // ON CONFLICT DO NOTHING with no target: the primary key and both identity indexes (a null
      // fromHash included) each make it a no-op. D1 stores approvedAt as epoch milliseconds.
      const approval = { ...input, approvedAt: new Date(input.approvedAt).toISOString() };
      const { projectId, storyId, variant, fromHash, toHash } = approval;
      const taken = [...ids.values()].includes(id);
      if (taken || all.some(samePair(projectId, storyId, variant, fromHash, toHash))) {
        return Promise.resolve();
      }
      all.push(approval);
      ids.set(approval, id);
      return Promise.resolve();
    },
    delete(...pair) {
      const keep = all.filter((approval) => !samePair(...pair)(approval));
      for (const gone of all.filter((approval) => !keep.includes(approval))) ids.delete(gone);
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
  readonly log: RecordingLog;
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
    log: createRecordingLog(),
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
