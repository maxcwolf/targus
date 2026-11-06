import { ApproveAllResponse, ReviewSnapshotResponse, tallySnapshots } from '@targus/core';
import { describe, expect, it } from 'vitest';

import {
  createBuildRequest,
  imageHash,
  newProject,
  sha,
  snapshotRecord,
} from '../../test/support/fixtures.js';
import { createRecordingGitHub } from '../../test/support/github-recorder.js';
import { signInReviewer } from '../../test/support/in-memory-auth.js';
import { createTestDeps } from '../../test/support/in-memory.js';
import type { SnapshotRecord } from '../repositories/build.repository.js';
import { createBuild } from './build.service.js';
import { approveAll, reviewSnapshot } from './review.service.js';

/** A completed build with a changed, a new, an unchanged and a removed story. */
function records(buildId: string): SnapshotRecord[] {
  return [
    snapshotRecord('changed', buildId, {
      state: 'changed',
      baselineHash: imageHash('1'),
      imageHash: imageHash('2'),
    }),
    snapshotRecord('new', buildId, { state: 'new', imageHash: imageHash('3') }),
    snapshotRecord('same', buildId, { state: 'unchanged', review: 'approved' }),
    snapshotRecord('gone', buildId, { state: 'removed', review: 'approved', imageHash: null }),
  ];
}

async function setup() {
  const github = createRecordingGitHub(['octocat']);
  const deps = createTestDeps({ github });
  const project = await deps.projects.create(newProject('review', { installationId: 42 }));
  const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));
  const snapshots = records(build.id);
  const tally = tallySnapshots(snapshots);
  await deps.builds.completeWithResults(build.id, snapshots, {
    status: 'pending',
    tally,
    completedAt: deps.clock.now(),
  });
  await deps.builds.setCheckRunId(build.id, 901);
  const reviewer = await signInReviewer(deps, 'octocat');
  return { deps, github, project, buildId: build.id, reviewer };
}

const summaries = (github: ReturnType<typeof createRecordingGitHub>) =>
  github.updates.map((update) => update.state.summary);

describe('reviewSnapshot approve', () => {
  it('approves the change, records its hash pair and updates the check run', async () => {
    const { deps, github, project, reviewer } = await setup();

    const response = await reviewSnapshot(deps, reviewer, 'changed', 'approve');

    expect(ReviewSnapshotResponse.parse(response)).toEqual(response);
    expect(response.snapshot).toMatchObject({
      id: 'changed',
      review: 'approved',
      reviewedBy: 'octocat',
      reviewedAt: deps.clock.now().toISOString(),
    });
    expect(response.summary).toMatchObject({ status: 'pending', pendingCount: 1 });
    expect(response.build).not.toHaveProperty('tally');
    expect(deps.approvals.all).toEqual([
      {
        projectId: project.id,
        storyId: 'story-changed',
        variant: 'default',
        fromHash: imageHash('1'),
        toHash: imageHash('2'),
        approvedBy: 'octocat',
        approvedAt: deps.clock.now().toISOString(),
      },
    ]);
    expect(deps.builds.builds[0]).toMatchObject({ status: 'pending', tally: { pendingCount: 1 } });
    expect(summaries(github)).toEqual(['1 change awaiting review']);
  });

  it('is a no-op when repeated', async () => {
    const { deps, github, reviewer } = await setup();
    await reviewSnapshot(deps, reviewer, 'changed', 'approve');

    const again = await reviewSnapshot(deps, reviewer, 'changed', 'approve');

    expect(again.snapshot.review).toBe('approved');
    expect(deps.approvals.all).toHaveLength(1);
    expect(github.updates).toHaveLength(1);
  });
});

