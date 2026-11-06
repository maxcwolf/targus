import { tallySnapshots } from '@targus/core';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { newBuild, newProject, snapshotRecord } from '../../test/support/fixtures.ts';
import type { ReviewCommit, SnapshotRecord } from './build.repository.ts';
import { D1BuildRepository } from './build.repository.ts';
import { createProjectRepository } from './project.repository.ts';

// `commitReview` is the one write of a reviewer's decision. These tests pin down that it lands
// only on the snapshots it was computed from, and that the build's tally comes with it.
const repository = new D1BuildRepository(env.DB);
const completedAt = new Date('2026-01-02T00:00:00.000Z');
const reviewedAt = new Date('2026-01-05T00:00:00.000Z');

/** A completed build of `count` new, pending snapshots. */
async function reviewableBuild(key: string, count: number) {
  const project = await createProjectRepository(env.DB).create(newProject(key));
  const buildId = `build-${key}`;
  await repository.create(newBuild(buildId, project.id));
  const records = Array.from({ length: count }, (_, index) =>
    snapshotRecord(`${key}-${String(index).padStart(3, '0')}`, buildId),
  );
  const tally = tallySnapshots(records);
  await repository.completeWithResults(buildId, records, { status: 'pending', tally, completedAt });
  return { projectId: project.id, buildId, records };
}

/** Approving `ids` out of `records`, with the tally that leaves. */
function approving(records: readonly SnapshotRecord[], ids: readonly string[]): ReviewCommit {
  const after = records.map((record) =>
    ids.includes(record.id) ? { ...record, review: 'approved' as const } : record,
  );
  const tally = tallySnapshots(after);
  const status = tally.pendingCount === 0 ? 'accepted' : 'pending';
  return { snapshotIds: ids, review: 'approved', reviewedBy: 'octocat', reviewedAt, status, tally };
}

describe('D1BuildRepository.commitReview (local D1)', () => {
  it('commits a decision on many snapshots, in chunks, with the tally and a new version', async () => {
    const { projectId, buildId, records } = await reviewableBuild('commit', 120);
    const read = await repository.readForReview(buildId);
    expect(read).toEqual({ version: 0, snapshots: records });
    expect(await repository.findSnapshotById('commit-001')).toEqual(records[1]);
    expect(await repository.findSnapshotById('commit-none')).toBeNull();

    const ids = records.slice(0, 110).map((record) => record.id);
    expect(await repository.commitReview(buildId, read.version, approving(records, ids))).toBe(
      true,
    );

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
  });

  it('writes nothing for a decision computed before another review committed', async () => {
    const { projectId, buildId, records } = await reviewableBuild('stale', 120);
    const { version } = await repository.readForReview(buildId);
    const first = records.slice(0, 1).map((record) => record.id);
    const rest = records.slice(1).map((record) => record.id);
    expect(await repository.commitReview(buildId, version, approving(records, first))).toBe(true);
    const committed = await repository.findById(projectId, buildId);

    // Read at the same version, so its tally does not count the first decision.
    expect(await repository.commitReview(buildId, version, approving(records, rest))).toBe(false);

    const after = await repository.readForReview(buildId);
    expect(after.version).toBe(1);
    expect(after.snapshots.filter((record) => record.review === 'approved')).toHaveLength(1);
    expect(await repository.findById(projectId, buildId)).toEqual(committed);
  });

  it('reads no snapshots and version 0 for an unknown build, and commits nothing to it', async () => {
    expect(await repository.readForReview('build-none')).toEqual({ version: 0, snapshots: [] });
    expect(await repository.commitReview('build-none', 0, approving([], []))).toBe(false);
  });
});
