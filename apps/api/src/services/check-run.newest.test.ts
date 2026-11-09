import type { BuildStatusSummary } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { newBuild, newProject, sha } from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { createTestDeps } from '../../test/support/in-memory.ts';
import { createCheckRun, syncCheckRun } from './check-run.ts';

// A commit's check is a commit status, shared by every build of that commit and platform
// (ADR 0040). Only the newest build with results may set it (ADR 0046).

const approved: BuildStatusSummary = {
  status: 'accepted',
  conclusion: 'success',
  pendingCount: 0,
  deniedCount: 0,
  errorCount: 0,
};
const reviewed = { version: 0, summary: approved };
const threePending = {
  counts: { unchanged: 0, changed: 3, new: 0, removed: 0, unstable: 0, error: 0 },
  pendingCount: 3,
  deniedCount: 0,
};

async function setup(github = createRecordingGitHub()) {
  const deps = createTestDeps({ github });
  const project = await deps.projects.create(newProject('newest', { installationId: 42 }));
  const older = await deps.builds.create(newBuild('older', project.id, { status: 'pending' }));
  return { deps, github, project, older };
}

describe('the check of a commit that was built again', () => {
  it('is left to the newer build when an older build is reviewed', async () => {
    const { deps, github, project, older } = await setup();
    await deps.builds.create(newBuild('newer', project.id, { status: 'pending' }), threePending);

    await syncCheckRun(deps, project, { ...older, checkRunId: 901 }, reviewed);
    await syncCheckRun(deps, project, older, reviewed);

    expect(github.updates).toEqual([]);
    expect(github.creates).toEqual([]);
    expect(deps.log.warnings).toEqual([]);
  });

  it('is not created by results that arrive for the older build, and the claim is released', async () => {
    const { deps, github, project, older } = await setup();
    await deps.builds.create(newBuild('newer', project.id, { status: 'passed' }));

    expect(await createCheckRun(deps, project, older, approved)).toEqual({ missing: 'pending' });
    expect(await createCheckRun(deps, project, older, approved)).toEqual({ missing: 'pending' });

    expect(github.creates).toEqual([]);
    expect(deps.builds.builds[0]?.checkRunId).toBeNull();
  });

  it('is still set by the older build while the newer one has no results', async () => {
    const { deps, github, project, older } = await setup();
    await deps.builds.create(newBuild('newer', project.id, { status: 'in_progress' }));

    await syncCheckRun(deps, project, { ...older, checkRunId: 901 }, reviewed);

    expect(github.updates.map((update) => update.detailsUrl)).toEqual([
      'https://targus.test/builds/older',
    ]);
  });

  it('is set by a build whatever later builds of another platform or commit say', async () => {
    const { deps, github, project, older } = await setup();
    await deps.builds.create(newBuild('web', project.id, { status: 'pending', platform: 'web' }));
    await deps.builds.create(newBuild('next', project.id, { status: 'pending', sha: sha('9') }));

    await syncCheckRun(deps, project, { ...older, checkRunId: 901 }, reviewed);

    expect(github.updates.map((update) => update.state.summary)).toEqual([
      'All visual changes approved',
    ]);
  });
});

describe('a newer build that gets its results while an older build sets the check', () => {
  it('has its own state sent again, so the check ends on the newer build', async () => {
    const recording = createRecordingGitHub();
    const { deps, project, older } = await setup({
      ...recording,
      // The newer build completes between the older build's look and its call to GitHub.
      async updateCheckRun(...call) {
        if (recording.updates.length === 0) {
          await deps.builds.create(
            newBuild('newer', project.id, { status: 'pending' }),
            threePending,
          );
        }
        return recording.updateCheckRun(...call);
      },
    });

    await syncCheckRun(deps, project, { ...older, checkRunId: 901 }, reviewed);

    expect(
      recording.updates.map((update) => [update.name, update.state.summary, update.detailsUrl]),
    ).toEqual([
      ['targus/ios', 'All visual changes approved', 'https://targus.test/builds/older'],
      ['targus/ios', '3 changes awaiting review', 'https://targus.test/builds/newer'],
    ]);
  });
});
