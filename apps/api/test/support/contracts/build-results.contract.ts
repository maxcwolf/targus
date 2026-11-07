import { describe, expect, it } from 'vitest';

import { snapshotRecord } from '../fixtures.ts';
import {
  completedAt,
  completionOf,
  openBuild,
  records,
  type BuildHarness,
} from './build-harness.ts';

// `completeWithResults` is the one write that ends a build's `in_progress` phase: it is
// all-or-nothing, happens at most once per build, and its snapshots read back in story order.

type Harness = () => BuildHarness;

/** An `error` snapshot: its message and no image. */
const errored = {
  state: 'error',
  imageHash: null,
  width: null,
  height: null,
  error: 'TypeError: boom',
} as const;

async function roundTripsInStoryOrder(harness: BuildHarness): Promise<void> {
  const { buildId } = await openBuild(harness, 'br-fields');
  const stored = Array.from({ length: 20 }, (_, index) =>
    snapshotRecord(`br-fields-${String(index).padStart(2, '0')}`, buildId, {
      blank: index === 0,
      reviewedAt: index === 1 ? '2026-01-03T00:00:00.000Z' : null,
      reviewedBy: index === 1 ? 'octocat' : null,
      title: index === 2 ? null : 'Stories/Button',
      name: index === 2 ? null : `Button ${index}`,
      ...(index === 3 ? errored : {}),
    }),
  );

  // Twenty rows take several INSERT statements under D1's parameter limit.
  await harness.repository.completeWithResults(buildId, [...stored].reverse(), completionOf([]));

  expect(await harness.repository.listSnapshots(buildId)).toEqual(stored);
}

async function ordersByStoryThenVariant(harness: BuildHarness): Promise<void> {
  const { buildId } = await openBuild(harness, 'br-order');
  const story = (id: string, storyId: string, variant: string) =>
    snapshotRecord(`br-order-${id}`, buildId, { storyId, variant });
  // Text compares by code unit, as SQLite does: upper case sorts before lower case.
  const sorted = [story('1', 'B', 'x'), story('2', 'a', 'dark'), story('3', 'a', 'light')];
  const submitted = [story('4', 'b', 'Z'), story('5', 'b', 'default'), ...sorted];

  await harness.repository.completeWithResults(buildId, submitted.reverse(), completionOf([]));

  const listed = await harness.repository.listSnapshots(buildId);
  expect(listed.map((record) => record.id)).toEqual(
    ['1', '2', '3', '4', '5'].map((id) => `br-order-${id}`),
  );
  expect((await harness.repository.readForReview(buildId)).snapshots).toEqual(listed);
}

async function rejectsDuplicateStory(harness: BuildHarness): Promise<void> {
  const { projectId, buildId } = await openBuild(harness, 'br-atomic');
  const valid = records(buildId, 'br-atomic', 12);
  // Twelve rows take three INSERT statements; the duplicate story lands in the last one.
  const duplicate = { ...snapshotRecord('br-atomic-dup', buildId), storyId: 'story-br-atomic-000' };
  const rejected = [...valid, duplicate];
  const { repository } = harness;

  await expect(
    repository.completeWithResults(buildId, rejected, completionOf(rejected)),
  ).rejects.toThrow();

  expect(await repository.listSnapshots(buildId)).toEqual([]);
  expect(await repository.findById(projectId, buildId)).toMatchObject({
    status: 'in_progress',
    completedAt: null,
  });
  expect(await repository.completeWithResults(buildId, valid, completionOf(valid))).toBe(true);
  expect(await repository.listSnapshots(buildId)).toEqual(valid);
}

async function rejectsTakenSnapshotId(harness: BuildHarness): Promise<void> {
  const { repository } = harness;
  const first = await openBuild(harness, 'br-ids-a');
  const second = await openBuild(harness, 'br-ids-b');
  const taken = records(first.buildId, 'br-ids', 1);
  await repository.completeWithResults(first.buildId, taken, completionOf(taken));
  const reused = records(second.buildId, 'br-ids', 1);

  await expect(
    repository.completeWithResults(second.buildId, reused, completionOf(reused)),
  ).rejects.toThrow();

  expect(await repository.listSnapshots(second.buildId)).toEqual([]);
  expect(await repository.findSnapshotById('br-ids-000')).toEqual(taken[0]);
  expect(await repository.findById(second.projectId, second.buildId)).toMatchObject({
    status: 'in_progress',
  });
}

async function ignoresSecondSubmission(harness: BuildHarness): Promise<void> {
  const { repository } = harness;
  const { projectId, buildId } = await openBuild(harness, 'br-once');
  const first = records(buildId, 'br-once-first', 2);
  const second = records(buildId, 'br-once-second', 3);

  expect(await repository.findResultsDigest(buildId)).toBeNull();
  expect(await repository.completeWithResults(buildId, first, completionOf(first))).toBe(true);
  const stored = await repository.findById(projectId, buildId);
  const failed = { ...completionOf(second), status: 'failed' as const };
  expect(await repository.completeWithResults(buildId, second, failed)).toBe(false);

  expect(await repository.listSnapshots(buildId)).toEqual(first);
  expect(await repository.findResultsDigest(buildId)).toBe(completionOf(first).resultsDigest);
  expect(await repository.findById(projectId, buildId)).toEqual(stored);
  expect(stored).toMatchObject({
    status: 'pending',
    completedAt: completedAt.toISOString(),
    tally: { pendingCount: 2 },
  });
}

async function oneOfTwoRacing(harness: BuildHarness): Promise<void> {
  const { repository } = harness;
  const { buildId } = await openBuild(harness, 'br-race');
  const left = records(buildId, 'br-race-left', 6);
  const right = records(buildId, 'br-race-right', 7);

  const outcomes = await Promise.all([
    repository.completeWithResults(buildId, left, completionOf(left)),
    repository.completeWithResults(buildId, right, completionOf(right)),
  ]);

  expect([...outcomes].sort()).toEqual([false, true]);
  expect(await repository.listSnapshots(buildId)).toEqual(outcomes[0] ? left : right);
}

async function unknownBuild({ repository }: BuildHarness): Promise<void> {
  const orphans = records('br-none', 'br-none', 1);

  expect(await repository.completeWithResults('br-none', orphans, completionOf(orphans))).toBe(
    false,
  );

  expect(await repository.listSnapshots('br-none')).toEqual([]);
  expect(await repository.findSnapshotById('br-none-000')).toBeNull();
  expect(await repository.findResultsDigest('br-none')).toBeNull();
}

/** `completeWithResults` and the snapshot reads of a builds repository. */
export function describeBuildResultsContract(name: string, harness: Harness): void {
  describe(`${name} completeWithResults`, () => {
    it('stores every snapshot field and lists them in story order', () =>
      roundTripsInStoryOrder(harness()));
    it('orders snapshots by story, then variant, as SQLite compares text', () =>
      ordersByStoryThenVariant(harness()));
    it('writes nothing when a story and variant repeat, even in a later chunk', () =>
      rejectsDuplicateStory(harness()));
    it('writes nothing when a snapshot id belongs to another build', () =>
      rejectsTakenSnapshotId(harness()));
  });

  describe(`${name} completeWithResults happens once`, () => {
    it('ignores a second submission, leaving the first one and its digest as stored', () =>
      ignoresSecondSubmission(harness()));
    it('lets exactly one of two racing submissions through', () => oneOfTwoRacing(harness()));
    it('completes no unknown build and stores none of its snapshots', () =>
      unknownBuild(harness()));
  });
}
