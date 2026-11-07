import {
  ApproveAllResponse,
  CreateBuildResponse,
  GetBuildResponse,
  ListSnapshotsResponse,
  SubmitResultsResponse,
} from '@targus/core';
import { describe, expect, it } from 'vitest';

import { bearer, call, createTestProject, postJson, putImage } from '../../test/support/api.ts';
import { captured, createBuildRequest, sha, storyResult } from '../../test/support/fixtures.ts';
import { pngFixture } from '../../test/support/png.ts';
import { getAsReviewer, postAsReviewer, projectWithBuild } from '../../test/support/review.ts';
import { signIn } from '../../test/support/session.ts';

describe('/api/builds', () => {
  it('creates a build, accepts results and reads both back, each matching its contract', async () => {
    const { token } = await createTestProject();
    const png = await pngFixture(2, 2, 31);

    const created = await postJson(
      '/api/builds',
      token,
      createBuildRequest(sha('a'), { snapshots: [captured('button', png.hash)] }),
    );
    expect(created.status).toBe(201);
    const { build, missingImageHashes } = CreateBuildResponse.parse(await created.json());
    expect(missingImageHashes).toEqual([png.hash]);
    expect((await putImage(token, png.hash, png.bytes)).status).toBe(200);
    const open = await call(`/api/builds/${build.id}`, { headers: bearer(token) });
    expect(GetBuildResponse.parse(await open.json())).toMatchObject({
      build: { status: 'in_progress', checkRunId: null },
      summary: { status: 'in_progress', conclusion: null, pendingCount: 0 },
    });

    const submitted = await postJson(`/api/builds/${build.id}/results`, token, {
      durationMs: 5,
      threshold: 0.001,
      results: [storyResult('button', { imageHash: png.hash })],
    });
    expect(submitted.status).toBe(200);
    expect(SubmitResultsResponse.parse(await submitted.json()).reviewUrl).toBe(
      `http://localhost:8787/builds/${build.id}`,
    );

    const read = await call(`/api/builds/${build.id}`, { headers: bearer(token) });
    expect(GetBuildResponse.parse(await read.json()).build).toMatchObject({
      id: build.id,
      status: 'pending',
    });
    const listed = await call(`/api/builds/${build.id}/snapshots`, { headers: bearer(token) });
    expect(ListSnapshotsResponse.parse(await listed.json()).snapshots).toHaveLength(1);
  });
});

describe('/api/builds/:id/results sent again', () => {
  it('answers the same body as the first time and refuses other results with 409', async () => {
    const { token } = await createTestProject();
    const png = await pngFixture(2, 2, 32);
    const created = await postJson(
      '/api/builds',
      token,
      createBuildRequest(sha('d'), { snapshots: [captured('button', png.hash)] }),
    );
    const { build } = CreateBuildResponse.parse(await created.json());
    await putImage(token, png.hash, png.bytes);
    const body = {
      durationMs: 5,
      threshold: 0.001,
      results: [storyResult('button', { imageHash: png.hash })],
    };
    const path = `/api/builds/${build.id}/results`;

    const first = await postJson(path, token, body);
    const replayed = await postJson(path, token, body);
    const other = await postJson(path, token, { ...body, durationMs: 6 });

    expect([first.status, replayed.status, other.status]).toEqual([200, 200, 409]);
    expect(SubmitResultsResponse.parse(await replayed.json())).toEqual(
      SubmitResultsResponse.parse(await first.json()),
    );
    const listed = await call(`/api/builds/${build.id}/snapshots`, { headers: bearer(token) });
    expect(ListSnapshotsResponse.parse(await listed.json()).snapshots).toHaveLength(1);
  });
});

