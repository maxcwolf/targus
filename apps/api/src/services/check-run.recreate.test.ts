import { describe, expect, it } from 'vitest';

import { createBuildRequest, newProject, sha, storyResult } from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import { markUploaded } from '../../test/support/in-memory-images.ts';
import { createTestDeps } from '../../test/support/in-memory.ts';
import { createBuild } from './build.service.ts';
import { submitResults } from './results.service.ts';
import { approveAll, reviewSnapshot } from './review.service.ts';

// A check run GitHub failed to create when the results came in is created by the next review.

/** A build with two new stories, submitted while the first `failCreates` creations fail. */
async function submittedWhileGitHubFailed(installationId: number | null, failCreates = 1) {
  const github = createRecordingGitHub(['octocat'], { failCreates });
  const deps = createTestDeps({ github });
  const project = await deps.projects.create(newProject('recreate', { installationId }));
  const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));
  const results = [storyResult('one'), storyResult('two')];
  await markUploaded(deps.images, project.id, results);
  const response = await submitResults(deps, project, build.id, { durationMs: 1, results });
  const reviewer = await signInReviewer(deps, 'octocat');
  const snapshotIds = (deps.builds.snapshots.get(build.id) ?? []).map((s) => s.id);
  return { deps, github, response, reviewer, buildId: build.id, snapshotIds };
}

describe('a check run missing after the results', () => {
  it('is reported, then created by the next review and updated by later ones', async () => {
    const { deps, github, response, reviewer, buildId, snapshotIds } =
      await submittedWhileGitHubFailed(42);
    const [first = '', second = ''] = snapshotIds;

    expect(response).toMatchObject({ checkRun: null, checkRunMissing: 'failed' });
    expect(deps.builds.builds[0]?.checkRunId).toBeNull();

    await reviewSnapshot(deps, reviewer, first, 'approve');

    expect(github.creates).toEqual([
      {
        target: { installationId: 42, repo: 'org-recreate/app', headSha: sha('a') },
        state: { status: 'in_progress', summary: '1 change awaiting review' },
        detailsUrl: `https://targus.test/builds/${buildId}`,
      },
    ]);
    expect(deps.builds.builds[0]?.checkRunId).toBe(901);

    await reviewSnapshot(deps, reviewer, second, 'approve');

    expect(github.creates).toHaveLength(1);
    expect(github.updates.map(({ checkRunId, state }) => [checkRunId, state.status])).toEqual([
      [901, 'completed'],
    ]);
  });

  it('is created by approve-all, after a review GitHub also failed', async () => {
    const setup = await submittedWhileGitHubFailed(42, 2);
    const { deps, github, reviewer, buildId, snapshotIds } = setup;

    await reviewSnapshot(deps, reviewer, snapshotIds[0] ?? '', 'approve');
    expect(deps.builds.builds[0]?.checkRunId).toBeNull();
    await approveAll(deps, reviewer, buildId);

    expect(github.creates).toEqual([
      expect.objectContaining({
        state: {
          status: 'completed',
          conclusion: 'success',
          summary: 'All visual changes approved',
        },
      }),
    ]);
    expect(deps.builds.builds[0]?.checkRunId).toBe(901);
  });

  // Nobody can review a build of an org without an installation (membership cannot be
  // checked), and syncCheckRun skips one; check-run.test.ts covers that.
  it('is reported as not installed for an org without an installation', async () => {
    const { github, response } = await submittedWhileGitHubFailed(null);

    expect(response).toMatchObject({ checkRun: null, checkRunMissing: 'no_installation' });
    expect(github.creates).toEqual([]);
  });
});
