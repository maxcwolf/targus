import { CreateBuildResponse, ListSnapshotsResponse, SubmitResultsResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { bearer, call, createTestProject, postJson } from '../../test/support/api.ts';
import { createBuildRequest, imageHash, sha, storyResult } from '../../test/support/fixtures.ts';
import { postAsReviewer, projectWithBuild } from '../../test/support/review.ts';
import { signIn } from '../../test/support/session.ts';

// Each result names the baseline the CLI diffed against (ADR 0032). These run the race over
// HTTP and D1: a reviewer decides on the baseline build between opening a build and submitting.

describe('/api/builds/:id/results baselineHash', () => {
  it('refuses a result that does not say which baseline it was diffed against', async () => {
    const { token } = await createTestProject();
    const created = await postJson('/api/builds', token, createBuildRequest(sha('a')));
    const { build } = CreateBuildResponse.parse(await created.json());
    const result = Object.entries(storyResult('button')).filter(([key]) => key !== 'baselineHash');

    const submitted = await postJson(`/api/builds/${build.id}/results`, token, {
      durationMs: 1,
      threshold: 0.001,
      results: [Object.fromEntries(result)],
    });

    expect(submitted.status).toBe(400);
    expect(await submitted.text()).toContain('baselineHash');
  });
});

/** A main build that accepted `button` as `capture`, and a review of it by a member. */
async function acceptedMainBuild(capture: string) {
  const main = await projectWithBuild([storyResult('button', { imageHash: capture })]);
  const { cookie } = await signIn('octocat');
  const id = main.snapshots[0]?.id ?? '';
  const review = (decision: 'approve' | 'deny') =>
    postAsReviewer(`/api/snapshots/${id}/review`, cookie, { decision });
  expect((await review('approve')).status).toBe(200);
  return { token: main.token, review };
}

/** Open a PR build whose merge base is the main build's sha. */
async function openPrBuild(token: string) {
  const request = createBuildRequest(sha('b'), {
    branch: 'feature',
    prNumber: 3,
    trigger: 'pr',
    mergeBaseSha: sha('a'),
  });
  return CreateBuildResponse.parse(await (await postJson('/api/builds', token, request)).json());
}

describe('/api/builds/:id/results when the baseline moves during the run', () => {
  it('stores a story whose baseline was denied as new, not unchanged', async () => {
    const capture = imageHash('1');
    const { token, review } = await acceptedMainBuild(capture);
    const opened = await openPrBuild(token);
    expect(opened.baselines).toEqual([
      { storyId: 'button', variant: 'default', imageHash: capture },
    ]);

    // The run is open; the reviewer takes the approval back.
    expect((await review('deny')).status).toBe(200);
    const pinned = {
      state: 'unchanged' as const,
      imageHash: capture,
      baselineHash: capture,
      diffRatio: 0,
    };
    const submitted = await postJson(`/api/builds/${opened.build.id}/results`, token, {
      durationMs: 1,
      threshold: 0.001,
      results: [storyResult('button', pinned)],
    });

    expect(submitted.status).toBe(200);
    expect(SubmitResultsResponse.parse(await submitted.json()).summary).toMatchObject({
      status: 'pending',
      pendingCount: 1,
    });
    const listed = await call(`/api/builds/${opened.build.id}/snapshots`, {
      headers: bearer(token),
    });
    expect(ListSnapshotsResponse.parse(await listed.json()).snapshots).toMatchObject([
      { state: 'new', review: 'pending', baselineHash: null, diffRatio: null, diffHash: null },
    ]);
  });
});
