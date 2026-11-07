import type { BuildStatusSummary } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { newBuild, newProject, snapshotRecord } from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { createTestDeps } from '../../test/support/in-memory.ts';
import { checkRunState, syncCheckRun } from './check-run.ts';

const base: BuildStatusSummary = {
  status: 'passed',
  conclusion: 'success',
  pendingCount: 0,
  deniedCount: 0,
  errorCount: 0,
};

describe('checkRunState', () => {
  it.each([
    [
      { status: 'pending', conclusion: null, pendingCount: 1 },
      { status: 'in_progress', summary: '1 change awaiting review' },
    ],
    [
      { status: 'pending', conclusion: null, pendingCount: 3 },
      { status: 'in_progress', summary: '3 changes awaiting review' },
    ],
    [{}, { status: 'completed', conclusion: 'success', summary: 'No visual changes' }],
    [
      { status: 'accepted' },
      { status: 'completed', conclusion: 'success', summary: 'All visual changes approved' },
    ],
    [
      { status: 'denied', conclusion: 'failure', deniedCount: 2 },
      { status: 'completed', conclusion: 'failure', summary: '2 changes denied' },
    ],
    [
      { status: 'failed', conclusion: 'failure', errorCount: 1 },
      { status: 'completed', conclusion: 'failure', summary: '1 story failed to render' },
    ],
    [
      { status: 'failed', conclusion: 'failure', errorCount: 2 },
      { status: 'completed', conclusion: 'failure', summary: '2 stories failed to render' },
    ],
  ] as const)('maps %o', (overrides, expected) => {
    expect(checkRunState({ ...base, ...overrides })).toEqual(expected);
  });
});

const failed = { ...base, status: 'denied', conclusion: 'failure', deniedCount: 1 } as const;
const denied = { status: 'completed', conclusion: 'failure', summary: '1 change denied' };
/** The summary of a review that left its unreviewed build at version 0. */
const atVersion0 = { version: 0, summary: failed };

async function syncSetup(installationId: number | null, github = createRecordingGitHub()) {
  const deps = createTestDeps({ github });
  const project = await deps.projects.create(newProject('sync', { installationId }));
  const build = await deps.builds.create(newBuild('b1', project.id, { status: 'pending' }));
  return { deps, github, project, build };
}

describe('syncCheckRun', () => {
  it('moves the build check run to the summary state', async () => {
    const { deps, github, project, build } = await syncSetup(42);

    await syncCheckRun(deps, project, { ...build, checkRunId: 901 }, atVersion0);

    expect(github.updates).toEqual([
      {
        target: { installationId: 42, repo: 'org-sync/app', headSha: build.sha },
        checkRunId: 901,
        state: denied,
      },
    ]);
  });

  it('creates and stores the check run when the build has none', async () => {
    const { deps, github, project, build } = await syncSetup(42);

    await syncCheckRun(deps, project, build, atVersion0);

    expect(github.creates).toEqual([
      {
        target: { installationId: 42, repo: 'org-sync/app', headSha: build.sha },
        state: denied,
        detailsUrl: 'https://targus.test/builds/b1',
      },
    ]);
    expect(github.updates).toEqual([]);
    expect(deps.builds.builds[0]?.checkRunId).toBe(901);
  });

  it('skips an org without an installation, with or without a check run', async () => {
    const { deps, github, project, build } = await syncSetup(null);

    await syncCheckRun(deps, project, build, atVersion0);
    await syncCheckRun(deps, project, { ...build, checkRunId: 901 }, atVersion0);

    expect(github.creates).toEqual([]);
    expect(github.updates).toEqual([]);
  });

  it('logs and carries on when GitHub fails', async () => {
    const github = createRecordingGitHub([], { failUpdates: true });
    const { deps, project, build } = await syncSetup(42, github);

    await expect(
      syncCheckRun(deps, project, { ...build, checkRunId: 901 }, atVersion0),
    ).resolves.toBeUndefined();
    expect(deps.log.warnings).toEqual([
      { event: 'check_run_update_failed', reason: 'GitHub is down' },
    ]);
  });
});

/** A build with one pending new snapshot, whose review version a newer review moved to 2. */
async function reviewedSetup() {
  const setup = await syncSetup(42);
  setup.deps.builds.snapshots.set('b1', [snapshotRecord('s1', 'b1')]);
  setup.deps.builds.versions.set('b1', 2);
  return setup;
}

describe('syncCheckRun after a newer review', () => {
  it('sends the newest summary again when a newer review committed meanwhile', async () => {
    const { deps, github, project, build } = await reviewedSetup();

    await syncCheckRun(
      deps,
      project,
      { ...build, checkRunId: 901 },
      { version: 1, summary: failed },
    );

    expect(github.updates.map((update) => update.state.summary)).toEqual([
      '1 change denied',
      '1 change awaiting review',
    ]);
  });

  it('follows a check run it created with the newest summary', async () => {
    const { deps, github, project, build } = await reviewedSetup();

    await syncCheckRun(deps, project, build, { version: 1, summary: failed });

    expect(github.creates.map((create) => create.state.summary)).toEqual(['1 change denied']);
    expect(github.updates.map((update) => update.state.summary)).toEqual([
      '1 change awaiting review',
    ]);
  });

  it('updates a check run another request created first, and follows it', async () => {
    const { deps, github, project, build } = await reviewedSetup();
    await deps.builds.setCheckRunId('b1', 902);

    // Read before the other request stored its check run, so this one tries to create it.
    await syncCheckRun(deps, project, build, { version: 1, summary: failed });

    expect(github.creates).toEqual([]);
    expect(github.updates.map((update) => [update.checkRunId, update.state.summary])).toEqual([
      [902, '1 change denied'],
      [902, '1 change awaiting review'],
    ]);
  });
});

describe('syncCheckRun under constant review', () => {
  it('gives up, with a warning, when newer reviews keep committing', async () => {
    const { deps, github, project, build } = await reviewedSetup();
    let version = 1;
    const reads = deps.builds.readForReview.bind(deps.builds);
    const racing = {
      ...deps,
      builds: {
        ...deps.builds,
        readForReview: async (buildId: string) => ({
          ...(await reads(buildId)),
          version: (version += 1),
        }),
      },
    };

    await syncCheckRun(
      racing,
      project,
      { ...build, checkRunId: 901 },
      { version: 1, summary: failed },
    );

    expect(github.updates).toHaveLength(5);
    expect(deps.log.warnings).toEqual([{ event: 'check_run_update_superseded', attempts: 5 }]);
  });
});
