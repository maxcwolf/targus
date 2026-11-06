import { tallySnapshots } from '@targus/core';
import { describe, expect, it, vi } from 'vitest';

import type { ApiBuildRepository } from '../repositories/build.repository.ts';
import {
  createBuildRequest,
  imageHash,
  newProject,
  sha,
  snapshotRecord,
} from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import { createInMemoryBuilds, createTestDeps } from '../../test/support/in-memory.ts';
import { createBuild } from './build.service.ts';
import { approveAll, reviewSnapshot } from './review.service.ts';

// Two reviewers acting on one build at the same moment. Each review folds the build's tally
// from the snapshots it read; that tally must never be written once another review has
// changed the snapshots since.

/** A pending build with a changed and a new story, and a hook run right after a review reads. */
async function setup(builds: ApiBuildRepository = createInMemoryBuilds()) {
  let afterRead: (() => Promise<unknown>) | null = null;
  const github = createRecordingGitHub(['octocat', 'hubot']);
  const deps = createTestDeps({
    github,
    builds: {
      ...builds,
      async readForReview(buildId) {
        const read = await builds.readForReview(buildId);
        const hook = afterRead;
        afterRead = null;
        await hook?.();
        return read;
      },
    },
  });
  const project = await deps.projects.create(newProject('race', { installationId: 42 }));
  const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));
  const snapshots = [
    snapshotRecord('changed', build.id, {
      state: 'changed',
      baselineHash: imageHash('1'),
      imageHash: imageHash('2'),
    }),
    snapshotRecord('new', build.id, { state: 'new', imageHash: imageHash('3') }),
  ];
  const tally = tallySnapshots(snapshots);
  await deps.builds.completeWithResults(build.id, snapshots, {
    status: 'pending',
    tally,
    completedAt: deps.clock.now(),
  });
  await deps.builds.setCheckRunId(build.id, 901);
  const octocat = await signInReviewer(deps, 'octocat');
  const hubot = await signInReviewer(deps, 'hubot');
  const interleave = (other: () => Promise<unknown>) => {
    afterRead = other;
  };
  return { deps, github, buildId: build.id, octocat, hubot, interleave };
}

describe('concurrent reviews of one build', () => {
  it('folds the tally from both decisions when one commits between the other read and write', async () => {
    const { deps, github, octocat, hubot, interleave } = await setup();
    // hubot approves the new story after octocat's review has read the snapshots.
    interleave(() => reviewSnapshot(deps, hubot, 'new', 'approve'));

    const response = await reviewSnapshot(deps, octocat, 'changed', 'approve');

    expect(response.summary).toMatchObject({ status: 'accepted', pendingCount: 0 });
    expect(deps.builds.builds[0]).toMatchObject({ status: 'accepted', tally: { pendingCount: 0 } });
    expect(github.updates.at(-1)?.state.summary).toBe('All visual changes approved');
    expect(deps.approvals.all.map((approval) => approval.toHash)).toEqual([
      imageHash('3'),
      imageHash('2'),
    ]);
  });

  it('keeps a denial that lands while approve-all is folding the build', async () => {
    const { deps, buildId, octocat, hubot, interleave } = await setup();
    interleave(() => reviewSnapshot(deps, hubot, 'new', 'deny'));

    const response = await approveAll(deps, octocat, buildId);

    // Re-read after the denial, approve-all approves only the change still pending.
    expect(response).toMatchObject({ approvedCount: 1, summary: { status: 'denied' } });
    expect(deps.builds.builds[0]).toMatchObject({ status: 'denied', tally: { deniedCount: 1 } });
    expect(deps.approvals.all.map((approval) => approval.toHash)).toEqual([imageHash('2')]);
  });

  it('gives up with a conflict, recording no approval, when every commit loses', async () => {
    const builds = createInMemoryBuilds();
    const commitReview = vi.fn<ApiBuildRepository['commitReview']>().mockResolvedValue(false);
    const { deps, github, octocat } = await setup({ ...builds, commitReview });

    await expect(reviewSnapshot(deps, octocat, 'changed', 'approve')).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(commitReview).toHaveBeenCalledTimes(5);
    expect(deps.approvals.all).toEqual([]);
    expect(github.updates).toEqual([]);
  });
});
