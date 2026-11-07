import { emptyTally, type StoryResult } from '@targus/core';
import { describe, expect, it } from 'vitest';

import type { Project } from '../repositories/project.repository.ts';
import {
  createBuildRequest,
  imageHash,
  newProject,
  sha,
  storyResult,
} from '../../test/support/fixtures.ts';
import { markUploaded } from '../../test/support/in-memory-images.ts';
import { createTestDeps, type TestDeps } from '../../test/support/in-memory.ts';
import { createBuild } from './build.service.ts';
import { submitResults } from './results.service.ts';

// An unstable capture never becomes the baseline (ADR 0030): it is approved only so that it
// never blocks the check, so the story keeps the image a reviewer last accepted.
const accepted = imageHash('1');
const wobbly = imageHash('2');

/** Open a build on `sha(digit)` whose merge base is `sha(base)`, and submit `results`. */
async function runBuild(
  deps: TestDeps,
  project: Project,
  digit: string,
  base: string | null,
  results: StoryResult[],
) {
  const request = createBuildRequest(sha(digit), {
    mergeBaseSha: base === null ? null : sha(base),
  });
  const created = await createBuild(deps, project, request);
  await markUploaded(deps.images, project.id, results);
  const threshold = deps.config.diffThreshold;
  const submitted = await submitResults(deps, project, created.build.id, {
    durationMs: 1,
    threshold,
    results,
  });
  return { created, submitted, snapshots: deps.builds.snapshots.get(created.build.id) };
}

/** Build 1 accepts image `accepted`; build 2 captures the story unstable with image `wobbly`. */
async function unstableAfterBaseline(): Promise<{ deps: TestDeps; project: Project }> {
  const deps = createTestDeps();
  const project = await deps.projects.create(newProject('spin'));
  const first = await runBuild(deps, project, 'a', null, [
    storyResult('spinner', { imageHash: accepted }),
  ]);
  await deps.builds.commitReview(first.created.build.id, 0, {
    snapshotIds: (first.snapshots ?? []).map((snapshot) => snapshot.id),
    review: 'approved',
    reviewedBy: 'octocat',
    reviewedAt: deps.clock.now(),
    status: 'accepted',
    tally: emptyTally,
    approvals: { record: [], withdraw: [] },
  });
  const second = await runBuild(deps, project, 'b', 'a', [
    storyResult('spinner', {
      state: 'unstable',
      imageHash: wobbly,
      baselineHash: accepted,
      diffRatio: 0.2,
    }),
  ]);
  expect(second.submitted.summary.status).toBe('passed');
  expect(second.snapshots).toMatchObject([
    { state: 'unstable', review: 'approved', imageHash: wobbly, baselineHash: accepted },
  ]);
  return { deps, project };
}

describe('an unstable capture', () => {
  it('never becomes the baseline: the next build compares with the accepted image', async () => {
    const { deps, project } = await unstableAfterBaseline();

    const third = await runBuild(deps, project, 'c', 'b', [
      storyResult('spinner', {
        state: 'changed',
        imageHash: wobbly,
        baselineHash: accepted,
        diffRatio: 0.2,
      }),
    ]);

    expect(third.created.baselines).toEqual([
      { storyId: 'spinner', variant: 'default', imageHash: accepted },
    ]);
    expect(third.submitted.summary).toMatchObject({ status: 'pending', pendingCount: 1 });
    expect(third.snapshots).toMatchObject([
      { state: 'changed', review: 'pending', imageHash: wobbly, baselineHash: accepted },
    ]);
  });

  it('leaves a later stable capture of the accepted image unchanged', async () => {
    const { deps, project } = await unstableAfterBaseline();

    const third = await runBuild(deps, project, 'c', 'b', [
      storyResult('spinner', { imageHash: accepted, baselineHash: accepted, diffRatio: 0 }),
    ]);

    expect(third.submitted.summary.status).toBe('passed');
    expect(third.snapshots).toMatchObject([
      { state: 'unchanged', review: 'approved', baselineHash: accepted },
    ]);
  });
});
