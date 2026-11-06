import type { GitHubClient, SubmitResultsRequest } from '@targus/core';
import { describe, expect, it, vi } from 'vitest';

import type { ApiBuildRepository } from '../repositories/build.repository.ts';
import { createBuildRequest, newProject, sha, storyResult } from '../../test/support/fixtures.ts';
import { markUploaded } from '../../test/support/in-memory-images.ts';
import {
  createInMemoryBuilds,
  createTestDeps,
  type TestDeps,
} from '../../test/support/in-memory.ts';
import { createBuild } from './build.service.ts';
import { submitResults } from './results.service.ts';

// Submitting results must be safe to retry: whatever fails, the build is either still open
// with nothing stored (retry succeeds) or complete with its results (retry is a conflict).
const request: SubmitResultsRequest = {
  durationMs: 1,
  results: [storyResult('fresh'), storyResult('other')],
};

async function setup(overrides: { builds?: ApiBuildRepository; github?: GitHubClient } = {}) {
  const deps = createTestDeps(overrides);
  const project = await deps.projects.create(newProject('retry', { installationId: 7 }));
  const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));
  await markUploaded(deps.images, project.id, request.results);
  return { deps, project, buildId: build.id };
}

const storedStories = (deps: TestDeps, buildId: string) =>
  (deps.builds.snapshots.get(buildId) ?? []).map((snapshot) => snapshot.storyId);

describe('submitResults twice', () => {
  it('answers a second submission with a conflict and keeps the first results', async () => {
    const { deps, project, buildId } = await setup();
    await submitResults(deps, project, buildId, request);

    await expect(
      submitResults(deps, project, buildId, { durationMs: 1, results: [storyResult('late')] }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(storedStories(deps, buildId)).toEqual(['fresh', 'other']);
  });

  it('lets one of two racing submissions through and answers the other with a conflict', async () => {
    const { deps, project, buildId } = await setup();

    // Both pass the early status check before either has written anything.
    const outcomes = await Promise.allSettled([
      submitResults(deps, project, buildId, request),
      submitResults(deps, project, buildId, request),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { code: 'conflict' },
    });
    expect(storedStories(deps, buildId)).toEqual(['fresh', 'other']);
  });
});

describe('submitResults after a failure', () => {
  it('leaves no snapshots on an open build when the write fails, so the retry succeeds', async () => {
    const builds = createInMemoryBuilds();
    const completeWithResults = vi
      .fn<ApiBuildRepository['completeWithResults']>()
      .mockRejectedValueOnce(new Error('D1 is unavailable'))
      .mockImplementation((...args) => builds.completeWithResults(...args));
    const { deps, project, buildId } = await setup({ builds: { ...builds, completeWithResults } });

    await expect(submitResults(deps, project, buildId, request)).rejects.toThrow('D1');
    expect(deps.builds.snapshots.get(buildId)).toBeUndefined();
    expect(deps.builds.builds[0]?.status).toBe('in_progress');

    const retried = await submitResults(deps, project, buildId, request);
    expect(retried.summary.status).toBe('pending');
    expect(storedStories(deps, buildId)).toEqual(['fresh', 'other']);
  });

  it('keeps the build complete when storing the check run fails, so a retry is a conflict', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const github: GitHubClient = {
      createCheckRun: vi.fn().mockResolvedValue({ id: 77 }),
      updateCheckRun: vi.fn(),
      isOrgMember: vi.fn(),
    };
    const builds = createInMemoryBuilds();
    const setCheckRunId = vi.fn().mockRejectedValue(new Error('D1 is unavailable'));
    const { deps, project, buildId } = await setup({
      github,
      builds: { ...builds, setCheckRunId },
    });

    const response = await submitResults(deps, project, buildId, request);

    expect(response).toMatchObject({ checkRun: { id: 77 }, summary: { status: 'pending' } });
    expect(deps.builds.builds[0]).toMatchObject({ status: 'pending', checkRunId: null });
    expect(log).toHaveBeenCalledOnce();
    await expect(submitResults(deps, project, buildId, request)).rejects.toMatchObject({
      code: 'conflict',
    });
    log.mockRestore();
  });
});
