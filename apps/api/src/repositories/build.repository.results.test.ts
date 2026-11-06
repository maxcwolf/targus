import { tallySnapshots } from '@targus/core';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { newBuild, newProject, snapshotRecord } from '../../test/support/fixtures.js';
import type { SnapshotRecord } from './build.repository.js';
import { D1BuildRepository } from './build.repository.js';
import { createProjectRepository } from './project.repository.js';

// `completeWithResults` is the one write that ends a build's `in_progress` phase. These tests
// pin down that it is all-or-nothing and happens at most once per build.
const repository = new D1BuildRepository(env.DB);
const completedAt = new Date('2026-01-02T00:00:00.000Z');

async function openBuild(key: string): Promise<{ projectId: string; buildId: string }> {
  const project = await createProjectRepository(env.DB).create(newProject(key));
  const buildId = `build-${key}`;
  await repository.create(newBuild(buildId, project.id));
  return { projectId: project.id, buildId };
}

function records(buildId: string, prefix: string, count: number): SnapshotRecord[] {
  return Array.from({ length: count }, (_, index) =>
    snapshotRecord(`${prefix}-${String(index).padStart(2, '0')}`, buildId),
  );
}

const completionOf = (snapshots: readonly SnapshotRecord[]) => ({
  status: 'pending' as const,
  tally: tallySnapshots(snapshots),
  completedAt,
});

describe('D1BuildRepository.completeWithResults is all-or-nothing (local D1)', () => {
  it('writes nothing when a snapshot in a later chunk is rejected', async () => {
    const { projectId, buildId } = await openBuild('atomic');
    const valid = records(buildId, 'atomic', 12);
    // Twelve rows take three INSERT statements; the duplicate story lands in the last one.
    const duplicate = { ...snapshotRecord('atomic-dup', buildId), storyId: 'story-atomic-00' };
    const rejected = [...valid, duplicate];

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
  });
});

describe('D1BuildRepository.completeWithResults happens once (local D1)', () => {
  it('ignores a second submission, leaving the first one as stored', async () => {
    const { projectId, buildId } = await openBuild('once');
    const first = records(buildId, 'first', 2);
    const second = records(buildId, 'second', 3);

    expect(await repository.completeWithResults(buildId, first, completionOf(first))).toBe(true);
    const stored = await repository.findById(projectId, buildId);
    expect(
      await repository.completeWithResults(buildId, second, {
        ...completionOf(second),
        status: 'failed',
      }),
    ).toBe(false);

    expect(await repository.listSnapshots(buildId)).toEqual(first);
    expect(await repository.findById(projectId, buildId)).toEqual(stored);
    expect(stored).toMatchObject({
      status: 'pending',
      completedAt: completedAt.toISOString(),
      tally: { pendingCount: 2 },
    });
  });

  it('lets exactly one of two racing submissions through', async () => {
    const { buildId } = await openBuild('race');
    const left = records(buildId, 'left', 6);
    const right = records(buildId, 'right', 7);

    const outcomes = await Promise.all([
      repository.completeWithResults(buildId, left, completionOf(left)),
      repository.completeWithResults(buildId, right, completionOf(right)),
    ]);

    expect([...outcomes].sort()).toEqual([false, true]);
    expect(await repository.listSnapshots(buildId)).toEqual(outcomes[0] ? left : right);
  });

  it('replaces snapshots left on a build wedged by the old non-atomic write', async () => {
    const { buildId } = await openBuild('wedged');
    await env.DB.prepare(
      `INSERT INTO snapshots (id, build_id, story_id, variant, state, review)
       VALUES ('wedged-stale', ?, 'story-wedged-00', 'default', 'new', 'pending')`,
    )
      .bind(buildId)
      .run();
    const fresh = records(buildId, 'wedged', 1);

    expect(await repository.completeWithResults(buildId, fresh, completionOf(fresh))).toBe(true);
    expect(await repository.listSnapshots(buildId)).toEqual(fresh);
  });
});
