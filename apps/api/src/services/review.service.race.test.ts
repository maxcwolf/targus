import { tallySnapshots, type GitHubClient } from '@targus/core';
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
import {
  createInMemoryApprovals,
  createInMemoryBuilds,
  createInMemoryProjects,
  createTestDeps,
} from '../../test/support/in-memory.ts';
import { createBuild } from './build.service.ts';
import { approveAll, reviewSnapshot } from './review.service.ts';

// Two reviewers acting on one build at the same moment. Each review folds the build's tally
// from the snapshots it read; that tally must never be written once another review has
// changed the snapshots since.

interface Setup {
  /** Replaces methods of the builds double. */
  readonly builds?: Partial<ApiBuildRepository>;
  /** Replaces methods of the GitHub recorder. */
  readonly github?: Partial<GitHubClient>;
}

/** A pending build with a changed and a new story, and a hook run right after a review reads. */
async function setup(options: Setup = {}) {
  let afterRead: (() => Promise<unknown>) | null = null;
  const github = createRecordingGitHub(['octocat', 'hubot']);
  const projects = createInMemoryProjects();
  const approvals = createInMemoryApprovals(projects);
  const builds = { ...createInMemoryBuilds(projects, approvals), ...options.builds };
  const deps = createTestDeps({
    github: { ...github, ...options.github },
    projects,
    approvals,
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
    resultsDigest: 'digest',
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

  it('gives up with a conflict, recording no approval, when every commit loses', async () => {
    const commitReview = vi.fn<ApiBuildRepository['commitReview']>().mockResolvedValue(false);
    const { deps, github, octocat } = await setup({ builds: { commitReview } });

    await expect(reviewSnapshot(deps, octocat, 'changed', 'approve')).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(commitReview).toHaveBeenCalledTimes(5);
    expect(deps.approvals.all).toEqual([]);
    expect(github.updates).toEqual([]);
  });
});

describe('approve-all racing a denial', () => {
  it('keeps and reports a denial that lands between approve-all reading and writing', async () => {
    const { deps, github, buildId, octocat, hubot, interleave } = await setup();
    interleave(() => reviewSnapshot(deps, hubot, 'new', 'deny'));

    const response = await approveAll(deps, octocat, buildId);

    // Re-read after the denial, approve-all approves only the change still pending, and says
    // it left the other one as the denial decided it.
    expect(response).toMatchObject({
      approvedCount: 1,
      skippedCount: 1,
      summary: { status: 'denied' },
    });
    expect(deps.builds.snapshots.get(buildId)?.map((s) => [s.id, s.review, s.reviewedBy])).toEqual([
      ['changed', 'approved', 'octocat'],
      ['new', 'denied', 'hubot'],
    ]);
    expect(deps.builds.builds[0]).toMatchObject({ status: 'denied', tally: { deniedCount: 1 } });
    expect(deps.approvals.all.map((approval) => approval.toHash)).toEqual([imageHash('2')]);
    expect(github.updates.at(-1)?.state.summary).toBe('1 change denied');
  });

  it('leaves no approval of a change denied right after approve-all approved it', async () => {
    const { deps, github, buildId, octocat, hubot, interleave } = await setup();
    // approve-all commits, approval included, after the denial read and before it writes.
    interleave(() => approveAll(deps, octocat, buildId));

    const response = await reviewSnapshot(deps, hubot, 'new', 'deny');

    expect(response).toMatchObject({
      snapshot: { review: 'denied' },
      summary: { status: 'denied' },
    });
    expect(deps.approvals.all.map((approval) => approval.toHash)).toEqual([imageHash('2')]);
    expect(github.updates.at(-1)?.state.summary).toBe('1 change denied');
  });
});

/** A promise and the function that settles it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('check-run updates of concurrent reviews', () => {
  it('ends on the last review when two updates reach GitHub in reverse order', async () => {
    const landed: string[] = [];
    const started = deferred();
    const gate = deferred();
    let calls = 0;
    const { deps, octocat, hubot } = await setup({
      github: {
        async updateCheckRun(_target, _checkRunId, state) {
          calls += 1;
          // The first review's update is held at GitHub until the second's has landed.
          if (calls === 1) {
            started.resolve();
            await gate.promise;
          }
          landed.push(state.summary);
        },
      },
    });

    const first = reviewSnapshot(deps, octocat, 'changed', 'approve');
    await started.promise;
    await reviewSnapshot(deps, hubot, 'new', 'approve');
    gate.resolve();
    await first;

    // The first review's update lands after the second's, sees the newer version and resends.
    expect(landed).toEqual([
      'All visual changes approved',
      '1 change awaiting review',
      'All visual changes approved',
    ]);
  });
});
