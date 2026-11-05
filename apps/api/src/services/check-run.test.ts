import type { BuildStatusSummary } from '@targus/core';
import { describe, expect, it, vi } from 'vitest';

import { newBuild, newProject } from '../../test/support/fixtures.js';
import { createRecordingGitHub } from '../../test/support/github-recorder.js';
import { createInMemoryProjects } from '../../test/support/in-memory.js';
import { checkRunState, syncCheckRun } from './check-run.js';

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

describe('syncCheckRun', () => {
  const failed = { ...base, status: 'denied', conclusion: 'failure', deniedCount: 1 } as const;

  async function project(installationId: number | null) {
    return createInMemoryProjects().create(newProject('sync', { installationId }));
  }

  it('moves the build check run to the summary state', async () => {
    const github = createRecordingGitHub();
    const build = { ...newBuild('b1', 'project-sync'), number: 1, checkRunId: 901 };

    await syncCheckRun({ github }, await project(42), build, failed);

    expect(github.updates).toEqual([
      {
        target: { installationId: 42, repo: 'org-sync/app', headSha: build.sha },
        checkRunId: 901,
        state: { status: 'completed', conclusion: 'failure', summary: '1 change denied' },
      },
    ]);
  });

  it('skips builds without a check run and orgs without an installation', async () => {
    const github = createRecordingGitHub();
    const build = { ...newBuild('b1', 'project-sync'), number: 1 };

    await syncCheckRun({ github }, await project(42), build, failed);
    await syncCheckRun({ github }, await project(null), { ...build, checkRunId: 901 }, failed);

    expect(github.updates).toEqual([]);
  });

  it('logs and carries on when GitHub fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const github = createRecordingGitHub([], { failUpdates: true });
    const build = { ...newBuild('b1', 'project-sync'), number: 1, checkRunId: 901 };

    await expect(
      syncCheckRun({ github }, await project(42), build, failed),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
