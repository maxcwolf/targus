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

// The baseline the CLI diffed against is pinned in each result (ADR 0032). A reviewer can deny
// a story on the baseline build while a run is open, which moves that story's baseline; the
// stored snapshot is then classified against the moved baseline, without the CLI's diff.

const before = imageHash('1');
const approved = imageHash('2');
const other = imageHash('3');
const diff = imageHash('d');

async function submit(deps: TestDeps, project: Project, buildId: string, result: StoryResult) {
  const body = { durationMs: 1, threshold: deps.config.diffThreshold, results: [result] };
  await markUploaded(deps.images, project.id, body.results);
  return submitResults(deps, project, buildId, body);
}

/** Approve or deny every snapshot of `buildId`, as a reviewer would, at its current version. */
async function decide(deps: TestDeps, buildId: string, review: 'approved' | 'denied') {
  const { version, snapshots } = await deps.builds.readForReview(buildId);
  const committed = await deps.builds.commitReview(buildId, version, {
    snapshotIds: snapshots.map((snapshot) => snapshot.id),
    review,
    reviewedBy: 'octocat',
    reviewedAt: deps.clock.now(),
    status: review === 'approved' ? 'accepted' : 'denied',
    tally: emptyTally,
    approvals: { record: [], withdraw: [] },
  });
  expect(committed).toBe(true);
}

/** Story `s` as the CLI reports it: `capture`, diffed against the `offered` baseline. */
function cli(capture: string, offered: string, diffRatio: number, diffHash: string | null = null) {
  return storyResult('s', { imageHash: capture, baselineHash: offered, diffRatio, diffHash });
}

/**
 * Build 1 on sha a accepts story `s` as `before`; build 2 on sha b accepts the change to
 * `approved`; build 3 on sha c opens against build 2, so it is offered `approved`.
 */
async function setup() {
  const deps = createTestDeps();
  const project = await deps.projects.create(newProject('pin'));
  const open = async (on: string, mergeBase: string | null) =>
    createBuild(deps, project, createBuildRequest(sha(on), { mergeBaseSha: mergeBase }));
  const first = (await open('a', null)).build.id;
  await submit(deps, project, first, storyResult('s', { imageHash: before }));
  await decide(deps, first, 'approved');
  const second = (await open('b', sha('a'))).build.id;
  await submit(deps, project, second, cli(approved, before, 0.2));
  await decide(deps, second, 'approved');
  const third = await open('c', sha('b'));
  const stored = () => deps.builds.snapshots.get(third.build.id);
  return { deps, project, baselineBuildId: second, third, buildId: third.build.id, stored };
}

describe('a baseline that did not move', () => {
  it('is the baseline createBuild offered', async () => {
    const { third, baselineBuildId } = await setup();

    expect(third.baselineBuildId).toBe(baselineBuildId);
    expect(third.baselines).toEqual([{ storyId: 's', variant: 'default', imageHash: approved }]);
  });

  it('keeps the CLI diff', async () => {
    const { deps, project, buildId, stored } = await setup();

    await submit(deps, project, buildId, cli(other, approved, 0.3, diff));

    expect(stored()).toMatchObject([
      { baselineHash: approved, state: 'changed', diffRatio: 0.3, diffHash: diff },
    ]);
    expect(deps.log.warnings).toEqual([]);
  });

  it('keeps the CLI diff when the baseline was denied and approved again before submit', async () => {
    const { deps, project, baselineBuildId, buildId, stored } = await setup();
    await decide(deps, baselineBuildId, 'denied');
    await decide(deps, baselineBuildId, 'approved');

    await submit(deps, project, buildId, cli(approved, approved, 0));

    expect(stored()).toMatchObject([{ baselineHash: approved, state: 'unchanged', diffRatio: 0 }]);
    expect(deps.log.warnings).toEqual([]);
  });
});

describe('a baseline denied while the run is open', () => {
  it('stores a capture of the denied change as changed, not unchanged', async () => {
    const { deps, project, baselineBuildId, buildId, stored } = await setup();
    await decide(deps, baselineBuildId, 'denied');

    // The CLI saw the same hash as the offered baseline and measured 0.
    await submit(deps, project, buildId, cli(approved, approved, 0));

    expect(stored()).toMatchObject([
      {
        baselineHash: before,
        state: 'changed',
        review: 'pending',
        diffRatio: null,
        diffHash: null,
      },
    ]);
    expect(deps.log.warnings).toEqual([{ event: 'baseline_moved', buildId, stories: 1 }]);
    expect((await deps.builds.findById(project.id, buildId))?.status).toBe('pending');
  });

  it('drops an under-threshold diff of another image instead of storing unchanged', async () => {
    const { deps, project, baselineBuildId, buildId, stored } = await setup();
    await decide(deps, baselineBuildId, 'denied');

    await submit(deps, project, buildId, cli(other, approved, 0.0005, diff));

    expect(stored()).toMatchObject([
      { baselineHash: before, state: 'changed', diffRatio: null, diffHash: null },
    ]);
  });

  it('stores a capture of the moved-to baseline as unchanged with ratio 0', async () => {
    const { deps, project, baselineBuildId, buildId, stored } = await setup();
    await decide(deps, baselineBuildId, 'denied');

    await submit(deps, project, buildId, cli(before, approved, 0.2, diff));

    expect(stored()).toMatchObject([
      {
        baselineHash: before,
        state: 'unchanged',
        review: 'approved',
        diffRatio: 0,
        diffHash: null,
      },
    ]);
  });
});
