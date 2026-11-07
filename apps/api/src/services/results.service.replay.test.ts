import type { GitHubClient, SubmitResultsRequest } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { createBuildRequest, newProject, sha, storyResult } from '../../test/support/fixtures.ts';
import { createRecordingGitHub, type RecordingGitHub } from '../../test/support/github-recorder.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import { markUploaded } from '../../test/support/in-memory-images.ts';
import { completion, createTestDeps } from '../../test/support/in-memory.ts';
import { createBuild } from './build.service.ts';
import { submitResults } from './results.service.ts';
import { reviewSnapshot } from './review.service.ts';

// A results submission whose response was lost is sent again by the CLI. The same request is a
// replay, answered as the first was; other results for a completed build are a conflict
// (ADR 0031).

const request: SubmitResultsRequest = {
  durationMs: 1,
  threshold: 0.001,
  results: [storyResult('one'), storyResult('two')],
};

/** An open build of a project with installation `installationId`; GitHub fails `failCreates`. */
async function openBuild(installationId: number | null, failCreates = 0) {
  const github = createRecordingGitHub(['octocat'], { failCreates });
  const deps = createTestDeps({ github });
  const project = await deps.projects.create(newProject('replay', { installationId }));
  const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));
  await markUploaded(deps.images, project.id, request.results);
  return { deps, github, project, buildId: build.id };
}

describe('submitResults replayed', () => {
  it('answers the same request as the first time, without a second check run', async () => {
    const { deps, github, project, buildId } = await openBuild(42);
    const first = await submitResults(deps, project, buildId, request);

    const replayed = await submitResults(deps, project, buildId, structuredClone(request));

    expect(replayed).toEqual(first);
    expect(replayed).toMatchObject({ checkRun: { id: 901 }, checkRunMissing: null });
    expect(github.creates).toHaveLength(1);
    expect(deps.builds.snapshots.get(buildId)).toHaveLength(2);
  });

  it('answers with the summary as of now when a review decided changes since', async () => {
    const { deps, project, buildId } = await openBuild(42);
    await submitResults(deps, project, buildId, request);
    const reviewer = await signInReviewer(deps, 'octocat');
    const [snapshot] = deps.builds.snapshots.get(buildId) ?? [];
    await reviewSnapshot(deps, reviewer, snapshot?.id ?? '', 'approve');

    const replayed = await submitResults(deps, project, buildId, request);

    expect(replayed.summary).toMatchObject({ status: 'pending', pendingCount: 1 });
  });

  it('creates the check run that GitHub failed to create the first time', async () => {
    const { deps, github, project, buildId } = await openBuild(42, 1);
    const first = await submitResults(deps, project, buildId, request);
    expect(first).toMatchObject({ checkRun: null, checkRunMissing: 'failed' });

    const replayed = await submitResults(deps, project, buildId, request);

    expect(replayed).toMatchObject({ checkRun: { id: 901 }, checkRunMissing: null });
    expect(github.creates.map(({ state }) => state)).toEqual([
      { status: 'in_progress', summary: '2 changes awaiting review' },
    ]);
    expect(deps.builds.builds[0]?.checkRunId).toBe(901);
  });

  it('still says why there is no check run when the org has no installation', async () => {
    const { deps, github, project, buildId } = await openBuild(null);
    await submitResults(deps, project, buildId, request);

    expect(await submitResults(deps, project, buildId, request)).toMatchObject({
      checkRun: null,
      checkRunMissing: 'no_installation',
    });
    expect(github.creates).toEqual([]);
  });
});

/** A promise and the function that resolves it. */
function signal() {
  let fire: () => void = () => undefined;
  const fired = new Promise<void>((resolve) => {
    fire = () => {
      resolve();
    };
  });
  return { fire, fired };
}

/** A GitHub whose check run creations, once called, wait until `release` is called. */
function blockingGitHub(recording: RecordingGitHub) {
  const called = signal();
  const released = signal();
  const github: GitHubClient = {
    ...recording,
    createCheckRun: async (...args) => {
      called.fire();
      await released.fired;
      return recording.createCheckRun(...args);
    },
  };
  return { github, called: called.fired, release: released.fire };
}

describe('submitResults replayed while the first attempt creates the check run', () => {
  it('answers pending, and the first attempt stores the only check run', async () => {
    const recording = createRecordingGitHub(['octocat']);
    const { github, called, release } = blockingGitHub(recording);
    const deps = createTestDeps({ github });
    const project = await deps.projects.create(newProject('replay', { installationId: 42 }));
    const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));
    await markUploaded(deps.images, project.id, request.results);

    const first = submitResults(deps, project, build.id, request);
    await called;
    const replayed = await submitResults(deps, project, build.id, request);

    expect(replayed).toMatchObject({ checkRun: null, checkRunMissing: 'pending' });
    expect(replayed.summary).toMatchObject({ status: 'pending', pendingCount: 2 });
    release();
    expect(await first).toMatchObject({ checkRun: { id: 901 }, checkRunMissing: null });
    expect(recording.creates).toHaveLength(1);
    expect(deps.builds.builds[0]?.checkRunId).toBe(901);
    expect(await submitResults(deps, project, build.id, request)).toMatchObject({
      checkRun: { id: 901 },
      checkRunMissing: null,
    });
  });

  it('answers the check run its creator stored after the replay read the build', async () => {
    const { deps, github, project, buildId } = await openBuild(42, 1);
    await submitResults(deps, project, buildId, request);
    // The creator stores check run 777 between the replay's read and its claim.
    const builds = deps.builds;
    const claimCheckRun: typeof builds.claimCheckRun = async (...args) => {
      await builds.setCheckRunId(buildId, 777);
      return builds.claimCheckRun(...args);
    };

    const replayed = await submitResults(
      { ...deps, builds: { ...builds, claimCheckRun } },
      project,
      buildId,
      request,
    );

    expect(replayed).toMatchObject({ checkRun: { id: 777 }, checkRunMissing: null });
    expect(github.creates).toEqual([]);
  });
});

describe('submitResults for a completed build', () => {
  it('refuses other results with a conflict and keeps the stored ones', async () => {
    const { deps, project, buildId } = await openBuild(42);
    await submitResults(deps, project, buildId, request);
    const stored = deps.builds.snapshots.get(buildId);

    for (const other of [
      { ...request, durationMs: 2 },
      { ...request, results: [storyResult('one')] },
    ]) {
      await expect(submitResults(deps, project, buildId, other)).rejects.toMatchObject({
        code: 'conflict',
        message: `build ${buildId} already has other results`,
      });
    }
    expect(deps.builds.snapshots.get(buildId)).toBe(stored);
  });

  it('refuses any request for a build completed under another digest', async () => {
    const { deps, project, buildId } = await openBuild(42);
    await deps.builds.completeWithResults(buildId, [], completion('passed', deps.clock.now()));

    await expect(submitResults(deps, project, buildId, request)).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