describe('reviewSnapshot approve to acceptance', () => {
  it('accepts the build once every change is approved, without duplicating an approval', async () => {
    const { deps, github, project, reviewer } = await setup();
    await deps.approvals.create('existing', {
      projectId: project.id,
      storyId: 'story-new',
      variant: 'default',
      fromHash: null,
      toHash: imageHash('3'),
      approvedBy: 'someone',
      approvedAt: deps.clock.now().toISOString(),
    });

    await reviewSnapshot(deps, reviewer, 'new', 'approve');
    const last = await reviewSnapshot(deps, reviewer, 'changed', 'approve');

    expect(last.summary).toMatchObject({ status: 'accepted', conclusion: 'success' });
    expect(deps.approvals.all).toHaveLength(2);
    expect(summaries(github).at(-1)).toBe('All visual changes approved');
  });
});

describe('reviewSnapshot deny', () => {
  it('denies the change, withdraws its approval and fails the check run', async () => {
    const { deps, github, reviewer } = await setup();
    await reviewSnapshot(deps, reviewer, 'new', 'approve');

    const response = await reviewSnapshot(deps, reviewer, 'new', 'deny');

    expect(response.snapshot).toMatchObject({ review: 'denied', reviewedBy: 'octocat' });
    expect(response.summary).toMatchObject({ status: 'denied', conclusion: 'failure' });
    expect(response.counts).toMatchObject({ changed: 1, new: 1, unchanged: 1, removed: 1 });
    expect(deps.approvals.all).toEqual([]);
    expect(github.updates.at(-1)?.state).toEqual({
      status: 'completed',
      conclusion: 'failure',
      summary: '1 change denied',
    });
  });
});

describe('reviewSnapshot refusals', () => {
  it('rejects unknown snapshots, outsiders and snapshots that need no review', async () => {
    const { deps, reviewer } = await setup();
    const outsider = await signInReviewer(deps, 'outsider');

    await expect(reviewSnapshot(deps, reviewer, 'nope', 'approve')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(reviewSnapshot(deps, outsider, 'changed', 'approve')).rejects.toMatchObject({
      code: 'forbidden',
    });
    for (const id of ['same', 'gone']) {
      await expect(reviewSnapshot(deps, reviewer, id, 'deny')).rejects.toThrow(
        'only changed and new snapshots are reviewable',
      );
    }
  });

  it('rejects a snapshot of a build still waiting for its results', async () => {
    const { deps, project, reviewer } = await setup();
    const { build } = await createBuild(deps, project, createBuildRequest(sha('b')));
    // Only a build wedged before results were stored atomically can be in this state.
    deps.builds.snapshots.set(build.id, [snapshotRecord('early', build.id)]);

    await expect(reviewSnapshot(deps, reviewer, 'early', 'approve')).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(approveAll(deps, reviewer, build.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses to approve a reviewable snapshot that somehow has no image', async () => {
    const { deps, buildId, reviewer } = await setup();
    deps.builds.snapshots.set(buildId, [
      ...(await deps.builds.listSnapshots(buildId)),
      snapshotRecord('blank', buildId, { state: 'new', imageHash: null }),
    ]);

    await expect(reviewSnapshot(deps, reviewer, 'blank', 'approve')).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});

describe('approveAll', () => {
  it('approves every pending change at once and accepts the build', async () => {
    const { deps, github, buildId, reviewer } = await setup();

    const response = await approveAll(deps, reviewer, buildId);

    expect(ApproveAllResponse.parse(response)).toEqual(response);
    expect(response).toMatchObject({ approvedCount: 2, summary: { status: 'accepted' } });
    expect(deps.approvals.all.map((approval) => approval.toHash)).toEqual([
      imageHash('2'),
      imageHash('3'),
    ]);
    expect(summaries(github)).toEqual(['All visual changes approved']);

    const again = await approveAll(deps, reviewer, buildId);
    expect(again).toMatchObject({ approvedCount: 0, summary: { status: 'accepted' } });
    expect(github.updates).toHaveLength(1);
  });

  it('leaves denied changes denied', async () => {
    const { deps, buildId, reviewer } = await setup();
    await reviewSnapshot(deps, reviewer, 'changed', 'deny');

    const response = await approveAll(deps, reviewer, buildId);

    expect(response).toMatchObject({ approvedCount: 1, summary: { status: 'denied' } });
  });
});
