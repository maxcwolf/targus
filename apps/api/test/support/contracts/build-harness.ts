import { tallySnapshots, type NewBuild } from '@targus/core';

import {
  D1BuildRepository,
  type ApiBuildRepository,
  type BuildCompletion,
  type SnapshotRecord,
} from '../../../src/repositories/build.repository.ts';
import {
  createApprovalRepository,
  type ApprovalRepository,
} from '../../../src/repositories/approval.repository.ts';
import { createProjectRepository } from '../../../src/repositories/project.repository.ts';
import { newBuild, newProject, snapshotRecord } from '../fixtures.ts';
import { createInMemoryApprovals } from '../in-memory-approvals.ts';
import { createInMemoryBuilds } from '../in-memory-builds.ts';
import { createInMemoryProjects } from '../in-memory.ts';

/**
 * A builds repository, D1's or the double's, and how to make a project its builds may belong
 * to. The build contract suites call it once per test.
 */
export interface BuildHarness {
  readonly repository: ApiBuildRepository;
  /** The approvals a committed review records and withdraws approvals in. */
  readonly approvals: Pick<ApprovalRepository, 'create' | 'listForProject'>;
  /** A project id that `create` accepts builds for; `key` is unique per call. */
  readonly seedProject: (key: string) => Promise<string>;
}

/** The D1 adapter, whose builds need a project row (foreign key). */
export function d1BuildHarness(database: D1Database): BuildHarness {
  return {
    repository: new D1BuildRepository(database),
    approvals: createApprovalRepository(database),
    async seedProject(key) {
      return (await createProjectRepository(database).create(newProject(key))).id;
    },
  };
}

/** A fresh in-memory double over a projects double, which checks the same foreign key. */
export function inMemoryBuildHarness(): BuildHarness {
  const projects = createInMemoryProjects();
  const approvals = createInMemoryApprovals(projects);
  return {
    repository: createInMemoryBuilds(projects, approvals),
    approvals,
    async seedProject(key) {
      return (await projects.create(newProject(key))).id;
    },
  };
}

export const completedAt = new Date('2026-01-02T00:00:00.000Z');

/** A new `in_progress` build `build-<key>` of a new project. */
export async function openBuild(
  { repository, seedProject }: BuildHarness,
  key: string,
  overrides: Partial<NewBuild> = {},
): Promise<{ projectId: string; buildId: string }> {
  const projectId = await seedProject(key);
  const buildId = `build-${key}`;
  await repository.create(newBuild(buildId, projectId, overrides));
  return { projectId, buildId };
}

/** `count` new, pending snapshots of `buildId`, ids `<prefix>-000` upward in story order. */
export function records(buildId: string, prefix: string, count: number): SnapshotRecord[] {
  return Array.from({ length: count }, (_, index) =>
    snapshotRecord(`${prefix}-${String(index).padStart(3, '0')}`, buildId),
  );
}

/** A `pending` completion whose tally is that of `snapshots`. */
export function completionOf(snapshots: readonly SnapshotRecord[]): BuildCompletion {
  return {
    status: 'pending',
    tally: tallySnapshots(snapshots),
    completedAt,
    resultsDigest: `digest-of-${String(snapshots.length)}`,
  };
}
