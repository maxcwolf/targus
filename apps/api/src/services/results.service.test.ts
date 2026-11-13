import {
  emptyTally,
  SubmitResultsResponse,
  type GitHubClient,
  type SnapshotState,
  type SubmitResultsRequest,
} from '@targus/core';
import { describe, expect, it, vi } from 'vitest';

import { OctokitGitHubClient } from '../adapters/github-client.adapter.ts';
import type { Project } from '../ports/project-repository.ts';
import {
  createBuildRequest,
  imageHash,
  newProject,
  sha,
  storyResult,
} from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { createGitHubStub, generatePrivateKeyPem } from '../../test/support/github-stub.ts';
import { markUploaded } from '../../test/support/in-memory-images.ts';
import { asProject, createTestDeps, type TestDeps } from '../../test/support/in-memory.ts';
import { createBuild, getBuild } from './build.service.ts';
import { submitResults } from './results.service.ts';

async function setup(
  github?: GitHubClient,
  installationId: number | null = null,
): Promise<{ deps: TestDeps; project: Project }> {
  const deps = createTestDeps(github === undefined ? {} : { github });
  return { deps, project: await deps.projects.create(newProject('res', { installationId })) };
}

async function openBuild(
  deps: TestDeps,
  project: Project,
  onSha: string,
  mergeBase: string | null = null,
) {
  const request = createBuildRequest(onSha, { mergeBaseSha: mergeBase });
  return (await createBuild(deps, project, request)).build.id;
}

/**
 * `submitResults` once the project has uploaded every image the results name, diffed with the
 * server's threshold (ADR 0028).
 */
async function submit(
  deps: TestDeps,
  project: Project,
  buildId: string,
  request: Omit<SubmitResultsRequest, 'threshold'>,
) {
  await markUploaded(deps.images, project.id, request.results);
  const threshold = deps.config.diffThreshold;
  return submitResults(deps, project, buildId, { ...request, threshold });
}

describe('submitResults', () => {
  it('fails a first build with an errored story and stores the server-side states', async () => {
    const { deps, project } = await setup();
    const buildId = await openBuild(deps, project, sha('a'));

    const response = await submit(deps, project, buildId, {
      durationMs: 10,
      results: [
        storyResult('fresh', { blank: true }),
        storyResult('broken', {
          state: 'error',
          imageHash: null,
          width: null,
          height: null,
          error: 'boom',
        }),
      ],
    });

    expect(SubmitResultsResponse.parse(response)).toEqual({
      build: { id: buildId, number: 1 },
      summary: {
        status: 'failed',
        conclusion: 'failure',
        pendingCount: 1,
        deniedCount: 0,
        errorCount: 1,
      },
      reviewUrl: `https://targus.test/builds/${buildId}`,
      checkRun: null,
      checkRunMissing: 'no_installation',
    });
    expect(deps.builds.builds[0]).toMatchObject({
      status: 'failed',
      completedAt: deps.clock.now().toISOString(),
    });
    expect(deps.builds.snapshots.get(buildId)).toMatchObject([
      { storyId: 'fresh', state: 'new', review: 'pending', blank: true, baselineHash: null },
      { storyId: 'broken', state: 'error', review: 'pending', error: 'boom', imageHash: null },
    ]);
  });
});

/** A result diffed against the baseline `POST /api/builds` offered (ADR 0032). */
const pinned = (story: string, state: SnapshotState, hash: string, base: string, ratio: number) =>
  storyResult(story, {
    state,
    imageHash: imageHash(hash),
    baselineHash: imageHash(base),
    diffRatio: ratio,
  });

