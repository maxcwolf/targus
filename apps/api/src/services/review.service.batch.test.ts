import { ReviewSnapshotsResponse, tallySnapshots } from '@targus/core';
import { describe, expect, it } from 'vitest';

import {
  createBuildRequest,
  imageHash,
  newProject,
  sha,
  snapshotRecord,
} from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import { createTestDeps } from '../../test/support/in-memory.ts';
import { createBuild } from './build.service.ts';
import { reviewSnapshot, reviewSnapshots } from './review.service.ts';

/** A completed build with two changed stories, a new one and an unchanged one. */
async function setup() {
  const github = createRecordingGitHub(['octocat']);
  const deps = createTestDeps({ github });
  const project = await deps.projects.create(newProject('batch', { installationId: 42 }));
  const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));
  const changed = { state: 'changed' as const, baselineHash: imageHash('1') };
  const snapshots = [
    snapshotRecord('a', build.id, { ...changed, imageHash: imageHash('2') }),
    snapshotRecord('b', build.id, { ...changed, imageHash: imageHash('3') }),
    snapshotRecord('c', build.id, { state: 'new', imageHash: imageHash('4') }),
    snapshotRecord('same', build.id, { state: 'unchanged', review: 'approved' }),
  ];
  await deps.builds.completeWithResults(build.id, snapshots, {
    status: 'pending',
    tally: tallySnapshots(snapshots),
    completedAt: deps.clock.now(),
    resultsDigest: 'digest',
  });
  await deps.builds.setCheckRunId(build.id, 901);
  const reviewer = await signInReviewer(deps, 'octocat');
  const reviews = async () =>
    Object.fromEntries((await deps.builds.listSnapshots(build.id)).map((s) => [s.id, s.review]));
  return { deps, github, buildId: build.id, reviewer, reviews };
}

describe('reviewSnapshots', () => {
  it('approves the snapshots named, records their pairs and updates the check once', async () => {
    const { deps, github, buildId, reviewer, reviews } = await setup();

    const response = await reviewSnapshots(deps, reviewer, buildId, {
      decision: 'approve',
      snapshotIds: ['a', 'b', 'a'],
    });

    expect(ReviewSnapshotsResponse.parse(response)).toEqual(response);
    expect(response).toMatchObject({ decidedCount: 2, summary: { pendingCount: 1 } });
    expect(await reviews()).toEqual({
      a: 'approved',
      b: 'approved',
      c: 'pending',
      same: 'approved',
    });
    expect(deps.approvals.all.map((approval) => approval.storyId).sort()).toEqual([
      'story-a',
      'story-b',
    ]);
    expect(github.updates).toHaveLength(1);
  });

  it('denies them, withdrawing an approval, and the later decision stands', async () => {
    const { deps, buildId, reviewer, reviews } = await setup();
    await reviewSnapshot(deps, reviewer, 'a', 'approve');

    const response = await reviewSnapshots(deps, reviewer, buildId, {
      decision: 'deny',
      snapshotIds: ['a', 'c'],
    });

    expect(response).toMatchObject({ decidedCount: 2, summary: { status: 'denied' } });
    expect(await reviews()).toMatchObject({ a: 'denied', b: 'pending', c: 'denied' });
    expect(deps.approvals.all).toEqual([]);
  });

  it('leaves alone a snapshot already decided that way, and writes nothing when all are', async () => {
    const { deps, github, buildId, reviewer } = await setup();
    await reviewSnapshot(deps, reviewer, 'a', 'approve');

    const some = await reviewSnapshots(deps, reviewer, buildId, {
      decision: 'approve',
      snapshotIds: ['a', 'b'],
    });
    const none = await reviewSnapshots(deps, reviewer, buildId, {
      decision: 'approve',
      snapshotIds: ['a', 'b'],
    });

    expect([some.decidedCount, none.decidedCount]).toEqual([1, 0]);
    expect(deps.approvals.all).toHaveLength(2);
    expect(github.updates).toHaveLength(2);
  });
});

describe('reviewSnapshots refusals', () => {
  it('writes nothing when a snapshot is not of the build or needs no review', async () => {
    const { deps, buildId, reviewer, reviews } = await setup();
    const ask = (snapshotIds: string[]) =>
      reviewSnapshots(deps, reviewer, buildId, { decision: 'approve', snapshotIds });

    await expect(ask(['a', 'elsewhere'])).rejects.toMatchObject({ code: 'not_found' });
    await expect(ask(['a', 'same'])).rejects.toMatchObject({ code: 'conflict' });
    expect(await reviews()).toMatchObject({ a: 'pending' });
    expect(deps.approvals.all).toEqual([]);
  });

  it('refuses a non-member and a build without results', async () => {
    const { deps, buildId, reviewer } = await setup();
    const outsider = await signInReviewer(deps, 'outsider');
    const request = { decision: 'approve' as const, snapshotIds: ['a'] };
    const project = await deps.projects.findById(deps.builds.builds[0]?.projectId ?? '');
    if (project === null) throw new Error('the build has no project');
    const open = await createBuild(deps, project, createBuildRequest(sha('b')));

    await expect(reviewSnapshots(deps, outsider, buildId, request)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(reviewSnapshots(deps, reviewer, open.build.id, request)).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
