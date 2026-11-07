import { CreateBuildResponse, ListSnapshotsResponse, UploadImageResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { bearer, call, createTestProject, postJson, putImage } from '../../test/support/api.ts';
import {
  captured,
  createBuildRequest,
  imageHash,
  sha,
  storyResult,
} from '../../test/support/fixtures.ts';
import { pngFixture } from '../../test/support/png.ts';
import { getAsReviewer, postAsReviewer, projectWithBuild } from '../../test/support/review.ts';
import { signIn } from '../../test/support/session.ts';
import { maxImageBytes } from './images.ts';

describe('PUT and GET /api/images/:hash', () => {
  it('uploads a PNG once and serves it back', async () => {
    const { token } = await createTestProject();
    const png = await pngFixture(2, 2, 99);

    const first = await putImage(token, png.hash, png.bytes);
    const second = await putImage(token, png.hash, png.bytes);
    const read = await call(`/api/images/${png.hash}`, { headers: bearer(token) });

    expect(first.status).toBe(200);
    expect(UploadImageResponse.parse(await first.json())).toEqual({ hash: png.hash, stored: true });
    expect(UploadImageResponse.parse(await second.json())).toEqual({
      hash: png.hash,
      stored: false,
    });
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/png');
    expect(read.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(png.bytes);
  });

  it('rejects a wrong content type, a hash mismatch and an oversized body', async () => {
    const { token } = await createTestProject();
    const png = await pngFixture(1, 1, 98);

    const wrongType = await call(`/api/images/${png.hash}`, {
      method: 'PUT',
      headers: { ...bearer(token), 'content-type': 'application/octet-stream' },
      body: png.bytes,
    });
    const mismatch = await putImage(token, imageHash('a'), png.bytes);
    const huge = await putImage(token, imageHash('b'), new Uint8Array(maxImageBytes + 1));

    expect(wrongType.status).toBe(400);
    expect(mismatch.status).toBe(400);
    expect(huge.status).toBe(413);
    expect(await huge.json()).toEqual({
      error: {
        code: 'bad_request',
        message: 'image larger than 10 MB',
        requestId: huge.headers.get('x-request-id'),
      },
    });
  });

  it('answers 404 for an unknown image and 401 without a project token', async () => {
    const { token } = await createTestProject();

    expect((await call(`/api/images/${imageHash('c')}`, { headers: bearer(token) })).status).toBe(
      404,
    );
    expect((await call(`/api/images/${imageHash('c')}`)).status).toBe(401);
    expect((await call(`/api/images/${imageHash('c')}`, { headers: bearer('nope') })).status).toBe(
      401,
    );
  });
});

describe('images of another project', () => {
  it('cannot be read, are asked for again, and cannot be named in results', async () => {
    const owner = await createTestProject();
    const stranger = await createTestProject();
    const png = await pngFixture(2, 2, 96);
    await putImage(owner.token, png.hash, png.bytes);
    const path = `/api/images/${png.hash}`;

    expect((await call(path, { headers: bearer(stranger.token) })).status).toBe(404);
    const created = await postJson(
      '/api/builds',
      stranger.token,
      createBuildRequest(sha('a'), { snapshots: [captured('button', png.hash)] }),
    );
    const { build, missingImageHashes } = CreateBuildResponse.parse(await created.json());
    expect(missingImageHashes).toEqual([png.hash]);
    const adopted = await postJson(`/api/builds/${build.id}/results`, stranger.token, {
      durationMs: 1,
      threshold: 0.001,
      results: [storyResult('button', { imageHash: png.hash })],
    });
    expect(adopted.status).toBe(400);
    expect((await call(path, { headers: bearer(stranger.token) })).status).toBe(404);
  });

  it('become readable once the project uploads the same bytes itself', async () => {
    const owner = await createTestProject();
    const stranger = await createTestProject();
    const png = await pngFixture(2, 2, 95);
    await putImage(owner.token, png.hash, png.bytes);

    const upload = await putImage(stranger.token, png.hash, png.bytes);
    const read = await call(`/api/images/${png.hash}`, { headers: bearer(stranger.token) });

    expect(UploadImageResponse.parse(await upload.json())).toEqual({
      hash: png.hash,
      stored: false,
    });
    expect(read.status).toBe(200);
  });
});

describe('GET /api/images/:hash for reviewers', () => {
  it('serves images of builds in the reviewer org and answers 404 to everyone else', async () => {
    const png = await pngFixture(2, 2, 77);
    const { token } = await projectWithBuild([storyResult('button', { imageHash: png.hash })]);
    await putImage(token, png.hash, png.bytes);
    const member = await signIn('octocat');
    const outsider = await signIn('outsider');

    const read = await getAsReviewer(`/api/images/${png.hash}`, member.cookie);

    expect(read.status).toBe(200);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(png.bytes);
    expect((await getAsReviewer(`/api/images/${png.hash}`, outsider.cookie)).status).toBe(404);
    expect((await getAsReviewer(`/api/images/${imageHash('d')}`, member.cookie)).status).toBe(404);
    expect((await getAsReviewer('/api/images/not-a-hash', member.cookie)).status).toBe(400);
  });
});

describe('GET /api/images/:hash for reviewers of a changed story', () => {
  it('serves its baseline, capture and diff, each uploaded by the CLI', async () => {
    const [baseline, capture, diff] = await Promise.all([
      pngFixture(2, 2, 81),
      pngFixture(2, 2, 82),
      pngFixture(2, 2, 83),
    ]);
    const main = await projectWithBuild([storyResult('button', { imageHash: baseline.hash })]);
    await putImage(main.token, baseline.hash, baseline.bytes);
    const member = await signIn('octocat');
    const accepted = await postAsReviewer(`/api/builds/${main.buildId}/approve-all`, member.cookie);
    expect(accepted.status).toBe(200);

    const opened = await postJson(
      '/api/builds',
      main.token,
      createBuildRequest(sha('b'), {
        branch: 'feature',
        prNumber: 7,
        trigger: 'pr',
        mergeBaseSha: sha('a'),
        snapshots: [captured('button', capture.hash)],
      }),
    );
    const { build, baselineBuildId } = CreateBuildResponse.parse(await opened.json());
    expect(baselineBuildId).toBe(main.buildId);
    await putImage(main.token, capture.hash, capture.bytes);
    await putImage(main.token, diff.hash, diff.bytes);
    const changed = storyResult('button', {
      state: 'changed',
      imageHash: capture.hash,
      baselineHash: baseline.hash,
      diffHash: diff.hash,
      diffRatio: 0.5,
    });
    const body = { durationMs: 1, threshold: 0.001, results: [changed] };
    const submitted = await postJson(`/api/builds/${build.id}/results`, main.token, body);
    expect(submitted.status).toBe(200);
    const listed = await call(`/api/builds/${build.id}/snapshots`, { headers: bearer(main.token) });
    const { snapshots } = ListSnapshotsResponse.parse(await listed.json());
    expect(snapshots[0]).toMatchObject({ baselineHash: baseline.hash, diffHash: diff.hash });

    const outsider = await signIn('outsider');
    for (const png of [baseline, capture, diff]) {
      const read = await getAsReviewer(`/api/images/${png.hash}`, member.cookie);
      expect(read.status).toBe(200);
      expect(new Uint8Array(await read.arrayBuffer())).toEqual(png.bytes);
      expect((await getAsReviewer(`/api/images/${png.hash}`, outsider.cookie)).status).toBe(404);
    }
  });
});
