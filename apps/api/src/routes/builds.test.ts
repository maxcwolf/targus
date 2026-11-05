import {
  CreateBuildResponse,
  GetBuildResponse,
  ListSnapshotsResponse,
  SubmitResultsResponse,
} from '@targus/core';
import { describe, expect, it } from 'vitest';

import { bearer, call, createTestProject, postJson } from '../../test/support/api.js';
import {
  captured,
  createBuildRequest,
  imageHash,
  sha,
  storyResult,
} from '../../test/support/fixtures.js';

describe('/api/builds', () => {
  it('creates a build, accepts results and reads both back, each matching its contract', async () => {
    const { token } = await createTestProject();

    const created = await postJson(
      '/api/builds',
      token,
      createBuildRequest(sha('a'), { snapshots: [captured('button', imageHash('1'))] }),
    );
    expect(created.status).toBe(201);
    const { build, missingImageHashes } = CreateBuildResponse.parse(await created.json());
    expect(missingImageHashes).toEqual([imageHash('1')]);
    const open = await call(`/api/builds/${build.id}`, { headers: bearer(token) });
    expect(GetBuildResponse.parse(await open.json())).toMatchObject({
      build: { status: 'in_progress', checkRunId: null },
      summary: { status: 'in_progress', conclusion: null, pendingCount: 0 },
    });

    const submitted = await postJson(`/api/builds/${build.id}/results`, token, {
      durationMs: 5,
      results: [storyResult('button', { imageHash: imageHash('1') })],
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
      results: [],
    });
    expect(results.status).toBe(404);
  });

  it('requires a project token and a valid body', async () => {
    const { token } = await createTestProject();

    expect((await call('/api/builds', { method: 'POST' })).status).toBe(401);
    expect((await postJson('/api/builds', token, { sha: 'short' })).status).toBe(400);
    const errorWithImage = await postJson('/api/builds/any/results', token, {
      durationMs: 1,
      results: [storyResult('x', { state: 'error', error: 'boom' })],
    });
    expect(errorWithImage.status).toBe(400);
  });
});
