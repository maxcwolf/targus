import {
  CreateBuildResponse,
  GetBuildResponse,
  SubmitResultsResponse,
  type CreateBuildRequest,
  type StoryResult,
} from '@targus/core';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createApprovalRepository } from '../repositories/approval.repository.ts';
import { bearer, call, createTestProject, postJson, putImage } from '../../test/support/api.ts';
import { captured, createBuildRequest, sha, storyResult } from '../../test/support/fixtures.ts';
import { pngFixture } from '../../test/support/png.ts';

// The build flow over HTTP in the Workers runtime with the real local D1 and R2: what `targus run`
// does on CI, build after build. GitHub is the no-op client (the project has no installation).

type Png = Awaited<ReturnType<typeof pngFixture>>;

interface Flow {
  readonly token: string;
  readonly projectId: string;
  readonly button: Png;
  readonly card: Png;
  readonly cardChanged: Png;
}

async function openBuild(token: string, request: CreateBuildRequest): Promise<CreateBuildResponse> {
  const response = await postJson('/api/builds', token, request);
  expect(response.status).toBe(201);
  return CreateBuildResponse.parse(await response.json());
}

async function submit(token: string, buildId: string, results: StoryResult[]) {
  const body = { durationMs: 1000, results };
  const response = await postJson(`/api/builds/${buildId}/results`, token, body);
  expect(response.status).toBe(200);
  return SubmitResultsResponse.parse(await response.json());
}

async function readBuild(token: string, buildId: string): Promise<GetBuildResponse> {
  const response = await call(`/api/builds/${buildId}`, { headers: bearer(token) });
  return GetBuildResponse.parse(await response.json());
}

/** Record an approval directly, without the review route (review-flow.test.ts covers it). */
function approve(flow: Flow, storyId: string, fromHash: string | null, toHash: string) {
  return createApprovalRepository(env.DB).create(`${flow.projectId}-${storyId}-${toHash}`, {
    projectId: flow.projectId,
    storyId,
    variant: 'default',
    fromHash,
    toHash,
    approvedBy: 'octocat',
    approvedAt: '2026-11-04T00:00:00.000Z',
  });
}

const mainBuild = (flow: Flow) =>
  createBuildRequest(sha('a'), {
    snapshots: [captured('button', flow.button.hash), captured('card', flow.card.hash)],
  });

/** Build 1, the first on main: no baseline; one story is new, one fails to render. */
async function firstBuildFails(flow: Flow): Promise<void> {
  const first = await openBuild(flow.token, mainBuild(flow));
  expect(first).toMatchObject({ baselineBuildId: null, baselines: [] });
  expect(first.missingImageHashes).toEqual([flow.button.hash, flow.card.hash]);
  for (const png of [flow.button, flow.card]) {
    expect((await putImage(flow.token, png.hash, png.bytes)).status).toBe(200);
  }
  expect((await readBuild(flow.token, first.build.id)).build.status).toBe('in_progress');

  await submit(flow.token, first.build.id, [
    storyResult('button', { imageHash: flow.button.hash }),
    storyResult('card', { state: 'error', imageHash: null, width: null, height: null, error: 'x' }),
  ]);

  const failed = await readBuild(flow.token, first.build.id);
  expect(failed.build.status).toBe('failed');
  expect(failed.summary).toMatchObject({ status: 'failed', errorCount: 1 });
}

/**
 * A failed build is never a baseline (rule 1), so main is re-run on the same sha after the fix,
 * with both new stories approved: that build is the accepted baseline. Returns its id.
 */
async function rerunIsAccepted(flow: Flow): Promise<string> {
  await approve(flow, 'button', null, flow.button.hash);
  await approve(flow, 'card', null, flow.card.hash);
  const rerun = await openBuild(flow.token, mainBuild(flow));
  expect(rerun.missingImageHashes).toEqual([]);

  const accepted = await submit(flow.token, rerun.build.id, [
    storyResult('button', { imageHash: flow.button.hash }),
    storyResult('card', { imageHash: flow.card.hash }),
  ]);
  expect(accepted.summary.status).toBe('accepted');
  return rerun.build.id;
}

const prBuild = (flow: Flow, onSha: string) =>
  createBuildRequest(onSha, {
    branch: 'feature',
    prNumber: 7,
    trigger: 'pr',
    mergeBaseSha: sha('a'),
    ancestors: [sha('9')],
    snapshots: [captured('button', flow.button.hash), captured('card', flow.cardChanged.hash)],
  });

const prResults = (flow: Flow) => [
  storyResult('button', { state: 'unchanged', imageHash: flow.button.hash }),
  storyResult('card', { state: 'changed', imageHash: flow.cardChanged.hash, diffRatio: 0.25 }),
];

/** Build 2, a PR on sha b whose merge base is sha a: one story unchanged, one changed. */
async function prBuildWaitsForReview(flow: Flow, baselineId: string): Promise<void> {
  const second = await openBuild(flow.token, prBuild(flow, sha('b')));
  expect(second.baselineBuildId).toBe(baselineId);
  expect(second.baselines).toEqual([
    { storyId: 'button', variant: 'default', imageHash: flow.button.hash },
    { storyId: 'card', variant: 'default', imageHash: flow.card.hash },
  ]);
  expect(second.missingImageHashes).toEqual([flow.cardChanged.hash]);
  const upload = await putImage(flow.token, flow.cardChanged.hash, flow.cardChanged.bytes);
  expect(upload.status).toBe(200);

  const pending = await submit(flow.token, second.build.id, prResults(flow));
  expect(pending).toMatchObject({
    summary: { status: 'pending', pendingCount: 1 },
    reviewUrl: `http://localhost:8787/builds/${second.build.id}`,
    checkRun: null,
  });
  expect((await readBuild(flow.token, second.build.id)).build.status).toBe('pending');
}

/** Build 3, the PR re-pushed after the change was approved: the same pair auto-accepts. */
async function approvedPairIsAccepted(flow: Flow, baselineId: string): Promise<GetBuildResponse> {
  await approve(flow, 'card', flow.card.hash, flow.cardChanged.hash);
  const third = await openBuild(flow.token, prBuild(flow, sha('c')));
  expect(third.baselineBuildId).toBe(baselineId);

  const accepted = await submit(flow.token, third.build.id, prResults(flow));
  expect(accepted.summary).toMatchObject({ status: 'accepted', pendingCount: 0 });
  return readBuild(flow.token, third.build.id);
}

describe('build flow: create, upload, submit, compare, approve', () => {
  it('fails on an error, waits on a change, then auto-accepts the approved pair', async () => {
    const { token, project } = await createTestProject();
    const [button, card, cardChanged] = await Promise.all([
      pngFixture(4, 4, 10),
      pngFixture(4, 4, 20),
      pngFixture(4, 4, 30),
    ]);
    const flow: Flow = { token, projectId: project.id, button, card, cardChanged };

    await firstBuildFails(flow);
    const baselineId = await rerunIsAccepted(flow);
    await prBuildWaitsForReview(flow, baselineId);
    const third = await approvedPairIsAccepted(flow, baselineId);

    expect(third.build).toMatchObject({
      status: 'accepted',
      number: 4,
      baselineBuildId: baselineId,
      checkRunId: null,
    });
    expect(third.summary).toEqual({
      status: 'accepted',
      conclusion: 'success',
      pendingCount: 0,
      deniedCount: 0,
      errorCount: 0,
    });
  });
});
