import { tallySnapshots } from '@targus/core';
import { describe, expect, it } from 'vitest';

import type { ReviewCommit, SnapshotRecord } from '../../../src/repositories/build.repository.ts';
import {
  completedAt,
  completionOf,
  openBuild,
  records,
  type BuildHarness,
} from './build-harness.ts';

// `commitReview` is the one write of a reviewer's decision (ADR 0013): it lands only on the
// snapshots it was computed from, only at the version they were read at, with the build's tally.

type Harness = () => BuildHarness;

const reviewedAt = new Date('2026-01-05T00:00:00.000Z');

/** A completed build of `count` new, pending snapshots. */
async function reviewableBuild(harness: BuildHarness, key: string, count: number) {
  const { projectId, buildId } = await openBuild(harness, key);
  const stored = records(buildId, key, count);
  await harness.repository.completeWithResults(buildId, stored, completionOf(stored));
  return { projectId, buildId, records: stored };
}

/** Approving `ids` out of `snapshots`, with the tally that leaves. */
function approving(snapshots: readonly SnapshotRecord[], ids: readonly string[]): ReviewCommit {
  const after = snapshots.map((record) =>
    ids.includes(record.id) ? { ...record, review: 'approved' as const } : record,
  );
  const tally = tallySnapshots(after);
  const status = tally.pendingCount === 0 ? 'accepted' : 'pending';
  return { snapshotIds: ids, review: 'approved', reviewedBy: 'octocat', reviewedAt, status, tally };
}

async function commitsManyInChunks(harness: BuildHarness): Promise<void> {
  const { repository } = harness;
  const { projectId, buildId, records: stored } = await reviewableBuild(harness, 'rv-commit', 120);
  const read = await repository.readForReview(buildId);
  expect(read).toEqual({ version: 0, snapshots: stored });
  expect(await repository.findSnapshotById('rv-commit-001')).toEqual(stored[1]);
  expect(await repository.findSnapshotById('rv-commit-none')).toBeNull();

  const ids = stored.slice(0, 110).map((record) => record.id);
  expect(await repository.commitReview(buildId, read.version, approving(stored, ids))).toBe(true);

  const after = await repository.readForReview(buildId);
  expect(after.version).toBe(1);
  expect(after.snapshots.filter((record) => record.review === 'approved')).toHaveLength(110);
  expect(after.snapshots[0]).toMatchObject({
    reviewedBy: 'octocat',
    reviewedAt: reviewedAt.toISOString(),
  });
  expect(after.snapshots[119]).toMatchObject({ review: 'pending', reviewedBy: null });
  expect(await repository.findById(projectId, buildId)).toMatchObject({
    status: 'pending',
    completedAt: completedAt.toISOString(),
    tally: { pendingCount: 10 },
  });
}

async function refusesStaleVersion(harness: BuildHarness): Promise<void> {
  const { repository } = harness;
  const { projectId, buildId, records: stored } = await reviewableBuild(harness, 'rv-stale', 120);
  const { version } = await repository.readForReview(buildId);
  const [first, ...rest] = stored.map((record) => record.id);
  expect(await repository.commitReview(buildId, version, approving(stored, [first ?? '']))).toBe(
    true,
  );
  const committed = await repository.findById(projectId, buildId);

  // Read at the same version, so its tally does not count the first decision.
  expect(await repository.commitReview(buildId, version, approving(stored, rest))).toBe(false);

  const after = await repository.readForReview(buildId);
  expect(after.version).toBe(1);
  expect(after.snapshots.filter((record) => record.review === 'approved')).toHaveLength(1);
  expect(await repository.findById(projectId, buildId)).toEqual(committed);
}

async function decidesOnlyItsOwnSnapshots(harness: BuildHarness): Promise<void> {
  const { repository } = harness;
  const mine = await reviewableBuild(harness, 'rv-own-a', 1);
  const theirs = await reviewableBuild(harness, 'rv-own-b', 1);
  const theirIds = theirs.records.map((record) => record.id);

  expect(await repository.commitReview(mine.buildId, 0, approving(mine.records, theirIds))).toBe(
    true,
  );

  expect(await repository.readForReview(theirs.buildId)).toEqual({
    version: 0,
    snapshots: theirs.records,
  });
  expect((await repository.readForReview(mine.buildId)).snapshots).toEqual(mine.records);
}

async function unknownBuild({ repository }: BuildHarness): Promise<void> {
  expect(await repository.readForReview('rv-none')).toEqual({ version: 0, snapshots: [] });
  expect(await repository.commitReview('rv-none', 0, approving([], []))).toBe(false);
  expect(await repository.readForReview('rv-none')).toEqual({ version: 0, snapshots: [] });
}

/** `readForReview` and `commitReview` of a builds repository. */
export function describeBuildReviewContract(name: string, harness: Harness): void {
  describe(`${name} commitReview`, () => {
    it('commits a decision on many snapshots, in chunks, with the tally and a new version', () =>
      commitsManyInChunks(harness()));
    it('writes nothing for a decision computed before another review committed', () =>
      refusesStaleVersion(harness()));
    it('changes no snapshot of another build, whatever ids it is given', () =>
      decidesOnlyItsOwnSnapshots(harness()));
    it('reads version 0 and no snapshots of an unknown build, and commits nothing to it', () =>
      unknownBuild(harness()));
  });
}
