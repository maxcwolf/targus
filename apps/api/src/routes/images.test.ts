import { UploadImageResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { bearer, call, createTestProject, putImage } from '../../test/support/api.js';
import { imageHash } from '../../test/support/fixtures.js';
import { pngFixture } from '../../test/support/png.js';
import { maxImageBytes } from './images.js';

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
      error: { code: 'bad_request', message: 'image larger than 10 MB' },
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
