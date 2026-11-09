import { emptyTally, type SubmitResultsRequest } from '@targus/core';
import { describe, expect, it } from 'vitest';

import type { Project } from '../ports/project-repository.ts';
import {
  createBuildRequest,
  imageHash,
  newProject,
  sha,
  storyResult,
} from '../../test/support/fixtures.ts';
import { markUploaded } from '../../test/support/in-memory-images.ts';
import { createTestDeps, testConfig, type TestDeps } from '../../test/support/in-memory.ts';
import { createBuild } from './build.service.ts';
import { submitResults } from './results.service.ts';

// One threshold decides every story (ADR 0028): the server sends its own with the build, and
// results the CLI diffed with any other threshold are refused.
const serverThreshold = 0.01;

async function setup(): Promise<{ deps: TestDeps; project: Project }> {
  const deps = createTestDeps({ config: { ...testConfig, diffThreshold: serverThreshold } });
  return { deps, project: await deps.projects.create(newProject('limit')) };
}

async function submit(
  deps: TestDeps,
  project: Project,
  buildId: string,
  request: SubmitResultsRequest,
) {
  await markUploaded(deps.images, project.id, request.results);
  return submitResults(deps, project, buildId, request);
}

/** A build on `sha('b')` whose baseline is an accepted build of story `s` with image 1. */
async function buildWithBaseline(deps: TestDeps, project: Project): Promise<string> {
  const first = (await createBuild(deps, project, createBuildRequest(sha('a')))).build.id;
  await submit(deps, project, first, {
    durationMs: 1,
    threshold: serverThreshold,
    results: [storyResult('s', { imageHash: imageHash('1') })],
  });
  await deps.builds.commitReview(first, 0, {
    snapshotIds: (await deps.builds.listSnapshots(first)).map((snapshot) => snapshot.id),
    review: 'approved',
    reviewedBy: 'octocat',
    reviewedAt: deps.clock.now(),
    status: 'accepted',
    tally: emptyTally,
    approvals: { record: [], withdraw: [] },
  });
  const request = createBuildRequest(sha('b'), { mergeBaseSha: sha('a') });
  return (await createBuild(deps, project, request)).build.id;
}

describe('the diff threshold', () => {
  it('is the one the server classifies with, sent with every new build', async () => {
    const { deps, project } = await setup();

    const response = await createBuild(deps, project, createBuildRequest(sha('a')));

    expect(response.threshold).toBe(serverThreshold);
  });

  it('stores a story whose ratio is exactly the threshold as unchanged', async () => {
    const { deps, project } = await setup();
    const buildId = await buildWithBaseline(deps, project);

    await submit(deps, project, buildId, {
      durationMs: 1,
      threshold: serverThreshold,
      results: [
        storyResult('s', {
          imageHash: imageHash('2'),
          baselineHash: imageHash('1'),
          diffRatio: serverThreshold,
        }),
      ],
    });

    expect(deps.builds.snapshots.get(buildId)).toMatchObject([
      { storyId: 's', state: 'unchanged', review: 'approved' },
    ]);
  });

  it('refuses results diffed with another threshold and stores nothing', async () => {
    const { deps, project } = await setup();
    const buildId = await buildWithBaseline(deps, project);

    await expect(
      submit(deps, project, buildId, {
        durationMs: 1,
        threshold: 0.001,
        results: [
          storyResult('s', {
            imageHash: imageHash('2'),
            baselineHash: imageHash('1'),
            diffRatio: 0.005,
          }),
        ],
      }),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('the server classifies with 0.01') as unknown,
    });
    expect(deps.builds.snapshots.get(buildId)).toBeUndefined();
  });
});
