import type { BuildStatusSummary, GitHubClient } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { newBuild, newProject } from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { createTestDeps } from '../../test/support/in-memory.ts';
import { NoopGitHubClient } from '../adapters/github-client.adapter.ts';
import { createCheckRun } from './check-run.ts';

const base: BuildStatusSummary = {
  status: 'passed',
  conclusion: 'success',
  pendingCount: 0,
  deniedCount: 0,
  errorCount: 0,
};

async function setup(github: GitHubClient) {
  const deps = createTestDeps({ github });
  const project = await deps.projects.create(newProject('create', { installationId: 42 }));
  const build = await deps.builds.create(newBuild('b1', project.id, { status: 'passed' }));
  return { deps, project, build };
}

describe('createCheckRun claims', () => {
  it('creates one check run when two requests race to create it', async () => {
    const github = createRecordingGitHub();
    const { deps, project, build } = await setup(github);

    const outcomes = await Promise.all([
      createCheckRun(deps, project, build, base),
      createCheckRun(deps, project, build, base),
    ]);

    expect(outcomes).toEqual([{ id: 901 }, { missing: 'pending' }]);
    expect(github.creates).toHaveLength(1);
    expect(deps.builds.builds[0]?.checkRunId).toBe(901);
  });

  it('releases the claim when GitHub fails, so a later request creates it', async () => {
    const github = createRecordingGitHub([], { failCreates: 1 });
    const { deps, project, build } = await setup(github);

    expect(await createCheckRun(deps, project, build, base)).toEqual({ missing: 'failed' });
    expect(deps.builds.builds[0]?.checkRunId).toBeNull();
    expect(await createCheckRun(deps, project, build, base)).toEqual({ id: 901 });
    expect(deps.log.warnings).toEqual([
      { event: 'check_run_create_failed', reason: 'GitHub is down' },
    ]);
  });

  it('takes over a claim whose request died before it stored or released it', async () => {
    const github = createRecordingGitHub();
    const { deps, project, build } = await setup(github);
    await deps.builds.claimCheckRun(build.id, deps.clock.now(), deps.clock.now());

    expect(await createCheckRun(deps, project, build, base)).toEqual({ missing: 'pending' });
    deps.clock.advance(5 * 60_000 + 1);
    expect(await createCheckRun(deps, project, build, base)).toEqual({ id: 901 });
  });
});

describe('createCheckRun without a check run', () => {
  it('answers no_github_app for the no-op client and frees the claim', async () => {
    const { deps, project, build } = await setup(new NoopGitHubClient());

    expect(await createCheckRun(deps, project, build, base)).toEqual({ missing: 'no_github_app' });
    expect(await deps.builds.claimCheckRun(build.id, deps.clock.now(), deps.clock.now())).toBe(
      true,
    );
  });

  it('logs a D1 failure to claim, store or release instead of throwing', async () => {
    const github = createRecordingGitHub([], { failCreates: 1 });
    const { deps, project, build } = await setup(github);
    const down = () => Promise.reject(new Error('D1 is unavailable'));
    const builds = { ...deps.builds, setCheckRunId: down, releaseCheckRunClaim: down };

    expect(await createCheckRun({ ...deps, builds }, project, build, base)).toEqual({
      missing: 'failed',
    });
    deps.clock.advance(5 * 60_000 + 1);
    expect(await createCheckRun({ ...deps, builds }, project, build, base)).toEqual({ id: 901 });
    const claimDown = { ...deps.builds, claimCheckRun: down };
    expect(await createCheckRun({ ...deps, builds: claimDown }, project, build, base)).toEqual({
      missing: 'failed',
    });
    expect(deps.log.warnings.map((warning) => warning.event)).toEqual([
      'check_run_create_failed',
      'check_run_claim_not_released',
      'check_run_id_not_stored',
      'check_run_claim_failed',
    ]);
  });
});