describe('submitResults against a baseline', () => {
  it('compares with the baseline, overrides the CLI state and adds removed stories', async () => {
    const { deps, project } = await setup();
    const first = await openBuild(deps, project, sha('a'));
    await submit(deps, project, first, {
      durationMs: 1,
      results: [
        storyResult('same', { imageHash: imageHash('1') }),
        storyResult('moved', { imageHash: imageHash('2') }),
        storyResult('gone', { imageHash: imageHash('3') }),
        storyResult('wobbly', { imageHash: imageHash('4') }),
      ],
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

    const second = await openBuild(deps, project, sha('b'), sha('a'));
    const response = await submit(deps, project, second, {
      durationMs: 1,
      results: [
        pinned('same', 'changed', '1', '1', 0),
        pinned('moved', 'unchanged', '5', '2', 0.5),
        pinned('wobbly', 'unstable', '6', '4', 0.2),
        storyResult('tiny', { variant: 'dark', imageHash: imageHash('7') }),
      ],
    });

    expect(response.summary).toMatchObject({ status: 'pending', pendingCount: 2 });
    expect(deps.builds.snapshots.get(second)).toMatchObject([
      { storyId: 'same', state: 'unchanged', review: 'approved', baselineHash: imageHash('1') },
      { storyId: 'moved', state: 'changed', review: 'pending', baselineHash: imageHash('2') },
      { storyId: 'wobbly', state: 'unstable', review: 'approved' },
      { storyId: 'tiny', variant: 'dark', state: 'new', review: 'pending' },
      {
        storyId: 'gone',
        variant: 'default',
        state: 'removed',
        review: 'approved',
        imageHash: null,
        baselineHash: imageHash('3'),
      },
    ]);
  });
});

describe('submitResults with approvals', () => {
  it('carries approvals forward by hash pair', async () => {
    const { deps, project } = await setup();
    const buildId = await openBuild(deps, project, sha('a'));
    await deps.approvals.create('a1', {
      projectId: project.id,
      storyId: 'fresh',
      variant: 'default',
      fromHash: null,
      toHash: imageHash('1'),
      approvedBy: 'octocat',
      approvedAt: deps.clock.now().toISOString(),
    });

    const response = await submit(deps, project, buildId, {
      durationMs: 1,
      results: [storyResult('fresh')],
    });

    expect(response.summary.status).toBe('accepted');
  });
});

describe('submitResults validation', () => {
  it('rejects other results, duplicate stories and builds of other projects', async () => {
    const { deps, project } = await setup();
    const buildId = await openBuild(deps, project, sha('a'));
    const other = await deps.projects.create(newProject('other'));

    await expect(
      submit(deps, project, buildId, {
        durationMs: 1,
        results: [storyResult('x'), storyResult('x')],
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    const one = { durationMs: 1, results: [storyResult('x')] };
    await submit(deps, project, buildId, one);
    await expect(submit(deps, project, buildId, { ...one, durationMs: 2 })).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(submit(deps, other, buildId, one)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('rejects a non-error result with no image and no baseline', async () => {
    const { deps, project } = await setup();
    const buildId = await openBuild(deps, project, sha('a'));

    await expect(
      submit(deps, project, buildId, {
        durationMs: 1,
        results: [storyResult('ghost', { state: 'removed', imageHash: null })],
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('submitResults image ownership', () => {
  it('rejects a capture or a diff that this project did not upload', async () => {
    const { deps, project } = await setup();
    const buildId = await openBuild(deps, project, sha('a'));
    // Stored, but only another tenant sent the bytes: knowing the hash is not enough.
    await deps.images.record(
      { hash: imageHash('9'), sizeBytes: 1, width: 1, height: 1 },
      deps.clock.now(),
    );
    const other = await deps.projects.create(newProject('other'));
    await deps.images.recordUpload(other.id, imageHash('9'), deps.clock.now());
    await deps.images.recordUpload(project.id, imageHash('1'), deps.clock.now());

    for (const result of [
      storyResult('capture', { imageHash: imageHash('9') }),
      { ...pinned('diff', 'changed', '1', '2', 0.5), diffHash: imageHash('9') },
    ]) {
      await expect(
        submitResults(deps, project, buildId, {
          durationMs: 1,
          threshold: 0.001,
          results: [result],
        }),
      ).rejects.toThrow(`image ${imageHash('9')} was not uploaded by this project`);
    }
    expect(deps.builds.snapshots.get(buildId)).toBeUndefined();
    expect(deps.builds.builds[0]?.status).toBe('in_progress');
  });
});

describe('submitResults check runs', () => {
  it('reports the targus/ios commit status through Octokit when the org has an installation', async () => {
    const stub = createGitHubStub();
    const github = new OctokitGitHubClient(
      { appId: '123', privateKey: await generatePrivateKeyPem() },
      stub.fetch,
    );
    const { deps, project } = await setup(github, 42);
    const buildId = await openBuild(deps, project, sha('c'));

    const response = await submit(deps, project, buildId, {
      durationMs: 1,
      results: [storyResult('fresh')],
    });

    expect(response).toMatchObject({ checkRun: { id: 901 }, checkRunMissing: null });
    expect(deps.builds.builds[0]?.checkRunId).toBe(901);
    expect((await getBuild(deps, asProject(project), buildId)).build.checkRunId).toBe(901);
    expect(stub.requests.map((request) => request.path)).toEqual([
      '/app/installations/42/access_tokens',
      `/repos/org-res/app/statuses/${sha('c')}`,
    ]);
    expect(stub.requests[1]?.body).toEqual({
      context: 'targus/ios',
      target_url: `https://targus.test/builds/${buildId}`,
      state: 'pending',
      description: '1 change awaiting review',
    });
  });
});

/** A GitHub client that does nothing, around the given `createCheckRun`. */
function githubWith(createCheckRun: GitHubClient['createCheckRun']): GitHubClient {
  return { ...createRecordingGitHub(), createCheckRun };
}

describe('submitResults without a check run', () => {
  it('skips the check run without an installation, and with the no-op client', async () => {
    const createCheckRun = vi.fn<GitHubClient['createCheckRun']>().mockResolvedValue({ id: 0 });
    const github = githubWith(createCheckRun);
    const without = await setup(github, null);
    const withNoop = await setup(github, 7);

    const first = await openBuild(without.deps, without.project, sha('a'));
    const second = await openBuild(withNoop.deps, withNoop.project, sha('a'));
    const results = { durationMs: 1, results: [storyResult('a')] };

    expect(await submit(without.deps, without.project, first, results)).toMatchObject({
      checkRun: null,
      checkRunMissing: 'no_installation',
    });
    expect(await submit(withNoop.deps, withNoop.project, second, results)).toMatchObject({
      checkRun: null,
      checkRunMissing: 'no_github_app',
    });
    expect(createCheckRun).toHaveBeenCalledOnce();
  });

  it('keeps the results when GitHub fails', async () => {
    const github = githubWith(vi.fn().mockRejectedValue(new Error('GitHub is down')));
    const { deps, project } = await setup(github, 7);
    const buildId = await openBuild(deps, project, sha('a'));

    const response = await submit(deps, project, buildId, {
      durationMs: 1,
      results: [storyResult('a')],
    });

    expect(response).toMatchObject({
      checkRun: null,
      checkRunMissing: 'failed',
      summary: { status: 'pending' },
    });
    expect(deps.builds.builds[0]?.status).toBe('pending');
    expect(deps.log.warnings).toEqual([
      { event: 'check_run_create_failed', reason: 'GitHub is down' },
    ]);
  });
});