describe('/api/builds authorization', () => {
  it('hides builds of other projects behind 404', async () => {
    const owner = await createTestProject();
    const stranger = await createTestProject();
    const created = await postJson('/api/builds', owner.token, createBuildRequest(sha('b')));
    const { build } = CreateBuildResponse.parse(await created.json());

    for (const path of [`/api/builds/${build.id}`, `/api/builds/${build.id}/snapshots`]) {
      expect((await call(path, { headers: bearer(stranger.token) })).status).toBe(404);
    }
    const results = await postJson(`/api/builds/${build.id}/results`, stranger.token, {
      durationMs: 1,
      threshold: 0.001,
      results: [storyResult('button')],
    });
    expect(results.status).toBe(404);
  });

  it('requires a project token and a valid body', async () => {
    const { token } = await createTestProject();

    expect((await call('/api/builds', { method: 'POST' })).status).toBe(401);
    expect((await postJson('/api/builds', token, { sha: 'short' })).status).toBe(400);
    const errorWithImage = await postJson('/api/builds/any/results', token, {
      durationMs: 1,
      threshold: 0.001,
      results: [storyResult('x', { state: 'error', error: 'boom' })],
    });
    expect(errorWithImage.status).toBe(400);
  });

  it('answers a repeated idempotency key with the same build, and another build with 409', async () => {
    const { token } = await createTestProject();
    const request = createBuildRequest(sha('c'), { idempotencyKey: 'run-route-1' });

    const first = await postJson('/api/builds', token, request);
    const again = await postJson('/api/builds', token, request);
    const changed = await postJson('/api/builds', token, { ...request, sha: sha('d') });

    expect([first.status, again.status, changed.status]).toEqual([201, 201, 409]);
    const opened = CreateBuildResponse.parse(await first.json()).build;
    expect(CreateBuildResponse.parse(await again.json()).build).toEqual(opened);
    expect(await changed.json()).toMatchObject({ error: { code: 'conflict' } });
  });
});

describe('/api/builds results with no stories', () => {
  it('refuses results with no stories and leaves the build open', async () => {
    const { token } = await createTestProject();
    const created = await postJson('/api/builds', token, createBuildRequest(sha('e')));
    const { build } = CreateBuildResponse.parse(await created.json());

    const empty = await postJson(`/api/builds/${build.id}/results`, token, {
      durationMs: 1,
      threshold: 0.001,
      results: [],
    });

    expect(empty.status).toBe(400);
    expect(await empty.text()).toContain('no story results');
    const read = await call(`/api/builds/${build.id}`, { headers: bearer(token) });
    expect(await read.json()).toMatchObject({ build: { status: 'in_progress' } });
  });
});

describe('/api/builds for reviewers', () => {
  it('lets a member read a build and its snapshots with the session cookie', async () => {
    const { buildId } = await projectWithBuild([storyResult('button')]);
    const { cookie } = await signIn('octocat');

    const read = await getAsReviewer(`/api/builds/${buildId}`, cookie);
    const listed = await getAsReviewer(`/api/builds/${buildId}/snapshots`, cookie);

    expect(GetBuildResponse.parse(await read.json())).toMatchObject({
      build: { id: buildId, status: 'pending' },
      counts: { new: 1 },
    });
    expect(ListSnapshotsResponse.parse(await listed.json()).snapshots).toHaveLength(1);
  });

  it('forbids outsiders and requires a session or a token', async () => {
    const { buildId } = await projectWithBuild([storyResult('button')]);
    const { cookie } = await signIn('outsider');

    expect((await getAsReviewer(`/api/builds/${buildId}`, cookie)).status).toBe(403);
    expect((await call(`/api/builds/${buildId}`)).status).toBe(401);
    expect((await call(`/api/builds/${buildId}`, { headers: bearer('nope') })).status).toBe(401);
  });

  it('approves every pending change with approve-all, behind the session only', async () => {
    const { token, buildId } = await projectWithBuild([storyResult('a'), storyResult('b')]);
    const { cookie } = await signIn('octocat');

    const approved = await postAsReviewer(`/api/builds/${buildId}/approve-all`, cookie);

    expect(approved.status).toBe(200);
    expect(ApproveAllResponse.parse(await approved.json())).toMatchObject({
      approvedCount: 2,
      summary: { status: 'accepted' },
    });
    expect((await postJson(`/api/builds/${buildId}/approve-all`, token, {})).status).toBe(401);
  });
});
